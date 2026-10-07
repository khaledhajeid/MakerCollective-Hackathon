import type { AuditEntry } from '@mc/shared';
import { desc, lt } from 'drizzle-orm';
import type { Database, Tx } from '../../db/client.js';
import { auditLog } from '../../db/schema.js';

export interface AuditRecord {
  adminId: string | null;
  /** Who, readable without a join: `admin:<username>`, `cli:operator`, `system`. */
  label: string;
  action: string;
  entity?: string;
  entityId?: string;
  /** Never put secrets, codes, passwords or PII in here: the log is readable by every SUPER_ADMIN. */
  details?: Record<string, unknown>;
  ip?: string | null;
}

/** Written in the caller's transaction where there is one, so a change and its record commit (or fail) together. */
export async function writeAudit(executor: Database | Tx, r: AuditRecord): Promise<void> {
  await executor.insert(auditLog).values({
    actorAdminId: r.adminId,
    actorLabel: r.label,
    action: r.action,
    entity: r.entity ?? null,
    entityId: r.entityId ?? null,
    details: r.details ?? null,
    ip: r.ip ?? null,
  });
}

/**
 * What changed between two versions of a record, for the audit trail: only the fields that differ, each as
 * `{from, to}`, long text clipped. Secrets are never passed here (callers list the fields they want compared).
 */
export function changes<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  fields: readonly (keyof T)[],
): Record<string, { from: unknown; to: unknown }> {
  const clip = (v: unknown) =>
    typeof v === 'string' && v.length > 120 ? `${v.slice(0, 120)}…` : v;
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const f of fields) {
    if (after[f] === undefined) continue;
    if (JSON.stringify(before[f]) === JSON.stringify(after[f])) continue;
    out[String(f)] = { from: clip(before[f]), to: clip(after[f]) };
  }
  return out;
}

export class AuditReader {
  constructor(private readonly db: Database) {}

  /** Newest first, keyset-paged (stable while new rows arrive, unlike OFFSET). */
  async page(
    limit: number,
    before?: number,
  ): Promise<{ entries: AuditEntry[]; nextBefore: number | null }> {
    const rows = await this.db
      .select()
      .from(auditLog)
      .where(before ? lt(auditLog.id, before) : undefined)
      .orderBy(desc(auditLog.id))
      .limit(limit + 1);
    const more = rows.length > limit;
    const slice = more ? rows.slice(0, limit) : rows;
    return {
      entries: slice.map((r) => ({
        id: r.id,
        at: r.at.toISOString(),
        actor: r.actorLabel,
        action: r.action,
        entity: r.entity,
        entityId: r.entityId,
        details: r.details ?? null,
        ip: r.ip,
      })),
      nextBefore: more ? slice[slice.length - 1]!.id : null,
    };
  }
}
