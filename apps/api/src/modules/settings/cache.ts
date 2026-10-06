import type { Database } from '../../db/client.js';
import { loadSettings, type Settings } from './repository.js';

/**
 * Per-replica settings snapshot. Settings are read on every OTP/vote request by up to 1,000 phones, so the
 * hot path must not hit Postgres each time; a short TTL keeps admin changes (venue ranges, OTP policy,
 * voting window) effective within seconds. Concurrent refreshes are coalesced into one query.
 */
export class SettingsCache {
  private value: { settings: Settings; at: number } | null = null;
  private loading: Promise<Settings> | null = null;

  constructor(
    private readonly db: Database,
    private readonly ttlMs = 2_000,
    private readonly now: () => number = Date.now,
  ) {}

  async get(): Promise<Settings> {
    if (this.value && this.now() - this.value.at < this.ttlMs) return this.value.settings;
    this.loading ??= loadSettings(this.db)
      .then((settings) => {
        this.value = { settings, at: this.now() };
        return settings;
      })
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  /** Admin writes call this so the writing replica sees its own change immediately. */
  invalidate(): void {
    this.value = null;
  }
}
