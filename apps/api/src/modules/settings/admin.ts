import type { AdminSettings, SettingsPatch } from '@mc/shared/manage';
import { eq, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { settings } from '../../db/schema.js';
import { AppError, pgErrorCode } from '../../lib/errors.js';
import { compileCidrs } from '../../lib/ip.js';
import { changes, writeAudit } from '../admin/audit.js';
import type { Actor } from '../results/service.js';
import type { SettingsCache } from './cache.js';
import type { Settings } from './repository.js';

const TRACKED = [
  'eventName',
  'votingStatus',
  'votingOpensAt',
  'votingClosesAt',
  'accessMode',
  'venueCidrs',
  'wifiSsid',
  'allowedPhonePrefixes',
  'otpTtlSeconds',
  'otpMaxAttempts',
  'otpResendCooldownSeconds',
  'consentVersion',
] as const;

export function toAdminSettings(s: Settings): AdminSettings {
  return {
    eventName: s.eventName,
    votingStatus: s.votingStatus,
    votingOpensAt: s.votingOpensAt?.toISOString() ?? null,
    votingClosesAt: s.votingClosesAt?.toISOString() ?? null,
    accessMode: s.accessMode,
    venueCidrs: s.venueCidrs,
    wifiSsid: s.wifiSsid,
    wifiPassword: s.wifiPassword,
    allowedPhonePrefixes: s.allowedPhonePrefixes,
    otpTtlSeconds: s.otpTtlSeconds,
    otpMaxAttempts: s.otpMaxAttempts,
    otpResendCooldownSeconds: s.otpResendCooldownSeconds,
    consentVersion: s.consentVersion,
    version: s.version,
    updatedAt: s.updatedAt.toISOString(),
  };
}

/**
 * The event settings an organiser edits live: the voting window, the venue network gate, the Wi-Fi shown to turned-away
 * visitors, the phone prefixes and the OTP policy. One row, one transaction, an optimistic version check so two
 * organisers cannot silently overwrite each other, and an audit entry that records what changed (never the Wi-Fi
 * password). The writing replica refreshes its cache at once; the others pick the change up within the cache's 2 s.
 */
export class SettingsAdminService {
  constructor(
    private readonly db: Database,
    private readonly cache: SettingsCache,
  ) {}

  async get(): Promise<AdminSettings> {
    const [row] = await this.db.select().from(settings).where(eq(settings.id, 1));
    if (!row) throw new Error('settings row missing — run migrations');
    return toAdminSettings(row);
  }

  async update(patch: SettingsPatch, actor: Actor): Promise<AdminSettings> {
    const { version, ...fields } = patch;
    if (fields.venueCidrs) {
      const { rejected } = compileCidrs(fields.venueCidrs);
      if (rejected.length)
        throw new AppError(400, 'VALIDATION_FAILED', 'Some venue ranges are not valid', {
          rejected,
        });
    }
    try {
      const out = await this.db.transaction(async (tx) => {
        const [before] = await tx.select().from(settings).where(eq(settings.id, 1)).for('update');
        if (!before) throw new Error('settings row missing — run migrations');
        if (version !== undefined && version !== before.version)
          throw new AppError(
            409,
            'CONFLICT',
            'Someone else changed the settings. Reload to see their changes, then try again.',
            { currentVersion: before.version },
          );
        const { votingOpensAt, votingClosesAt, wifiPassword, ...rest } = fields;
        const [row] = await tx
          .update(settings)
          .set({
            ...rest,
            ...(wifiPassword !== undefined && { wifiPassword }),
            ...(votingOpensAt !== undefined && {
              votingOpensAt: votingOpensAt ? new Date(votingOpensAt) : null,
            }),
            ...(votingClosesAt !== undefined && {
              votingClosesAt: votingClosesAt ? new Date(votingClosesAt) : null,
            }),
            version: sql`${settings.version} + 1`,
            updatedAt: sql`now()`,
          })
          .where(eq(settings.id, 1))
          .returning();
        const after = toAdminSettings(row!);
        const was = toAdminSettings(before);
        await writeAudit(tx, {
          adminId: actor.adminId,
          label: actor.label,
          action: 'settings.update',
          entity: 'settings',
          entityId: '1',
          details: {
            changes: changes(was, after, TRACKED),
            // The Wi-Fi password is a secret shared with the room, not with the audit log.
            ...(wifiPassword !== undefined &&
              wifiPassword !== before.wifiPassword && {
                wifiPasswordChanged: true,
              }),
          },
          ip: actor.ip,
        });
        return after;
      });
      this.cache.invalidate();
      return out;
    } catch (err) {
      switch (pgErrorCode(err)) {
        case '22P02':
        case '22P03':
          throw new AppError(
            400,
            'VALIDATION_FAILED',
            'A venue range is not valid. Use an address such as 203.0.113.5 or a network such as 203.0.113.0/24.',
          );
        case '23514':
          throw new AppError(
            400,
            'VALIDATION_FAILED',
            'Voting must open before it closes, and every value must be inside its allowed range',
          );
        default:
          throw err;
      }
    }
  }
}
