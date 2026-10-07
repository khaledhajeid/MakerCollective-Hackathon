import type { LiveResults, Overview } from '@mc/shared/manage';
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import {
  auditLog,
  categories,
  displayTokens,
  exhibitors,
  otpChallenges,
  visitors,
  votes,
} from '../../db/schema.js';
import { loadSettings } from '../settings/repository.js';
import { parseRevealed } from '../results/snapshot.js';
import { liveStandings } from '../results/standings.js';
import type { Actor } from '../results/service.js';
import { votingState } from '../votes/window.js';
import { writeAudit } from './audit.js';

const MINUTES = 30;
const SHARED_DEVICE_MIN = 3;
/** Reading live counts outside LIVE mode is logged, but a console that refreshes every few seconds must not flood the log. */
const LIVE_READ_AUDIT_EVERY_MS = 5 * 60_000;

/**
 * The organiser's dashboard numbers. Everything here is a total or a rate: how many people, how many votes, how many
 * per minute, how the SMS funnel is doing, which devices look suspicious. None of it is a ranking, so none of it breaks
 * the Blind Hour. Per-exhibitor counts exist only in `liveResults`, which is a separate, audited read.
 */
export class OverviewService {
  constructor(private readonly db: Database) {}

  async overview(now: Date = new Date()): Promise<Overview> {
    const s = await loadSettings(this.db);
    const since = new Date(now.getTime() - MINUTES * 60_000);
    const hourAgo = new Date(now.getTime() - 60 * 60_000);
    const [
      totals,
      perCategory,
      buckets,
      [otpRequested],
      [otpVerified],
      shared,
      [blocked],
      displays,
    ] = await Promise.all([
      this.db
        .select({
          visitors: sql<number>`(SELECT count(*)::int FROM visitors)`,
          votes: sql<number>`(SELECT count(*)::int FROM votes)`,
          voters: sql<number>`(SELECT count(DISTINCT visitor_id)::int FROM votes)`,
        })
        .from(sql`(SELECT 1) AS one`),
      this.db
        .select({
          id: categories.id,
          nameEn: categories.nameEn,
          color: categories.color,
          isActive: categories.isActive,
          votes: sql<number>`count(${votes.id})::int`,
        })
        .from(categories)
        .leftJoin(votes, eq(votes.categoryId, categories.id))
        .groupBy(categories.id)
        .orderBy(categories.sortOrder, categories.nameEn),
      this.db
        .select({
          minute: sql<string>`to_char(date_trunc('minute', ${votes.createdAt}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:00"Z"')`,
          votes: sql<number>`count(*)::int`,
        })
        .from(votes)
        .where(gt(votes.createdAt, since))
        .groupBy(sql`1`),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(otpChallenges)
        .where(gt(otpChallenges.createdAt, hourAgo)),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(otpChallenges)
        .where(
          and(gt(otpChallenges.createdAt, hourAgo), sql`${otpChallenges.consumedAt} IS NOT NULL`),
        ),
      this.db
        .select({ device: visitors.deviceId, n: sql<number>`count(*)::int` })
        .from(visitors)
        .where(sql`${visitors.deviceId} IS NOT NULL`)
        .groupBy(visitors.deviceId)
        .having(sql`count(*) >= ${SHARED_DEVICE_MIN}`)
        .orderBy(desc(sql`count(*)`))
        .limit(5),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(visitors)
        .where(eq(visitors.isBlocked, true)),
      this.db
        .select({ lastSeenAt: displayTokens.lastSeenAt })
        .from(displayTokens)
        .where(isNull(displayTokens.revokedAt)),
    ]);

    const byMinute = new Map(buckets.map((b) => [b.minute, b.votes]));
    const start = Math.floor(since.getTime() / 60_000) * 60_000 + 60_000;
    const perMinute = Array.from({ length: MINUTES }, (_, i) => {
      const at = new Date(start + i * 60_000).toISOString().slice(0, 17) + '00Z';
      return { at, votes: byMinute.get(at) ?? 0 };
    });

    const revealed = parseRevealed(s.revealed) ?? [];
    return {
      now: now.toISOString(),
      voting: {
        status: s.votingStatus,
        state: votingState(s, now),
        opensAt: s.votingOpensAt?.toISOString() ?? null,
        closesAt: s.votingClosesAt?.toISOString() ?? null,
      },
      results: {
        mode: s.resultsVisibility,
        frozenAt: s.frozenAt?.toISOString() ?? null,
        revealedCategoryIds: revealed.map((r) => r.categoryId),
      },
      access: { mode: s.accessMode, ranges: s.venueCidrs.length },
      totals: totals[0] ?? { visitors: 0, votes: 0, voters: 0 },
      categories: perCategory,
      perMinute,
      otp: { requested: otpRequested?.n ?? 0, verified: otpVerified?.n ?? 0 },
      signals: {
        blockedVisitors: blocked?.n ?? 0,
        sharedDevices: shared.map((d) => ({ device: d.device!.slice(0, 6), visitors: d.n })),
        displaysTotal: displays.length,
        displaysOnline: displays.filter(
          (d) => d.lastSeenAt && now.getTime() - d.lastSeenAt.getTime() < 2 * 60_000,
        ).length,
      },
    };
  }

  /**
   * Per-exhibitor counts for the organisers (ADR-003). In LIVE mode the TV shows the same numbers, so reading them
   * is unremarkable. In FROZEN, HIDDEN and REVEAL the public deliberately cannot see them, so each organiser's
   * looking is recorded (at most once every five minutes per person, to keep the log readable).
   */
  async liveResults(actor: Actor, now: Date = new Date()): Promise<LiveResults> {
    const s = await loadSettings(this.db);
    const live = await liveStandings(this.db);
    const ids = live.categories.flatMap((c) => c.rows.map((r) => r.exhibitorId));
    const names = ids.length
      ? await this.db
          .select({ id: exhibitors.id, nameEn: exhibitors.nameEn })
          .from(exhibitors)
          .where(inArray(exhibitors.id, ids))
      : [];
    const nameOf = new Map(names.map((n) => [n.id, n.nameEn]));

    let audited = false;
    if (s.resultsVisibility !== 'LIVE') {
      const [recent] = await this.db
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, 'results.live.read'),
            eq(auditLog.actorLabel, actor.label),
            gt(auditLog.at, new Date(now.getTime() - LIVE_READ_AUDIT_EVERY_MS)),
          ),
        )
        .limit(1);
      if (!recent)
        await writeAudit(this.db, {
          adminId: actor.adminId,
          label: actor.label,
          action: 'results.live.read',
          entity: 'results',
          details: { mode: s.resultsVisibility },
          ip: actor.ip,
        });
      audited = true;
    }
    return {
      mode: s.resultsVisibility,
      audited,
      voters: live.voters,
      categories: live.categories.map((c) => ({
        categoryId: c.categoryId,
        total: c.total,
        rows: c.rows.map((r) => ({
          exhibitorId: r.exhibitorId,
          nameEn: nameOf.get(r.exhibitorId) ?? '',
          votes: r.votes,
        })),
      })),
    };
  }
}
