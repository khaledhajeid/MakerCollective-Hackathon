import type { ResultsFrame } from '@mc/shared';
import { describe, expect, it, vi } from 'vitest';
import { ResultsHub, type StreamClient } from './hub.js';
import type { ResultsService } from './service.js';

const frame = (mode: ResultsFrame['mode'], totalVotes: number | null): ResultsFrame => ({
  mode,
  eventName: 'MC2026',
  voting: { state: 'OPEN', opensAt: null, closesAt: null },
  frozenAt: null,
  totalVotes,
  voters: null,
  categories: [],
  spotlight: null,
});

const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as never;

/** A service whose frames are handed out by the test, one deferred computation at a time. */
function controlledService() {
  const pending: Array<{ resolve: (f: ResultsFrame) => void; reject: (e: Error) => void }> = [];
  const control = { failing: false };
  const service = {
    frame: vi.fn(
      () =>
        new Promise<ResultsFrame>((resolve, reject) => {
          if (control.failing) return reject(new Error('db down'));
          pending.push({ resolve, reject });
        }),
    ),
  } as unknown as ResultsService;
  return { service, pending, control };
}

function fakeClient(tokenId = 't1') {
  const received: string[] = [];
  let closed: string | undefined | null = null;
  const client: StreamClient = {
    tokenId,
    send: (chunk) => {
      received.push(chunk);
      return true;
    },
    close: async (reason) => {
      closed = reason ?? undefined;
    },
  };
  return {
    client,
    received,
    get closed() {
      return closed;
    },
    /** Frames received, in order (a chunk may carry several events). */
    modes: () =>
      received
        .join('')
        .split('\n\n')
        .filter((e) => e.startsWith('event: frame'))
        .map((e) => (JSON.parse(e.split('data: ')[1]!) as ResultsFrame).mode),
  };
}

const makeHub = (service: ResultsService, opts = {}) =>
  new ResultsHub(
    { service, databaseUrl: 'postgres://unused', activeTokenIds: async (ids) => new Set(ids), log },
    // A long freshness window: only the hub's own stale/dirty tracking may trigger a recompute for a new TV.
    { minIntervalMs: 1, freshMs: 60_000, ...opts },
  );

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('ResultsHub', () => {
  it('a change announced while a connecting TV is being served is not lost (no stale frame after a freeze)', async () => {
    const { service, pending } = controlledService();
    const hub = makeHub(service);
    const tv = fakeClient();

    const subscribed = hub.subscribe(tv.client); // starts computing — still LIVE in the database…
    await tick();
    hub.schedule(true); //            …the freeze commits and its NOTIFY arrives while nobody is registered
    pending[0]!.resolve(frame('LIVE', 99)); // the computation that began before the freeze finishes
    await tick();
    // The hub must discard that pre-freeze result and compute again before serving the TV.
    expect(pending).toHaveLength(2);
    expect(tv.received).toHaveLength(0);
    pending[1]!.resolve(frame('FROZEN', 4));
    await subscribed;

    expect(tv.modes()).toEqual(['FROZEN']);
    expect(tv.received.join('')).not.toContain('99');
  });

  it('a vote burst while a TV is connecting does not make the hub refuse it', async () => {
    const { service, pending } = controlledService();
    const hub = makeHub(service);
    const tv = fakeClient();
    const subscribed = hub.subscribe(tv.client);
    await tick();
    for (let i = 0; i < 50; i++) hub.schedule(false); // 50 votes land while the first frame is computed
    pending[0]!.resolve(frame('LIVE', 7));
    await subscribed; // served from that one computation, not refused or recomputed in a loop
    expect(tv.modes()).toEqual(['LIVE']);
    expect(pending).toHaveLength(1);
  });

  it('fails closed: a TV connecting while the frame cannot be computed is refused, not served an old frame', async () => {
    const { service, pending, control } = controlledService();
    const hub = makeHub(service);

    const first = fakeClient('a');
    const p1 = hub.subscribe(first.client);
    await tick();
    pending[0]!.resolve(frame('LIVE', 5));
    await p1;
    expect(first.modes()).toEqual(['LIVE']);

    // Later the database becomes unreachable (a freeze may have happened meanwhile) and a second TV connects.
    control.failing = true;
    hub.schedule(true);
    await tick();
    const second = fakeClient('b');
    await expect(hub.subscribe(second.client)).rejects.toThrow(/unavailable/);
    expect(second.received).toHaveLength(0);
    // The TV that was already watching simply keeps its last frame.
    expect(first.modes()).toEqual(['LIVE']);
  });

  it('coalesces a burst of vote notifications into one recomputation per window', async () => {
    const { service, pending } = controlledService();
    const hub = makeHub(service, { minIntervalMs: 30 });
    const tv = fakeClient();
    const p = hub.subscribe(tv.client);
    await tick();
    pending[0]!.resolve(frame('LIVE', 0));
    await p;
    const base = pending.length;

    for (let i = 0; i < 500; i++) hub.schedule(false); // 500 votes in a moment
    await new Promise((r) => setTimeout(r, 60));
    expect(pending.length - base).toBeLessThanOrEqual(2);
  });

  it('only broadcasts when the frame actually changed', async () => {
    const { service, pending } = controlledService();
    const hub = makeHub(service);
    const tv = fakeClient();
    const p = hub.subscribe(tv.client);
    await tick();
    pending[0]!.resolve(frame('LIVE', 1));
    await p;

    hub.schedule(true);
    await tick();
    pending[1]!.resolve(frame('LIVE', 1)); // identical
    await tick();
    hub.schedule(true);
    await tick();
    pending[2]!.resolve(frame('LIVE', 2)); // changed
    await tick();
    expect(tv.modes()).toHaveLength(2);
  });

  it('drops a TV whose socket stops accepting data, and caps the number of displays', async () => {
    const { service, pending } = controlledService();
    const hub = makeHub(service, { maxClients: 1 });
    const slow = fakeClient();
    let ok = true;
    slow.client.send = () => ok;
    const p = hub.subscribe(slow.client);
    await tick();
    pending[0]!.resolve(frame('LIVE', 1));
    await p;
    expect(hub.size).toBe(1);
    expect(hub.hasCapacity()).toBe(false);
    await expect(hub.subscribe(fakeClient('x').client)).rejects.toThrow(/too many/);

    ok = false;
    hub.schedule(true);
    await tick();
    pending[1]!.resolve(frame('LIVE', 2));
    await tick();
    expect(hub.size).toBe(0);
    expect(slow.closed).toBeUndefined(); // closed without a reason
  });

  it('close() ends every stream', async () => {
    const { service, pending } = controlledService();
    const hub = makeHub(service);
    const tv = fakeClient();
    const p = hub.subscribe(tv.client);
    await tick();
    pending[0]!.resolve(frame('LIVE', 1));
    await p;
    await hub.close();
    expect(tv.closed).toBeUndefined();
    expect(hub.size).toBe(0);
  });
});
