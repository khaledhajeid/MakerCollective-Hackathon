import { describe, expect, it } from 'vitest';
import { testEnv } from '../../../test/helpers.js';
import { fillTemplate, httpProvider } from './adapters.js';

describe('http SMS adapter (ADR-004)', () => {
  const env = testEnv({
    SMS_PROVIDER: 'http',
    SMS_HTTP_URL: 'https://sms.example.org/v1/send',
    SMS_HTTP_AUTH_HEADER: 'Authorization: Bearer s3cret',
    SMS_HTTP_BODY_TEMPLATE: '{"to":"{to}","text":"{message}","meta":{"tags":["otp","{to}"]}}',
  });

  it('fills placeholders in values only — message text cannot break out of the JSON', async () => {
    const evil = 'x","admin":true,"y":"';
    let captured: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    await httpProvider(env, fetchImpl).send({ toE164: '+962791234567', toMasked: '', text: evil });
    const body = JSON.parse(captured!.init.body as string);
    expect(body).toEqual({
      to: '+962791234567',
      text: evil,
      meta: { tags: ['otp', '+962791234567'] },
    });
    expect(body.admin).toBeUndefined();
    expect(captured!.init.headers).toMatchObject({ Authorization: 'Bearer s3cret' });
    expect(captured!.init.redirect).toBe('error');
  });

  it('throws on a non-2xx gateway answer so the challenge is rolled back', async () => {
    const fetchImpl = (async () => new Response('no', { status: 503 })) as unknown as typeof fetch;
    await expect(
      httpProvider(env, fetchImpl).send({ toE164: '+9627', toMasked: '', text: 't' }),
    ).rejects.toThrow(/503/);
  });

  it('fillTemplate leaves non-string values untouched', () => {
    expect(
      fillTemplate({ n: 1, ok: true, nil: null, a: ['{to}'] }, { to: 'T', message: 'M' }),
    ).toEqual({ n: 1, ok: true, nil: null, a: ['T'] });
  });
});
