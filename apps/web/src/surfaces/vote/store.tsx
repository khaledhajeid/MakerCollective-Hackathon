import type {
  AccessStatus,
  CatalogCategory,
  SessionInfo,
  Vote,
  VoteResponse,
  VotingWindowStatus,
} from '@mc/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, api } from '../../lib/api';
import { takePreboot } from '../../lib/preboot';

type Visitor = NonNullable<SessionInfo['visitor']>;

/** What the code screen needs to resume after the tab reloads (iOS often reloads Safari when you return from Messages). */
export interface Challenge {
  id: string;
  maskedPhone: string;
  expiresAt: number;
  resendAt: number;
}
const CHALLENGE_KEY = 'mc_challenge';

function loadChallenge(): Challenge | null {
  try {
    const raw = sessionStorage.getItem(CHALLENGE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Challenge;
    return c.expiresAt > Date.now() - 60_000 ? c : null; // masked phone + opaque id only — no PII in storage
  } catch {
    return null;
  }
}

/** In-memory only: name/phone are PII and are never written to storage. */
export interface Draft {
  name: string;
  phone: string;
  voteConsent: boolean;
  outreachConsent: boolean;
}
const EMPTY_DRAFT: Draft = { name: '', phone: '', voteConsent: false, outreachConsent: false };

interface Ready<T> {
  status: 'loading' | 'ready' | 'error';
  data: T | null;
  error: ApiError | null;
}
const loading = <T,>(): Ready<T> => ({ status: 'loading', data: null, error: null });

interface Store {
  boot: 'loading' | 'ready' | 'error';
  bootError: ApiError | null;
  access: AccessStatus | null;
  voting: VotingWindowStatus | null;
  visitor: Visitor | null;
  categories: Ready<CatalogCategory[]>;
  /** categoryId → the visitor's vote. */
  votes: Record<string, Vote>;
  online: boolean;
  /** The visitor's earlier votes could not be loaded (shown on the hub with a retry). */
  votesError: boolean;
  refreshVotes: () => Promise<void>;
  /** True after the server said the session ended while the visitor was mid-flow (vote refused with 401). */
  sessionEnded: boolean;
  challenge: Challenge | null;
  draft: Draft;
  setDraft: (d: Draft) => void;
  setChallenge: (c: Challenge | null) => void;
  retryBoot: () => void;
  recheckAccess: () => Promise<AccessStatus | null>;
  refreshVoting: () => Promise<void>;
  refreshCatalog: () => Promise<void>;
  signedIn: (v: Visitor) => Promise<void>;
  signOut: () => Promise<void>;
  castVote: (categoryId: string, exhibitorId: string) => Promise<VoteResponse>;
}

/** Votes cast in categories that are still in the catalog (a vote in a category an organiser archived does not count). */
export const votedCount = (cats: readonly CatalogCategory[], votes: Record<string, Vote>): number =>
  cats.filter((c) => votes[c.id]).length;

const Ctx = createContext<Store | null>(null);

export function VoterProvider({ children }: { children: ReactNode }) {
  const [boot, setBoot] = useState<Store['boot']>('loading');
  const [bootError, setBootError] = useState<ApiError | null>(null);
  const [access, setAccess] = useState<AccessStatus | null>(null);
  const [voting, setVoting] = useState<VotingWindowStatus | null>(null);
  const [visitor, setVisitor] = useState<Visitor | null>(null);
  const [categories, setCategories] = useState<Ready<CatalogCategory[]>>(loading);
  const [votes, setVotes] = useState<Record<string, Vote>>({});
  const [online, setOnline] = useState(() => navigator.onLine);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [votesError, setVotesError] = useState(false);
  const signedInRef = useRef(false);
  const [challenge, setChallengeState] = useState<Challenge | null>(loadChallenge);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  const setChallenge = useCallback((c: Challenge | null) => {
    setChallengeState(c);
    try {
      if (c) sessionStorage.setItem(CHALLENGE_KEY, JSON.stringify(c));
      else sessionStorage.removeItem(CHALLENGE_KEY);
    } catch {
      /* storage blocked: the in-memory copy still works for this page load */
    }
  }, []);

  /** Never throws: a failure flips `votesError` (the hub says so and offers a retry) instead of silently showing 0 votes. */
  const loadVotes = useCallback(async () => {
    try {
      const r = await api.myVotes();
      setVotes(Object.fromEntries(r.votes.map((v) => [v.categoryId, v])));
      setVotesError(false);
    } catch {
      setVotesError(true);
    }
  }, []);

  const refreshCatalog = useCallback(async () => {
    try {
      const r = await api.catalog();
      setCategories({ status: 'ready', data: r.categories, error: null });
    } catch (e) {
      setCategories((prev) => ({
        status: prev.data ? 'ready' : 'error', // keep showing the last good catalog on a flaky network
        data: prev.data,
        error: e instanceof ApiError ? e : new ApiError(0, 'NETWORK'),
      }));
    }
  }, []);

  const refreshVoting = useCallback(async () => {
    try {
      setVoting(await api.votingStatus());
    } catch {
      /* keep the previous state; the next poll corrects it */
    }
  }, []);

  const recheckAccess = useCallback(async () => {
    try {
      const a = await api.accessStatus();
      setAccess(a);
      return a;
    } catch {
      return null;
    }
  }, []);

  const runBoot = useCallback(async () => {
    setBoot('loading');
    setBootError(null);
    try {
      // First load: reuse the reads the entry script already started. Retries fetch fresh.
      const early = takePreboot();
      const [a, v, s] = await Promise.all([
        early?.access ?? api.accessStatus(),
        early?.voting ?? api.votingStatus(),
        early?.session ?? api.session(),
      ]);
      setAccess(a);
      setVoting(v);
      setVisitor(s.authenticated ? s.visitor : null);
      if (early) {
        early.catalog.then(
          (r) => setCategories({ status: 'ready', data: r.categories, error: null }),
          () => void refreshCatalog(),
        );
      } else void refreshCatalog();
      if (s.authenticated) await loadVotes();
      setBoot('ready');
    } catch (e) {
      setBootError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK'));
      setBoot('error');
    }
  }, [loadVotes, refreshCatalog]);

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return; // StrictMode double-invoke guard: one boot, not two
    started.current = true;
    void runBoot();
  }, [runBoot]);

  // Connectivity + freshness: re-check when the tab is shown again (returning from Wi-Fi settings or Messages).
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    const visible = () => {
      if (document.visibilityState !== 'visible') return;
      void refreshVoting();
      void refreshCatalog();
      void recheckAccess();
      if (signedInRef.current) void loadVotes();
    };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    document.addEventListener('visibilitychange', visible);
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshVoting();
    }, 45_000);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      document.removeEventListener('visibilitychange', visible);
      window.clearInterval(poll);
    };
  }, [loadVotes, recheckAccess, refreshCatalog, refreshVoting]);

  useEffect(() => {
    signedInRef.current = visitor !== null;
  }, [visitor]);

  const signedIn = useCallback(
    async (v: Visitor) => {
      setVisitor(v);
      setSessionEnded(false);
      setChallenge(null);
      setDraft(EMPTY_DRAFT);
      await loadVotes();
    },
    [loadVotes, setChallenge],
  );

  const signOut = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setVisitor(null);
    setVotes({});
    setChallenge(null);
  }, [setChallenge]);

  const castVote = useCallback(
    async (categoryId: string, exhibitorId: string) => {
      try {
        const r = await api.castVote({ categoryId, exhibitorId });
        setVotes((prev) => ({ ...prev, [categoryId]: r.vote }));
        return r;
      } catch (e) {
        if (e instanceof ApiError) {
          // Server truth wins: a conflict means a vote exists; a closed window / lost session must update the UI.
          if (e.code === 'ALREADY_VOTED') void loadVotes();
          if (e.code === 'VOTING_NOT_OPEN') void refreshVoting();
          if (e.code === 'UNAUTHENTICATED') {
            setVisitor(null);
            setSessionEnded(true);
          }
          if (e.code === 'NOT_ON_VENUE_NETWORK') void recheckAccess();
        }
        throw e;
      }
    },
    [loadVotes, recheckAccess, refreshVoting],
  );

  const value = useMemo<Store>(
    () => ({
      boot,
      bootError,
      access,
      voting,
      visitor,
      categories,
      votes,
      online,
      sessionEnded,
      votesError,
      refreshVotes: loadVotes,
      challenge,
      draft,
      setDraft,
      setChallenge,
      retryBoot: () => void runBoot(),
      recheckAccess,
      refreshVoting,
      refreshCatalog,
      signedIn,
      signOut,
      castVote,
    }),
    [
      boot,
      bootError,
      access,
      voting,
      visitor,
      categories,
      votes,
      online,
      sessionEnded,
      votesError,
      loadVotes,
      challenge,
      draft,
      setChallenge,
      runBoot,
      recheckAccess,
      refreshVoting,
      refreshCatalog,
      signedIn,
      signOut,
      castVote,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useVoter(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error('useVoter outside VoterProvider');
  return v;
}
