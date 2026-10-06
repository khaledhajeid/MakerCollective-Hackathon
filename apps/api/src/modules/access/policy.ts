import type { AccessMode } from '@mc/shared';
import { compileCidrs, parseIp, type CidrMatcher, type ClientIp } from '../../lib/ip.js';
import type { Settings } from '../settings/repository.js';

export interface AccessDecision {
  allowed: boolean;
  mode: AccessMode;
  client: ClientIp | null;
  /** Why access was refused (logs/admin diagnostics only — never echoed to visitors). */
  reason: 'ok' | 'gate_off' | 'no_ranges_configured' | 'outside_venue' | 'unparseable_ip';
}

/**
 * Venue network gate (ADR-002). Pure decision over a settings snapshot; the compiled range matcher is
 * memoised per distinct range list so the hot path allocates nothing.
 */
export class AccessPolicy {
  private compiled: { key: string; matcher: CidrMatcher } | null = null;

  constructor(private readonly getSettings: () => Promise<Settings>) {}

  private matcherFor(cidrs: string[]): CidrMatcher {
    const key = cidrs.join(',');
    if (this.compiled?.key !== key) this.compiled = { key, matcher: compileCidrs(cidrs) };
    return this.compiled.matcher;
  }

  async wifiSsid(): Promise<string | null> {
    return (await this.getSettings()).wifiSsid;
  }

  /** `rawIp` must be Fastify's `request.ip` — already resolved through the trusted-proxy chain only. */
  async evaluate(rawIp: string | undefined): Promise<AccessDecision> {
    const s = await this.getSettings();
    const mode = s.accessMode;
    const client = parseIp(rawIp);
    if (mode === 'OFF') return { allowed: true, mode, client, reason: 'gate_off' };
    if (!client) return { allowed: false, mode, client, reason: 'unparseable_ip' };
    if (s.venueCidrs.length === 0)
      return { allowed: false, mode, client, reason: 'no_ranges_configured' };
    return this.matcherFor(s.venueCidrs).has(client)
      ? { allowed: true, mode, client, reason: 'ok' }
      : { allowed: false, mode, client, reason: 'outside_venue' };
  }
}
