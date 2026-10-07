import { DisplayTimeSchema, ResultsFrameSchema, type ResultsFrame } from '@mc/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { QUIET_MS, STALE_MS, newReveal, revealBaseline } from './model';

export type Auth = 'checking' | 'unpaired' | 'ready';
export type PairIssue = 'invalid' | 'revoked' | 'origin' | 'network' | null;
export type Link = 'connecting' | 'live' | 'offline';

const SESSION_URL = '/api/display/session';
const PAIR_URL = '/api/display/pair';
const STREAM_URL = '/api/display/stream';

const sleepRetry = 3_000;

/**
 * The pairing token in the address (`#t=…`), read ONCE and removed from the address bar at once. Reading it inside an
 * effect would lose it when React re-runs effects (development), turning a failed pairing into a silent session check.
 */
let fragmentToken: string | null | undefined;
function pairingFragment(): string | null {
  if (fragmentToken === undefined) {
    fragmentToken = new URLSearchParams(window.location.hash.slice(1)).get('t');
    if (fragmentToken) window.history.replaceState(null, '', window.location.pathname);
  }
  return fragmentToken;
}

/**
 * The TV's whole relationship with the server: pair once (token from the `#t=` link fragment or typed in), then
 * hold one Server-Sent-Events stream. The last frame always stays on screen — a dropped connection only changes
 * `link`, never blanks the room — and a revoked token returns the screen to pairing and drops its frame.
 */
export function useDisplay() {
  const [auth, setAuth] = useState<Auth>('checking');
  const [issue, setIssue] = useState<PairIssue>(null);
  const [pairing, setPairing] = useState(false);
  const [frame, setFrame] = useState<ResultsFrame | null>(null);
  const [link, setLink] = useState<Link>('connecting');
  const [offlineSince, setOfflineSince] = useState<number | null>(null);
  /** serverTime − clientTime (ms): TV clocks are often wrong, countdowns must follow the server. */
  const [clockOffset, setClockOffset] = useState(0);
  const [reveal, setReveal] = useState<{ categoryId: string; seq: number } | null>(null);
  const seen = useRef<number | null>(null);

  const unpair = useCallback((why: PairIssue) => {
    setFrame(null);
    setReveal(null);
    setIssue(why);
    setAuth('unpaired');
  }, []);

  const pairWith = useCallback(async (token: string): Promise<boolean> => {
    setPairing(true);
    try {
      const res = await fetch(PAIR_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      });
      if (res.ok) {
        setIssue(null);
        setAuth('ready');
        return true;
      }
      // 403 = the API refused this page's address (CSRF origin check): say so instead of "cannot reach the server".
      setIssue(
        res.status === 401 || res.status === 400
          ? 'invalid'
          : res.status === 403
            ? 'origin'
            : 'network',
      );
      setAuth('unpaired');
      return false;
    } catch {
      setIssue('network');
      setAuth('unpaired');
      return false;
    } finally {
      setPairing(false);
    }
  }, []);

  // 1) Who am I? A `#t=` fragment pairs immediately and is removed from the address bar.
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fragment = pairingFragment();

    const check = async () => {
      try {
        const res = await fetch(SESSION_URL);
        if (stop) return;
        if (res.ok) return setAuth('ready');
        if (res.status === 401) {
          setIssue(null);
          return setAuth('unpaired');
        }
      } catch {
        /* fall through to retry */
      }
      if (stop) return;
      setIssue('network');
      timer = setTimeout(check, sleepRetry);
    };

    void (async () => {
      if (fragment && (await pairWith(fragment))) return;
      if (!fragment) await check();
    })();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [pairWith]);

  // 2) Hold the stream while paired.
  useEffect(() => {
    if (auth !== 'ready') return;
    let es: EventSource | null = null;
    let closed = false;
    let lastEvent = Date.now();
    let reopen: ReturnType<typeof setTimeout> | undefined;
    let recheck: ReturnType<typeof setTimeout> | undefined;
    seen.current = null;

    /** `since` is when the silence began, so the room is told on time, not a further 5 s later. */
    const goOffline = (since = Date.now()) => {
      setLink('offline');
      setOfflineSince((s) => s ?? since);
    };

    /** EventSource cannot see HTTP status codes: ask the session endpoint whether the pairing was revoked. */
    const verifyPairing = () => {
      clearTimeout(recheck);
      recheck = setTimeout(async () => {
        try {
          const res = await fetch(SESSION_URL);
          if (!closed && res.status === 401) {
            es?.close();
            unpair('revoked');
          }
        } catch {
          /* still offline — the stream keeps retrying */
        }
      }, 4_000);
    };

    const open = () => {
      if (closed) return;
      es?.close();
      lastEvent = Date.now();
      const source = new EventSource(STREAM_URL);
      es = source;
      source.onopen = () => {
        setLink('live');
        setOfflineSince(null);
      };
      source.addEventListener('frame', (e) => {
        lastEvent = Date.now();
        let parsed;
        try {
          parsed = ResultsFrameSchema.safeParse(JSON.parse((e as MessageEvent<string>).data));
        } catch {
          return;
        }
        if (!parsed.success) return; // an unreadable frame never replaces a good one
        const f = parsed.data;
        const played = newReveal(seen.current, f);
        seen.current = revealBaseline(f);
        if (played) setReveal(played);
        setFrame(f);
        setLink('live');
        setOfflineSince(null);
      });
      source.addEventListener('time', (e) => {
        lastEvent = Date.now();
        // A heartbeat proves the link is alive again, even when no vote has changed the frame since.
        setLink('live');
        setOfflineSince(null);
        try {
          const t = DisplayTimeSchema.parse(JSON.parse((e as MessageEvent<string>).data));
          setClockOffset(Date.parse(t.serverTime) - Date.now());
        } catch {
          /* ignore a malformed heartbeat */
        }
      });
      source.addEventListener('revoked', () => {
        closed = true;
        source.close();
        unpair('revoked');
      });
      source.onerror = () => {
        goOffline();
        verifyPairing();
        // The browser retries on its own; if it gave up (non-event-stream reply), open a fresh stream.
        if (source.readyState === EventSource.CLOSED) {
          clearTimeout(reopen);
          reopen = setTimeout(open, sleepRetry);
        }
      };
    };

    // A silently dead connection (pulled cable, hung proxy) never fires onerror: judge it by the heartbeat.
    const watchdog = setInterval(() => {
      if (closed) return;
      const silence = Date.now() - lastEvent;
      if (silence > QUIET_MS) goOffline(lastEvent);
      if (silence > STALE_MS) open();
    }, 2_000);

    open();
    return () => {
      closed = true;
      clearInterval(watchdog);
      clearTimeout(reopen);
      clearTimeout(recheck);
      es?.close();
    };
  }, [auth, unpair]);

  return {
    auth,
    issue,
    pairing,
    pair: pairWith,
    frame,
    link,
    offlineSince,
    clockOffset,
    reveal,
    clearReveal: useCallback(() => setReveal(null), []),
  };
}
