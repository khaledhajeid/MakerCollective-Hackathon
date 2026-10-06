import type {
  AccessStatus,
  CatalogResponse,
  ErrorCode,
  MyVotes,
  OtpRequest,
  SessionInfo,
  VoteRequest,
  VoteResponse,
  VotingWindowStatus,
} from '@mc/shared';

/** A failed call. `NETWORK` means the request never completed (offline / timeout) — safe to retry. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK',
    readonly details?: unknown,
  ) {
    super(code);
    this.name = 'ApiError';
  }
  get isNetwork() {
    return this.code === 'NETWORK';
  }
  /** `retryAfterSeconds` from a RATE_LIMITED answer, if present. */
  get retryAfterSeconds(): number | undefined {
    const d = this.details as { retryAfterSeconds?: unknown } | undefined;
    return typeof d?.retryAfterSeconds === 'number' ? d.retryAfterSeconds : undefined;
  }
}

const TIMEOUT_MS = 15_000;

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ApiError(0, 'NETWORK');
  }
  if (res.ok) return (await res.json()) as T;
  let code: ErrorCode = 'INTERNAL';
  let details: unknown;
  try {
    const parsed = (await res.json()) as { error?: { code?: ErrorCode; details?: unknown } };
    if (parsed.error?.code) code = parsed.error.code;
    details = parsed.error?.details;
  } catch {
    /* proxy error page etc. — keep INTERNAL */
  }
  // Gateways answer 502/503/504 while an API replica restarts: that is a retryable network-class failure.
  if (res.status === 502 || res.status === 503 || res.status === 504)
    throw new ApiError(res.status, 'NETWORK');
  throw new ApiError(res.status, code, details);
}

export const api = {
  accessStatus: () => request<AccessStatus>('GET', '/access/status'),
  votingStatus: () => request<VotingWindowStatus>('GET', '/voting/status'),
  session: () => request<SessionInfo>('GET', '/auth/session'),
  catalog: () => request<CatalogResponse>('GET', '/catalog'),
  myVotes: () => request<MyVotes>('GET', '/me/votes'),
  requestOtp: (body: OtpRequest) =>
    request<{
      challengeId: string;
      maskedPhone: string;
      expiresInSeconds: number;
      resendAfterSeconds: number;
    }>('POST', '/auth/otp/request', body),
  verifyOtp: (body: { challengeId: string; code: string }) =>
    request<{ visitor: NonNullable<SessionInfo['visitor']> }>('POST', '/auth/otp/verify', body),
  logout: () => request<{ ok: true }>('POST', '/auth/logout'),
  castVote: (body: VoteRequest) => request<VoteResponse>('POST', '/votes', body),
};
