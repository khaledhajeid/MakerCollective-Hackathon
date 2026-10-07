import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AdminSessionInfo, MfaEnrolled } from '@mc/shared';
import { PASSWORD_MIN } from '@mc/shared';
import qrcode from 'qrcode-generator';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Logo } from '../../design-system/Logo';
import { adminApi, ApiError, explain, setCsrf } from './api';
import { endSession, SESSION_KEY } from './session';
import { Btn, CopyBtn, Check, Input, Notice, saveFile, useToast } from './ui';

/** The one door into the console: navy brand ground, a single card, one task per screen. */
function Frame({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="hero-bg grid min-h-dvh place-items-center p-4" dir="ltr" lang="en">
      <div className="w-full max-w-md space-y-6">
        <Logo variant="white" className="mx-auto h-16 w-auto" alt="The Maker Collective 2026" />
        <div className="rounded-3xl bg-surface p-6 shadow-[0_24px_64px_-16px_rgb(0_0_40/0.6)] sm:p-8">
          <h1 data-screen-title tabIndex={-1} className="text-2xl font-extrabold text-navy">
            {title}
          </h1>
          {lead && <p className="mt-1.5 text-[0.9375rem] text-muted">{lead}</p>}
          <div className="mt-6 space-y-4">{children}</div>
        </div>
        <p className="text-center text-sm text-white/70">
          Organisers only. Every sign-in is recorded.
        </p>
      </div>
    </main>
  );
}

function useSessionSetter() {
  const qc = useQueryClient();
  return (s: AdminSessionInfo) => {
    if (s.authenticated) setCsrf(s.csrfToken);
    qc.setQueryData(SESSION_KEY, s);
  };
}

function SignOutLink() {
  const qc = useQueryClient();
  return (
    <button
      type="button"
      className="mx-auto block min-h-11 px-3 text-sm font-bold text-royal hover:underline"
      onClick={() => {
        void adminApi.logout().finally(() => endSession(qc));
      }}
    >
      Cancel and sign out
    </button>
  );
}

/* ───────────── 1. password ───────────── */

export function SignIn() {
  const setSession = useSessionSetter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: () => adminApi.login(username.trim(), password),
    onSuccess: setSession,
  });
  const error = login.error
    ? login.error instanceof ApiError && login.error.code === 'UNAUTHENTICATED'
      ? 'The username or password is wrong, or the account is locked for a few minutes. Check both, or ask a SUPER_ADMIN to unlock you.'
      : explain(login.error)
    : null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (username && password) login.mutate();
  };
  return (
    <Frame title="Sign in" lead="Use your organiser username and password.">
      <form onSubmit={submit} className="space-y-4">
        <Input
          label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
        />
        <Input
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          error={error}
        />
        <Btn type="submit" variant="primary" loading={login.isPending} className="w-full">
          Continue
        </Btn>
      </form>
    </Frame>
  );
}

/* ───────────── 2. second factor ───────────── */

export function MfaScreen() {
  const setSession = useSessionSetter();
  const toast = useToast();
  const [useRecovery, setUseRecovery] = useState(false);
  const [value, setValue] = useState('');
  const verify = useMutation({
    mutationFn: () =>
      adminApi.verify(useRecovery ? { recoveryCode: value.trim() } : { code: value.trim() }),
    onSuccess: (r) => {
      setSession(r.session);
      if (r.recoveryCodesRemaining !== null)
        toast(
          r.recoveryCodesRemaining <= 3 ? 'bad' : 'good',
          r.recoveryCodesRemaining === 0
            ? 'That was your last recovery code. Make new ones under Account.'
            : `Recovery code accepted. ${r.recoveryCodesRemaining} left.`,
        );
    },
  });
  const wrong = verify.error instanceof ApiError && verify.error.code === 'UNAUTHENTICATED';
  const error = verify.error
    ? wrong
      ? useRecovery
        ? 'That recovery code is not valid, or it was already used.'
        : 'That code is not right. Codes change every 30 seconds; type the current one.'
      : explain(verify.error)
    : null;
  return (
    <Frame
      title={useRecovery ? 'Use a recovery code' : 'Enter your 6-digit code'}
      lead={
        useRecovery
          ? 'Type one of the recovery codes you saved when you set up your authenticator. Each works once.'
          : 'Open your authenticator app and type the current code for this console.'
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) verify.mutate();
        }}
        className="space-y-4"
      >
        <Input
          key={String(useRecovery)}
          label={useRecovery ? 'Recovery code' : 'Authenticator code'}
          value={value}
          onChange={(e) =>
            setValue(useRecovery ? e.target.value : e.target.value.replace(/\D/g, '').slice(0, 6))
          }
          inputMode={useRecovery ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          autoFocus
          error={error}
        />
        <Btn type="submit" variant="primary" loading={verify.isPending} className="w-full">
          Verify
        </Btn>
      </form>
      <button
        type="button"
        className="mx-auto block min-h-11 px-3 text-sm font-bold text-royal hover:underline"
        onClick={() => {
          setUseRecovery(!useRecovery);
          setValue('');
          verify.reset();
        }}
      >
        {useRecovery ? 'Use my authenticator app instead' : 'I lost my phone: use a recovery code'}
      </button>
      <SignOutLink />
    </Frame>
  );
}

/* ───────────── 3. first-time authenticator set-up ───────────── */

export function QrSvg({
  text,
  label = 'QR code for your authenticator app',
}: {
  text: string;
  label?: string;
}) {
  const { path, n } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < count; r++)
      for (let c = 0; c < count; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return { path: d, n: count };
  }, [text]);
  return (
    <svg
      viewBox={`-3 -3 ${n + 6} ${n + 6}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={label}
      className="mx-auto size-52 rounded-xl bg-white ring-1 ring-line"
    >
      <path d={path} className="fill-navy-deep" />
    </svg>
  );
}

/** Ten single-use codes, shown once, with the two ways to keep them. */
export function RecoveryCodeList({ codes }: { codes: string[] }) {
  const text = codes.join('\n');
  return (
    <div className="space-y-3">
      <ul className="grid grid-cols-2 gap-2 rounded-xl bg-canvas p-4 font-mono text-[0.9375rem] font-bold tracking-wider text-navy">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex gap-2">
        <CopyBtn text={text} label="Copy all" />
        <Btn
          small
          icon="download"
          onClick={() =>
            saveFile(new Blob([`${text}\n`], { type: 'text/plain' }), 'mc2026-recovery-codes.txt')
          }
        >
          Download
        </Btn>
      </div>
    </div>
  );
}

const groups = (s: string) => s.replace(/(.{4})/g, '$1 ').trim();

export function EnrollScreen() {
  const setSession = useSessionSetter();
  const [code, setCode] = useState('');
  const [done, setDone] = useState<MfaEnrolled | null>(null);
  const [saved, setSaved] = useState(false);
  const start = useMutation({ mutationFn: adminApi.enrollStart });
  useEffect(() => {
    if (!start.isPending && !start.data && !start.error) start.mutate();
    // Start once per mount; the server keeps the pending secret until it is confirmed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const confirm = useMutation({
    mutationFn: () => adminApi.enrollConfirm(code.trim()),
    onSuccess: (r) => {
      setCsrf(r.session.authenticated ? r.session.csrfToken : '');
      setDone(r);
    },
  });

  if (done) {
    return (
      <Frame
        title="Save your recovery codes"
        lead="If you lose your phone, each of these gets you in once. They are shown only now."
      >
        <RecoveryCodeList codes={done.recoveryCodes} />
        <Check checked={saved} onChange={setSaved}>
          I saved these somewhere safe (not on the phone with the authenticator).
        </Check>
        <Btn
          variant="primary"
          disabled={!saved}
          className="w-full"
          onClick={() => setSession(done.session)}
        >
          Continue to the console
        </Btn>
      </Frame>
    );
  }

  return (
    <Frame
      title="Set up your authenticator"
      lead="Every organiser account needs a second step. Use Google Authenticator, Microsoft Authenticator, 1Password or any similar app."
    >
      {start.error ? (
        <Notice tone="bad">{explain(start.error)}</Notice>
      ) : start.data ? (
        <>
          <ol className="space-y-1 text-[0.9375rem] text-ink">
            <li>1. In the app, add an account and scan this code.</li>
          </ol>
          <QrSvg text={start.data.otpauthUri} />
          <details className="text-sm text-muted">
            <summary className="min-h-11 cursor-pointer py-2.5 font-bold text-royal">
              Cannot scan? Type the key instead
            </summary>
            <p className="rounded-xl bg-canvas p-3 font-mono text-base font-bold break-all text-navy">
              {groups(start.data.secret)}
            </p>
          </details>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (code.length === 6) confirm.mutate();
            }}
            className="space-y-4"
          >
            <Input
              label="2. Type the 6-digit code the app shows"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              error={
                confirm.error
                  ? 'That code is not right. Wait for the next one and try again.'
                  : null
              }
            />
            <Btn type="submit" variant="primary" loading={confirm.isPending} className="w-full">
              Turn on two-step sign-in
            </Btn>
          </form>
        </>
      ) : (
        <p className="text-sm text-muted">Preparing your set-up…</p>
      )}
      <SignOutLink />
    </Frame>
  );
}

/* ───────────── 4. replace the temporary password ───────────── */

export function PasswordScreen({ forced = true }: { forced?: boolean }) {
  const setSession = useSessionSetter();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const change = useMutation({
    mutationFn: () => adminApi.changePassword(current, next),
    onSuccess: (s) => {
      setSession(s);
      toast('good', 'Password changed. Other sessions of yours were signed out.');
    },
  });
  const mismatch = again.length > 0 && again !== next;
  const tooShort = next.length > 0 && next.length < PASSWORD_MIN;
  const body = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!mismatch && !tooShort && current && next) change.mutate();
      }}
      className="space-y-4"
    >
      <Input
        label={forced ? 'Temporary password' : 'Current password'}
        type="password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        autoComplete="current-password"
      />
      <Input
        label="New password"
        type="password"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        autoComplete="new-password"
        hint={`At least ${PASSWORD_MIN} characters. A few random words is a good password.`}
        error={tooShort ? `Use at least ${PASSWORD_MIN} characters.` : null}
      />
      <Input
        label="New password again"
        type="password"
        value={again}
        onChange={(e) => setAgain(e.target.value)}
        autoComplete="new-password"
        error={mismatch ? 'The two passwords are different.' : null}
      />
      {change.error && <Notice tone="bad">{explain(change.error)}</Notice>}
      <Btn type="submit" variant="primary" loading={change.isPending} className="w-full">
        Change password
      </Btn>
    </form>
  );
  return forced ? (
    <Frame
      title="Choose your own password"
      lead="The password you were given is temporary. Replace it to continue."
    >
      {body}
      <SignOutLink />
    </Frame>
  ) : (
    body
  );
}
