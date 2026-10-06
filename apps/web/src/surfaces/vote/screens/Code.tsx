import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../../design-system/Button';
import { Icon } from '../../../design-system/Icon';
import { useI18n } from '../../../i18n';
import { ApiError, api } from '../../../lib/api';
import { haptic } from '../../../lib/haptics';
import { ltr } from '../../../lib/bidi';
import { navigate } from '../../../lib/nav';
import { ActionBar, TopBar } from '../components/Chrome';
import { OtpInput } from '../components/OtpInput';
import { errorMessage } from '../errors';
import { useVoter } from '../store';

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** A ticking clock (twice a second) so countdowns and expiry re-evaluate without reading Date.now() in render. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

/** ③ The code. Autofill (iOS) and WebOTP (Android) usually make this a zero-typing step. */
export function Code() {
  const { d, locale, fmt } = useI18n();
  const { challenge, setChallenge, draft, signedIn, recheckAccess } = useVoter();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);

  const now = useNow();
  const resendIn = Math.max(0, Math.ceil(((challenge?.resendAt ?? 0) - now) / 1000));
  const expired = challenge ? challenge.expiresAt < now : true;

  const verify = useCallback(
    async (value: string) => {
      if (!challenge || submitting.current) return;
      if (value.length !== 6) {
        setError(d.code.errIncomplete);
        return;
      }
      submitting.current = true;
      setBusy(true);
      setError(null);
      try {
        const r = await api.verifyOtp({ challengeId: challenge.id, code: value });
        haptic('success');
        await signedIn(r.visitor);
        navigate('/vote', { replace: true, dir: 'forward' });
      } catch (err) {
        haptic('warn');
        if (err instanceof ApiError && err.code === 'NOT_ON_VENUE_NETWORK') void recheckAccess();
        setError(
          err instanceof ApiError && err.code === 'OTP_INVALID'
            ? d.code.errInvalid
            : err instanceof ApiError && err.code === 'OTP_EXPIRED'
              ? d.code.expired
              : err instanceof ApiError && err.code === 'OTP_LOCKED'
                ? d.code.errLocked
                : errorMessage(err, d, fmt),
        );
        setShake((n) => n + 1);
        setCode('');
        input.current?.focus();
      } finally {
        submitting.current = false;
        setBusy(false);
      }
    },
    [challenge, d, fmt, recheckAccess, signedIn],
  );

  // No challenge (cleared storage, new tab): start over from the details screen.
  useEffect(() => {
    if (!challenge) navigate('/vote/details', { replace: true });
  }, [challenge]);

  // Android Chrome WebOTP: the SMS ends with "@host #123456", so the browser can hand us the code directly.
  useEffect(() => {
    if (!challenge || !('OTPCredential' in window)) return;
    const ac = new AbortController();
    (navigator.credentials as { get: (o: unknown) => Promise<{ code?: string } | null> })
      .get({ otp: { transport: ['sms'] }, signal: ac.signal })
      .then((cred) => {
        if (cred?.code) {
          setCode(cred.code);
          void verify(cred.code);
        }
      })
      .catch(() => undefined);
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge?.id]);

  const resend = async () => {
    if (!draft.name || !draft.phone) {
      // The details only live in memory; after a reload we cannot resend, so ask for them again.
      setChallenge(null);
      navigate('/vote/details', { replace: true });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.requestOtp({
        name: draft.name.trim(),
        phone: `+962${draft.phone}`,
        voteConsent: draft.voteConsent,
        outreachConsent: draft.outreachConsent,
        locale,
      });
      const now = Date.now();
      setChallenge({
        id: r.challengeId,
        maskedPhone: r.maskedPhone,
        expiresAt: now + r.expiresInSeconds * 1000,
        resendAt: now + r.resendAfterSeconds * 1000,
      });
      setCode('');
      setNotice(d.code.sentAgain);
    } catch (err) {
      setError(errorMessage(err, d, fmt));
    } finally {
      setBusy(false);
    }
  };

  if (!challenge) return null;
  const message = error ?? (expired ? d.code.expired : null);

  return (
    <form
      className="flex min-h-dvh flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        void verify(code);
      }}
    >
      <TopBar back="/vote/details" />
      <div className="flex-1 space-y-7 px-5 pt-6">
        <div className="space-y-2">
          <h1 className="t-title text-navy" tabIndex={-1} data-screen-title>
            {d.code.title}
          </h1>
          <p className="t-body text-muted">
            {fmt(d.code.subtitle, { phone: ltr(challenge.maskedPhone) })}
          </p>
        </div>

        <div key={shake} className={shake ? 'shake' : ''}>
          <OtpInput
            ref={input}
            value={code}
            onChange={(v) => {
              setCode(v);
              setError(null);
              setNotice(null);
              if (v.length === 6) void verify(v);
            }}
            label={d.code.label}
            disabled={busy}
            invalid={!!error}
            describedBy="otp-msg"
          />
        </div>

        <div id="otp-msg" aria-live="polite" className="min-h-6">
          {message ? (
            <p role="alert" className="t-small flex items-start gap-1.5 font-bold text-crimson">
              <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
              {message}
            </p>
          ) : notice ? (
            <p className="t-small flex items-center gap-1.5 font-bold text-navy">
              <Icon name="check" size={18} className="shrink-0 text-purple" />
              {notice}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col items-start gap-1">
          {resendIn > 0 ? (
            <p className="t-small text-muted">
              {fmt(d.code.resendIn, { time: ltr(mmss(resendIn)) })}
            </p>
          ) : (
            <button
              type="button"
              onClick={() => void resend()}
              disabled={busy}
              className="t-label min-h-11 rounded-lg px-1 text-royal underline decoration-2 underline-offset-4 disabled:opacity-50"
            >
              {d.code.resend}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setChallenge(null);
              navigate('/vote/details', { replace: true, dir: 'back' });
            }}
            className="t-label min-h-11 rounded-lg px-1 text-muted underline decoration-2 underline-offset-4"
          >
            {d.code.changeNumber}
          </button>
        </div>
      </div>
      <ActionBar>
        <Button type="submit" loading={busy} disabled={code.length !== 6 || expired}>
          {busy ? d.code.verifying : d.code.verify}
        </Button>
      </ActionBar>
    </form>
  );
}
