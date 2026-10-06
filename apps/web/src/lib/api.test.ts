import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, type ApiError } from './api';

const respond = (status: number, body: string, type = 'application/json') =>
  vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(body, { status, headers: { 'content-type': type } }));
const failure = async (p: Promise<unknown>) =>
  (await p.then(
    () => null,
    (e: unknown) => e,
  )) as ApiError;

afterEach(() => vi.restoreAllMocks());

describe('api client error mapping', () => {
  it('keeps the API error code on a 502 (SMS_UNAVAILABLE is a 502 from the API itself)', async () => {
    respond(502, JSON.stringify({ error: { code: 'SMS_UNAVAILABLE', message: 'x' } }));
    const e = await failure(api.session());
    expect(e.code).toBe('SMS_UNAVAILABLE');
    expect(e.isNetwork).toBe(false);
  });

  it.each([502, 503, 504])(
    'treats a body-less gateway %i as a retryable network failure',
    async (status) => {
      respond(status, '<html>Bad gateway</html>', 'text/html');
      expect((await failure(api.catalog())).isNetwork).toBe(true);
    },
  );

  it('treats a 200 with a non-JSON body (captive portal, stalled body) as a network failure', async () => {
    respond(200, '<html>Please log in to the Wi-Fi</html>', 'text/html');
    expect((await failure(api.accessStatus())).isNetwork).toBe(true);
  });

  it('maps a fetch rejection (offline, timeout) to NETWORK', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    expect((await failure(api.myVotes())).code).toBe('NETWORK');
  });

  it('exposes retryAfterSeconds from a rate-limit answer', async () => {
    respond(
      429,
      JSON.stringify({ error: { code: 'RATE_LIMITED', details: { retryAfterSeconds: 42 } } }),
    );
    expect((await failure(api.requestOtp({} as never))).retryAfterSeconds).toBe(42);
  });

  it('returns parsed JSON on success', async () => {
    respond(200, JSON.stringify({ state: 'OPEN', opensAt: null, closesAt: null }));
    expect(await api.votingStatus()).toMatchObject({ state: 'OPEN' });
  });
});
