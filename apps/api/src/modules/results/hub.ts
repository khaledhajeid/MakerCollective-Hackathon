import pg from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import type { ResultsService } from './service.js';

/** One open SSE connection, as the hub sees it (the HTTP layer owns the socket). */
export interface StreamClient {
  tokenId: string;
  /** Returns false when the socket is gone or too far behind to keep up. */
  send(chunk: string): boolean;
  /**
   * Ends the stream (a reason is sent to the TV first so it can react, e.g. fall back to pairing).
   * Resolves once the socket has flushed, so a shutdown can wait for connections to become idle.
   */
  close(reason?: 'revoked'): Promise<void>;
}

export interface HubOptions {
  /** Minimum gap between recomputations during a vote burst (the ≤ 1 s coalescing window). */
  minIntervalMs: number;
  /** Safety net: recompute this often even with no notification (missed NOTIFY, clock-driven changes). */
  resyncMs: number;
  heartbeatMs: number;
  /** A computation younger than this is reused for a new subscriber. */
  freshMs: number;
  maxClients: number;
}

const DEFAULTS: HubOptions = {
  minIntervalMs: 1_000,
  resyncMs: 5_000,
  heartbeatMs: 5_000,
  freshMs: 250,
  maxClients: 200,
};

export const CHANNEL = 'mc_results';

const sse = (event: string, data: string) => `event: ${event}\ndata: ${data}\n\n`;

/**
 * Per-replica fan-out of results frames to TVs (plan §3.2).
 *
 *  Postgres NOTIFY (trigger on votes/settings/catalog/display_tokens) ─▶ LISTEN connection ─▶ mark dirty
 *  ─▶ throttled recompute (leading edge, then at most one per `minIntervalMs`) ─▶ broadcast only if changed.
 *
 * - Votes are coalesced: 1,000 votes in a second cost one query, not 1,000.
 * - A settings change (Blind Hour) is URGENT: it recomputes immediately instead of waiting out the window.
 * - The frame is always produced by ResultsService.frame(), which is where ADR-003 is enforced; the hub never
 *   touches vote counts itself, and a replica holding no TV does no work at all.
 * - Nothing here is the source of truth: after a missed notification, a dropped LISTEN connection or an API
 *   restart, the next resync or the next TV connection rebuilds the frame from the database.
 */
export class ResultsHub {
  private readonly opts: HubOptions;
  private readonly clients = new Set<StreamClient>();
  private lastJson: string | null = null;
  private lastComputedAt = 0;
  private stale = true;

  private dirty = false;
  /** A mode/window/catalog change (not a vote) was announced: a frame computed before it is out of date. */
  private urgentDirty = false;
  private urgentPending = false;
  private running: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private lastStart = 0;

  private intervals: NodeJS.Timeout[] = [];
  private listener: pg.Client | null = null;
  private reconnect: NodeJS.Timeout | null = null;
  private backoffMs = 500;
  private closed = false;

  constructor(
    private readonly deps: {
      service: ResultsService;
      databaseUrl: string;
      activeTokenIds: (ids: string[]) => Promise<Set<string>>;
      log: FastifyBaseLogger;
      now?: () => number;
    },
    options: Partial<HubOptions> = {},
  ) {
    this.opts = { ...DEFAULTS, ...options };
  }

  private now = () => (this.deps.now ?? Date.now)();

  get size(): number {
    return this.clients.size;
  }

  hasCapacity(): boolean {
    return this.clients.size < this.opts.maxClients;
  }

  /** Begin listening. Never throws: if Postgres is briefly unreachable the listener retries with backoff. */
  async start(): Promise<void> {
    if (this.intervals.length || this.closed) return;
    const every = (ms: number, fn: () => void) => {
      const t = setInterval(fn, ms);
      t.unref();
      this.intervals.push(t);
    };
    every(this.opts.resyncMs, () => {
      this.schedule(false);
      void this.dropRevoked();
    });
    every(this.opts.heartbeatMs, () =>
      this.broadcast(
        sse('time', JSON.stringify({ serverTime: new Date(this.now()).toISOString() })),
      ),
    );
    await this.connectListener();
  }

  /**
   * Registers a TV and sends it the current frame first. The frame is recomputed (not read from a stale
   * cache) unless one was computed within `freshMs`, so a TV that connects right after a freeze can never be
   * handed the pre-freeze numbers.
   */
  async subscribe(client: StreamClient): Promise<() => void> {
    if (this.closed) throw new Error('shutting down');
    if (!this.hasCapacity()) throw new Error('too many displays');
    // Recompute until the frame is current. A change announced WHILE we compute leaves `stale` set (the
    // notification cannot be lost just because this TV is not registered yet), so go round again.
    for (
      let i = 0;
      i < 4 && (this.stale || this.now() - this.lastComputedAt > this.opts.freshMs);
      i++
    )
      await this.refresh();
    // Fail closed: if the database could not be read, the cached frame may predate a freeze — send nothing and
    // let the TV's automatic reconnect try again, rather than risk showing numbers that should now be sealed.
    if (this.stale || !this.lastJson) throw new Error('results unavailable');
    // The awaits above let other connects and a shutdown overtake us: decide again, now, with nothing left to await.
    if (this.closed) throw new Error('shutting down');
    if (!this.hasCapacity()) throw new Error('too many displays');
    // Re-read AFTER the await: a broadcast may have happened meanwhile, and this client now receives every later one.
    this.clients.add(client);
    // The server clock goes first-class with the first frame: TV clocks are often wrong and the countdown needs it.
    const hello =
      sse('frame', this.lastJson) +
      sse('time', JSON.stringify({ serverTime: new Date(this.now()).toISOString() }));
    if (!client.send(hello)) {
      this.clients.delete(client);
      client.close();
    }
    return () => {
      this.clients.delete(client);
    };
  }

  /** A change was announced by Postgres (or the safety net fired). `urgent` skips the coalescing window. */
  schedule(urgent: boolean): void {
    if (this.closed) return;
    // Always record the announcement, even with nobody connected: a TV may be mid-connect right now.
    this.dirty = true;
    if (urgent) this.urgentDirty = true;
    if (this.clients.size === 0) {
      // Nobody to push to. A mode change makes the cached frame unsafe; votes only age it (a subscriber
      // recomputes anyway once the frame is older than `freshMs`).
      if (urgent) this.stale = true;
      return;
    }
    if (this.running) {
      this.urgentPending ||= urgent;
      return;
    }
    if (urgent) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      void this.refresh();
      return;
    }
    if (this.timer) return;
    const wait = Math.max(0, this.opts.minIntervalMs - (this.now() - this.lastStart));
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, wait);
    this.timer.unref();
  }

  /** Single-flight recompute; broadcasts when the frame changed. Errors keep the last good frame on screen. */
  private refresh(): Promise<void> {
    this.running ??= (async () => {
      // This computation reflects everything announced before it started; later announcements re-arm `dirty`.
      this.dirty = false;
      this.urgentDirty = false;
      this.lastStart = this.now();
      try {
        const frame = await this.deps.service.frame(new Date(this.now()));
        const json = JSON.stringify(frame);
        this.lastComputedAt = this.now();
        // A mode change announced while we were reading makes this frame unsafe to serve. Votes do not: a frame
        // computed a few milliseconds ago is as good as one computed now, and refusing TVs during a vote burst
        // would be worse than showing the count from a moment earlier.
        this.stale = this.urgentDirty;
        if (json !== this.lastJson) {
          this.lastJson = json;
          this.broadcast(sse('frame', json));
        }
      } catch (err) {
        this.stale = true;
        // The failed read must not be forgotten: re-arm so the throttle retries in about a second, instead of
        // waiting for the next resync while a change (a freeze, say) is still unseen.
        this.dirty = true;
        this.deps.log.error({ err }, 'results frame failed — retrying');
      } finally {
        this.running = null;
        if (this.dirty && !this.closed) {
          const urgent = this.urgentPending;
          this.urgentPending = false;
          this.schedule(urgent);
        }
      }
    })();
    return this.running;
  }

  private broadcast(chunk: string): void {
    for (const c of this.clients) {
      if (!c.send(chunk)) {
        this.clients.delete(c);
        c.close();
      }
    }
  }

  private async dropRevoked(): Promise<void> {
    if (!this.clients.size) return;
    try {
      const ids = [...new Set([...this.clients].map((c) => c.tokenId))];
      const active = await this.deps.activeTokenIds(ids);
      for (const c of [...this.clients]) {
        if (!active.has(c.tokenId)) {
          this.clients.delete(c);
          c.close('revoked');
        }
      }
    } catch (err) {
      this.deps.log.warn({ err }, 'display revocation check failed — retrying');
    }
  }

  private onNotification(tag: string | undefined): void {
    // A token was revoked or deleted: close those streams. It changes no frame, so nothing is recomputed.
    if (tag === 'display') return void this.dropRevoked();
    // Mode / window / catalog changes must reach the TVs at once; a vote only needs the coalesced path.
    this.schedule(tag !== 'votes');
  }

  private async connectListener(): Promise<void> {
    if (this.closed) return;
    const client = new pg.Client({
      connectionString: this.deps.databaseUrl,
      keepAlive: true,
      application_name: 'mc-results-listener',
    });
    let lost = false;
    const lose = (why: string) => {
      if (lost) return;
      lost = true;
      if (this.listener === client) this.listener = null;
      client.removeAllListeners();
      client.on('error', () => undefined);
      void client.end().catch(() => undefined);
      if (this.closed) return;
      this.deps.log.warn(
        { why, retryInMs: this.backoffMs },
        'results listener lost — reconnecting',
      );
      this.reconnect = setTimeout(() => void this.connectListener(), this.backoffMs);
      this.reconnect.unref();
      // Exponential backoff with a ceiling; jitter keeps two replicas from reconnecting in lockstep.
      this.backoffMs = Math.min(10_000, this.backoffMs * 2) + Math.floor(Math.random() * 250);
    };
    client.on('notification', (m) => this.onNotification(m.payload));
    client.on('error', (err) => lose(err.message));
    client.on('end', () => lose('connection ended'));
    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
      this.listener = client;
      this.backoffMs = 500;
      // Anything announced while we were not listening was missed: rebuild from the database now.
      this.schedule(true);
    } catch (err) {
      lose(String(err));
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const t of this.intervals) clearInterval(t);
    this.intervals = [];
    if (this.timer) clearTimeout(this.timer);
    if (this.reconnect) clearTimeout(this.reconnect);
    const ending = [...this.clients].map((c) => c.close());
    this.clients.clear();
    await Promise.allSettled(ending);
    const l = this.listener;
    this.listener = null;
    if (l) {
      l.removeAllListeners();
      l.on('error', () => undefined);
      await l.end().catch(() => undefined);
    }
    await this.running?.catch(() => undefined);
  }
}
