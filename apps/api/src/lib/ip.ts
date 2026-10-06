import { BlockList, isIP } from 'node:net';

export interface ClientIp {
  /** Canonical text form (IPv4-mapped IPv6 collapsed to dotted IPv4, zone id stripped). */
  ip: string;
  family: 4 | 6;
}

const MAPPED_DOTTED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;
const MAPPED_HEX = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i;

/**
 * Canonicalises an address as reported by the socket / trusted proxy chain.
 * Dual-stack listeners report IPv4 clients as `::ffff:a.b.c.d`; without collapsing them an
 * IPv4 venue range would never match.
 */
export function parseIp(raw: string | undefined | null): ClientIp | null {
  if (!raw) return null;
  const noZone = raw.trim().split('%')[0] ?? '';
  const dotted = MAPPED_DOTTED.exec(noZone);
  if (dotted?.[1] && isIP(dotted[1]) === 4) return { ip: dotted[1], family: 4 };
  const hex = MAPPED_HEX.exec(noZone);
  if (hex?.[1] && hex[2]) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return { ip: `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`, family: 4 };
  }
  const family = isIP(noZone);
  return family === 4 || family === 6 ? { ip: noZone, family } : null;
}

export interface CidrMatcher {
  has(client: ClientIp): boolean;
  /** CIDRs that could not be parsed (should be impossible: Postgres `cidr` validates). */
  readonly rejected: string[];
}

/** Compiles venue ranges (IPv4 and IPv6 mixed) once; matching is then O(ranges) with no allocation. */
export function compileCidrs(cidrs: readonly string[]): CidrMatcher {
  const list = new BlockList();
  const rejected: string[] = [];
  for (const entry of cidrs) {
    const [addr, prefixText, ...extra] = entry.trim().split('/');
    const parsed = parseIp(addr);
    // A mapped range such as ::ffff:10.0.0.0/104 is an IPv4 range whose prefix counts the 96 mapped bits.
    const isMapped = parsed?.family === 4 && (addr ?? '').includes(':');
    const raw =
      prefixText === undefined
        ? parsed?.family === 4 && !isMapped
          ? 32
          : 128
        : Number(prefixText);
    const prefix = isMapped ? raw - 96 : raw;
    const max = parsed?.family === 4 ? 32 : 128;
    if (!parsed || extra.length || !Number.isInteger(prefix) || prefix < 0 || prefix > max) {
      rejected.push(entry);
      continue;
    }
    list.addSubnet(parsed.ip, prefix, parsed.family === 4 ? 'ipv4' : 'ipv6');
  }
  return {
    rejected,
    has: (client) => list.check(client.ip, client.family === 4 ? 'ipv4' : 'ipv6'),
  };
}

/**
 * Bucket key for per-client rate limits. IPv6 users own a whole /64, so keying on the full address would let
 * one device rotate through 2^64 identities; collapse to the /64. IPv4 stays per address.
 */
export function rateKey(client: ClientIp): string {
  if (client.family === 4) return client.ip;
  const [head = '', tail = ''] = client.ip.toLowerCase().split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = client.ip.includes('::')
    ? [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t]
    : h;
  return (
    groups
      .slice(0, 4)
      .map((g) => g.replace(/^0+(?=.)/, ''))
      .join(':') + '::/64'
  );
}
