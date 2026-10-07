import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AccessMode } from '@mc/shared';
import type { AdminSettings, SettingsPatch } from '@mc/shared/manage';
import { useEffect, useState } from 'react';
import { adminApi, ApiError, explain } from '../api';
import { AIcon } from '../icons';
import { fromAmman, toAmman } from '../time';
import {
  Btn,
  Input,
  LoadError,
  Notice,
  PageHeader,
  Panel,
  Select,
  Skeleton,
  useToast,
} from '../ui';

interface Form {
  eventName: string;
  votingOpensAt: string;
  votingClosesAt: string;
  accessMode: AccessMode;
  venueCidrs: string[];
  wifiSsid: string;
  wifiPassword: string;
  allowedPhonePrefixes: string[];
  otpTtlSeconds: string;
  otpMaxAttempts: string;
  otpResendCooldownSeconds: string;
  consentVersion: string;
}

const toForm = (s: AdminSettings): Form => ({
  eventName: s.eventName,
  votingOpensAt: toAmman(s.votingOpensAt),
  votingClosesAt: toAmman(s.votingClosesAt),
  accessMode: s.accessMode,
  venueCidrs: s.venueCidrs,
  wifiSsid: s.wifiSsid ?? '',
  wifiPassword: s.wifiPassword ?? '',
  allowedPhonePrefixes: s.allowedPhonePrefixes,
  otpTtlSeconds: String(s.otpTtlSeconds),
  otpMaxAttempts: String(s.otpMaxAttempts),
  otpResendCooldownSeconds: String(s.otpResendCooldownSeconds),
  consentVersion: s.consentVersion,
});

/** Only the fields that differ from what the server has: a small, intentional change, never a whole-form overwrite. */
function diff(s: AdminSettings, f: Form): SettingsPatch {
  const was = toForm(s);
  const patch: Record<string, unknown> = {};
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (!same(was.eventName, f.eventName)) patch.eventName = f.eventName;
  if (was.votingOpensAt !== f.votingOpensAt)
    patch.votingOpensAt = f.votingOpensAt ? fromAmman(f.votingOpensAt) : null;
  if (was.votingClosesAt !== f.votingClosesAt)
    patch.votingClosesAt = f.votingClosesAt ? fromAmman(f.votingClosesAt) : null;
  if (was.accessMode !== f.accessMode) patch.accessMode = f.accessMode;
  if (!same(was.venueCidrs, f.venueCidrs)) patch.venueCidrs = f.venueCidrs;
  if (was.wifiSsid !== f.wifiSsid) patch.wifiSsid = f.wifiSsid || null;
  if (was.wifiPassword !== f.wifiPassword) patch.wifiPassword = f.wifiPassword || null;
  if (!same(was.allowedPhonePrefixes, f.allowedPhonePrefixes))
    patch.allowedPhonePrefixes = f.allowedPhonePrefixes;
  for (const k of ['otpTtlSeconds', 'otpMaxAttempts', 'otpResendCooldownSeconds'] as const)
    if (was[k] !== f[k]) patch[k] = Number(f[k]);
  if (was.consentVersion !== f.consentVersion) patch.consentVersion = f.consentVersion;
  return { ...patch, version: s.version } as SettingsPatch;
}

export function Settings() {
  const q = useQuery({ queryKey: ['admin', 'settings'], queryFn: adminApi.settings });
  if (q.error && !q.data) return <LoadError error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <>
      <PageHeader
        title="Settings"
        lead="The voting schedule, the venue network and the SMS rules. Saved changes reach phones within a couple of seconds."
      />
      {q.data ? (
        <SettingsForm key={q.data.version} server={q.data} />
      ) : (
        <Skeleton className="h-96" />
      )}
    </>
  );
}

function SettingsForm({ server }: { server: AdminSettings }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState<Form>(() => toForm(server));
  const patch = diff(server, f);
  const dirty = Object.keys(patch).length > 1;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((cur) => ({ ...cur, [k]: v }));

  const save = useMutation({
    mutationFn: () => adminApi.updateSettings(patch),
    onSuccess: () => {
      toast('good', 'Settings saved.');
      void qc.invalidateQueries({ queryKey: ['admin'] });
    },
  });
  const conflict = save.error instanceof ApiError && save.error.status === 409;

  // Leaving with unsaved changes is the one easy way to lose work here.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const closesBeforeOpens =
    f.votingOpensAt && f.votingClosesAt && f.votingClosesAt <= f.votingOpensAt;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty && !closesBeforeOpens) save.mutate();
      }}
      className="space-y-4 pb-28"
    >
      <Panel title="Event">
        <Input
          label="Event name"
          value={f.eventName}
          maxLength={80}
          onChange={(e) => set('eventName', e.target.value)}
          className="max-w-md"
        />
      </Panel>

      <Panel title="Voting schedule">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Opens"
            type="datetime-local"
            value={f.votingOpensAt}
            onChange={(e) => set('votingOpensAt', e.target.value)}
            hint="Jordan time. Empty means it never opens on its own."
          />
          <Input
            label="Closes"
            type="datetime-local"
            value={f.votingClosesAt}
            onChange={(e) => set('votingClosesAt', e.target.value)}
            error={closesBeforeOpens ? 'It must close after it opens.' : null}
            hint={closesBeforeOpens ? undefined : 'Empty means it stays open until you close it.'}
          />
        </div>
        <p className="mt-3 text-sm text-muted">
          The Open / Closed switch on the Overview always wins over this schedule.
        </p>
      </Panel>

      <Panel title="Venue network">
        <div className="space-y-5">
          <Select
            label="Who may vote"
            value={f.accessMode}
            onChange={(e) => set('accessMode', e.target.value as AccessMode)}
            className="max-w-md"
          >
            <option value="IP_ALLOWLIST">
              Only people on the venue network (use this at the event)
            </option>
            <option value="OFF">Anyone with the link (testing only)</option>
          </Select>
          {f.accessMode === 'OFF' && (
            <Notice tone="warn">
              With this on, anybody in the world with the link can vote. Switch it back before the
              event.
            </Notice>
          )}
          {f.accessMode === 'IP_ALLOWLIST' && f.venueCidrs.length === 0 && (
            <Notice tone="bad">
              No network is listed, so every visitor is turned away. Add the venue's public address
              below.
            </Notice>
          )}
          <Ranges value={f.venueCidrs} onChange={(v) => set('venueCidrs', v)} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Wi-Fi network name"
              value={f.wifiSsid}
              maxLength={64}
              onChange={(e) => set('wifiSsid', e.target.value)}
              hint="Shown to visitors who are turned away, so they know which network to join."
            />
            <Input
              label="Wi-Fi password"
              value={f.wifiPassword}
              maxLength={64}
              onChange={(e) => set('wifiPassword', e.target.value)}
              hint="Kept for organisers (door sign, pitch). Visitors are not shown it."
              autoComplete="off"
            />
          </div>
        </div>
      </Panel>

      <Panel title="Phone numbers and SMS codes">
        <div className="space-y-5">
          <Tags
            label="Allowed phone prefixes"
            hint="Only numbers starting with one of these may get a code. +9627 is Jordanian mobiles."
            value={f.allowedPhonePrefixes}
            onChange={(v) => set('allowedPhonePrefixes', v)}
            placeholder="+9627"
            pattern={/^\+[1-9]\d{0,6}$/}
            invalidText="Start with + and the country code, for example +9627."
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <Input
              label="Code lifetime (seconds)"
              type="number"
              inputMode="numeric"
              min={60}
              max={900}
              value={f.otpTtlSeconds}
              onChange={(e) => set('otpTtlSeconds', e.target.value)}
              hint="60 to 900"
            />
            <Input
              label="Wrong tries allowed"
              type="number"
              inputMode="numeric"
              min={1}
              max={10}
              value={f.otpMaxAttempts}
              onChange={(e) => set('otpMaxAttempts', e.target.value)}
              hint="1 to 10"
            />
            <Input
              label="Wait before a new code (seconds)"
              type="number"
              inputMode="numeric"
              min={15}
              max={600}
              value={f.otpResendCooldownSeconds}
              onChange={(e) => set('otpResendCooldownSeconds', e.target.value)}
              hint="15 to 600"
            />
          </div>
          <Input
            label="Privacy notice version"
            value={f.consentVersion}
            maxLength={40}
            onChange={(e) => set('consentVersion', e.target.value)}
            className="max-w-xs"
            hint="Recorded with each visitor's consent."
          />
        </div>
      </Panel>

      {save.error && (
        <Notice tone="bad">
          <p>{explain(save.error)}</p>
          {conflict && (
            <Btn
              small
              onClick={() => void qc.invalidateQueries({ queryKey: ['admin', 'settings'] })}
            >
              Reload the latest settings
            </Btn>
          )}
        </Notice>
      )}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 py-3 shadow-[0_-8px_24px_-12px_rgb(0_0_60/0.25)] backdrop-blur-sm lg:start-[17rem]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 sm:px-4">
          <p className="text-sm text-muted" aria-live="polite">
            {dirty
              ? `${Object.keys(patch).length - 1} unsaved change${Object.keys(patch).length > 2 ? 's' : ''}`
              : 'Everything is saved.'}
          </p>
          <div className="flex gap-2">
            <Btn onClick={() => setF(toForm(server))} disabled={!dirty || save.isPending}>
              Discard
            </Btn>
            <Btn
              type="submit"
              variant="primary"
              disabled={!dirty || !!closesBeforeOpens}
              loading={save.isPending}
            >
              Save changes
            </Btn>
          </div>
        </div>
      </div>
    </form>
  );
}

/* ───────────── venue ranges ───────────── */

function Ranges({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [me, setMe] = useState<Awaited<ReturnType<typeof adminApi.networkMe>> | null>(null);
  const find = useMutation({ mutationFn: adminApi.networkMe, onSuccess: setMe });
  return (
    <div className="space-y-3">
      <Tags
        label="Venue network addresses"
        hint="The venue Wi-Fi's public IP address, or a range like 203.0.113.0/24. IPv4 and IPv6 both work."
        value={value}
        onChange={onChange}
        placeholder="203.0.113.5"
        pattern={/^[0-9a-fA-F:.]{2,45}(\/\d{1,3})?$/}
        invalidText="That is not an address. Use something like 203.0.113.5 or 203.0.113.0/24."
        mono
      />
      <div className="rounded-xl bg-royal-soft/60 p-4 ring-1 ring-inset ring-royal/15">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-[55ch] text-sm text-ink">
            <b>Setting up on site?</b> Open this page from a laptop that is on the venue Wi-Fi, then
            add the address this browser is seen from.
          </p>
          <Btn icon="wifi" onClick={() => find.mutate()} loading={find.isPending}>
            Find my address
          </Btn>
        </div>
        {find.error && <p className="mt-2 text-sm font-bold text-crimson">{explain(find.error)}</p>}
        {me && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-royal/15 pt-3">
            <p className="text-sm text-ink">
              This browser is seen as <b className="num">{me.ip ?? 'unknown'}</b>
              {me.family === 6 && (
                <span className="text-muted">
                  {' '}
                  (IPv6; a whole /64 is added because devices change their last digits)
                </span>
              )}
              .{' '}
              {me.admitted ? (
                <span className="font-bold text-navy">It is already allowed.</span>
              ) : (
                <span className="text-muted">It is not allowed yet.</span>
              )}
            </p>
            {me.suggestion && !value.includes(me.suggestion) && (
              <Btn
                variant="primary"
                icon="plus"
                onClick={() => onChange([...value, me.suggestion!])}
              >
                Add {me.suggestion}
              </Btn>
            )}
          </div>
        )}
        {me && me.family === 4 && (
          <p className="mt-2 text-sm text-muted">
            Phones on the same Wi-Fi may reach the internet through an IPv6 address instead. Check
            one phone at <span className="num">/api/access/status</span> and add its range too if it
            differs.
          </p>
        )}
      </div>
    </div>
  );
}

function Tags({
  label,
  hint,
  value,
  onChange,
  placeholder,
  pattern,
  invalidText,
  mono,
}: {
  label: string;
  hint: string;
  value: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  pattern: RegExp;
  invalidText: string;
  mono?: boolean;
}) {
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const add = () => {
    const items = text
      .split(/[\s,]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (!items.length) return;
    const bad = items.find((t) => !pattern.test(t));
    if (bad) return setErr(invalidText);
    onChange([...new Set([...value, ...items])]);
    setText('');
    setErr(null);
  };
  return (
    <div className="space-y-2">
      <Input
        label={label}
        hint={hint}
        error={err}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          setErr(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }}
        spellCheck={false}
        autoCapitalize="none"
        className="max-w-xl"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Btn small icon="plus" onClick={add} disabled={!text.trim()}>
          Add
        </Btn>
        {value.length === 0 && <span className="text-sm text-muted">None yet</span>}
        {value.map((v) => (
          <span
            key={v}
            className={`inline-flex min-h-9 items-center gap-1 rounded-full bg-canvas ps-3 pe-1 text-sm font-bold text-navy ring-1 ring-inset ring-line ${mono ? 'num' : ''}`}
          >
            {v}
            <button
              type="button"
              aria-label={`Remove ${v}`}
              onClick={() => onChange(value.filter((x) => x !== v))}
              className="grid size-8 place-items-center rounded-full text-muted hover:bg-crimson-soft hover:text-crimson"
            >
              <AIcon name="close" size={14} />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
