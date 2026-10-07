import type { ExportKind } from '@mc/shared/manage';
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { Env } from '../../config/env.js';
import type { Database } from '../../db/client.js';
import {
  auditLog,
  categories,
  exhibitorCategories,
  exhibitors,
  visitors,
  votes,
} from '../../db/schema.js';
import { FieldCipher, hmacHex } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { writeAudit } from '../admin/audit.js';
import { loadSettings } from '../settings/repository.js';
import type { Actor } from '../results/service.js';
import { toCsv, type Cell } from './csv.js';

export interface CsvFile {
  filename: string;
  body: string;
  rows: number;
}

/** The audit export holds at most this many (the newest) entries. */
export const AUDIT_EXPORT_MAX = 100_000;

const stamp = (d: Date) => d.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');

/**
 * Exports (F13). Three files, each with a different privacy footprint:
 *  - `results`   per category, every exhibitor with its vote count and rank (only while the results are Live)
 *  - `votes`     (only while Live) the vote ledger with NO identity: a stable per-voter reference lets an auditor check "one vote per
 *                category" without learning who anyone is
 *  - `outreach`  name and phone of visitors who agreed to be contacted (PDPL: only with that consent, never blocked ones)
 * Every export is audited with its kind and row count, and the totals can be reconciled with the database.
 */
export class ExportService {
  private readonly cipher: FieldCipher;

  constructor(
    private readonly env: Env,
    private readonly db: Database,
  ) {
    this.cipher = new FieldCipher(env.PII_ENCRYPTION_KEY);
  }

  async run(kind: ExportKind, actor: Actor, now: Date = new Date()): Promise<CsvFile> {
    // `results` and `votes` carry per-exhibitor counts (the vote ledger can be tallied). While the TVs are not showing
    // the standings they are not available as a file either: the one audited way to look is `/results/live` (ADR-003).
    if (kind !== 'outreach' && (await loadSettings(this.db)).resultsVisibility !== 'LIVE')
      throw new AppError(
        409,
        'CONFLICT',
        'The standings are sealed on the TVs right now, so this file is not available. Read them under "Who is ahead" on the Overview (that is recorded), or switch the results back to Live.',
      );
    const file = await this.build(kind, now);
    await writeAudit(this.db, {
      adminId: actor.adminId,
      label: actor.label,
      action: 'export.run',
      entity: 'export',
      entityId: kind,
      details: { kind, rows: file.rows },
      ip: actor.ip,
    });
    return file;
  }

  /**
   * The audit trail, oldest first, as a spreadsheet: when, who, what, which record, the details (as JSON) and the
   * address it came from. The log never holds passwords, codes or phone numbers, so the file does not either. At most
   * the newest AUDIT_EXPORT_MAX entries; the download is recorded after the file is built (so it is not in itself).
   */
  async auditLog(actor: Actor, now: Date = new Date()): Promise<CsvFile> {
    const newest = await this.db
      .select()
      .from(auditLog)
      .orderBy(desc(auditLog.id))
      .limit(AUDIT_EXPORT_MAX);
    const out = newest
      .reverse()
      .map((r) => [
        r.id,
        r.at.toISOString(),
        r.actorLabel,
        r.action,
        r.entity,
        r.entityId,
        r.details ? JSON.stringify(r.details) : '',
        r.ip,
      ]);
    await writeAudit(this.db, {
      adminId: actor.adminId,
      label: actor.label,
      action: 'export.run',
      entity: 'export',
      entityId: 'audit',
      details: { kind: 'audit', rows: out.length },
      ip: actor.ip,
    });
    return {
      filename: `mc2026-audit-${stamp(now)}.csv`,
      body: toCsv(['id', 'at', 'who', 'action', 'entity', 'entity_id', 'details', 'ip'], out),
      rows: out.length,
    };
  }

  private async build(kind: ExportKind, now: Date): Promise<CsvFile> {
    const name = (k: string) => `mc2026-${k}-${stamp(now)}.csv`;
    switch (kind) {
      case 'results': {
        const rows = await this.db
          .select({
            category: categories.nameEn,
            categoryOrder: categories.sortOrder,
            exhibitorId: exhibitors.id,
            exhibitor: exhibitors.nameEn,
            exhibitorAr: exhibitors.nameAr,
            booth: exhibitors.booth,
            active: exhibitors.isActive,
            votes: sql<number>`count(${votes.id})::int`,
          })
          .from(exhibitorCategories)
          .innerJoin(categories, eq(categories.id, exhibitorCategories.categoryId))
          .innerJoin(exhibitors, eq(exhibitors.id, exhibitorCategories.exhibitorId))
          .leftJoin(
            votes,
            and(
              eq(votes.exhibitorId, exhibitors.id),
              eq(votes.categoryId, exhibitorCategories.categoryId),
            ),
          )
          .groupBy(categories.id, exhibitors.id)
          .orderBy(
            categories.sortOrder,
            categories.nameEn,
            desc(sql`count(${votes.id})`),
            exhibitors.nameEn,
          );
        // Competition ranking within each category: ties share a rank (1, 1, 3), as on the TV.
        const out: Cell[][] = [];
        let prevCategory = '';
        let position = 0;
        let rank = 0;
        let prevVotes = -1;
        for (const r of rows) {
          if (r.category !== prevCategory) {
            prevCategory = r.category;
            position = 0;
            rank = 0;
            prevVotes = -1;
          }
          position += 1;
          if (r.votes !== prevVotes) rank = position;
          prevVotes = r.votes;
          out.push([r.category, rank, r.exhibitor, r.exhibitorAr, r.booth, r.votes, r.active]);
        }
        return {
          filename: name('results'),
          body: toCsv(
            ['category', 'rank', 'exhibitor', 'exhibitor_ar', 'booth', 'votes', 'active'],
            out,
          ),
          rows: out.length,
        };
      }
      case 'votes': {
        const rows = await this.db
          .select({
            id: votes.id,
            at: votes.createdAt,
            visitorId: votes.visitorId,
            category: categories.slug,
            exhibitor: exhibitors.nameEn,
          })
          .from(votes)
          .innerJoin(categories, eq(categories.id, votes.categoryId))
          .innerJoin(exhibitors, eq(exhibitors.id, votes.exhibitorId))
          .orderBy(votes.createdAt, votes.id);
        const out = rows.map((r) => [
          r.id,
          r.at.toISOString(),
          // Same voter, same reference, in every row of this file; not reversible and not the visitor id.
          hmacHex(this.env.PHONE_HASH_PEPPER, `export:voter:${r.visitorId}`).slice(0, 16),
          r.category,
          r.exhibitor,
        ]);
        return {
          filename: name('votes'),
          body: toCsv(['vote_id', 'cast_at', 'voter_ref', 'category', 'exhibitor'], out),
          rows: out.length,
        };
      }
      case 'outreach': {
        const rows = await this.db
          .select({
            id: visitors.id,
            nameEnc: visitors.nameEnc,
            phoneEnc: visitors.phoneEnc,
            locale: visitors.locale,
            consentAt: visitors.outreachConsentAt,
            registeredAt: visitors.createdAt,
            votes: sql<number>`(SELECT count(*)::int FROM votes WHERE votes.visitor_id = "visitors"."id")`,
          })
          .from(visitors)
          .where(and(isNotNull(visitors.outreachConsentAt), eq(visitors.isBlocked, false)))
          .orderBy(visitors.createdAt, visitors.id);
        const out = rows.map((r) => [
          this.cipher.decrypt(r.nameEnc, 'visitor.name'),
          this.cipher.decrypt(r.phoneEnc, 'visitor.phone'),
          r.locale,
          r.consentAt!.toISOString(),
          r.registeredAt.toISOString(),
          r.votes,
        ]);
        return {
          filename: name('outreach'),
          body: toCsv(
            ['name', 'phone', 'locale', 'consented_at', 'registered_at', 'votes_cast'],
            out,
          ),
          rows: out.length,
        };
      }
    }
  }
}
