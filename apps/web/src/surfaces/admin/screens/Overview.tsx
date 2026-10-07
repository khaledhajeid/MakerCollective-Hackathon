import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ResultsVisibility, VotingStatus } from '@mc/shared';
import type { Overview as OverviewData } from '@mc/shared/manage';
import { useState } from 'react';
import { Link } from 'react-router';
import { adminApi, explain } from '../api';
import { AIcon } from '../icons';
import {
  Badge,
  Btn,
  Confirm,
  fmtTime,
  LoadError,
  Notice,
  PageHeader,
  Panel,
  Segmented,
  Skeleton,
  useToast,
} from '../ui';

const n = (v: number) => v.toLocaleString('en-US');

export function Overview() {
  const q = useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: adminApi.overview,
    refetchInterval: 5000,
  });

  if (q.error && !q.data) return <LoadError error={q.error} onRetry={() => void q.refetch()} />;
  const o = q.data;
  return (
    <>
      <PageHeader
        title="Overview"
        lead="What is happening right now, and the two switches that matter on the day."
        actions={
          o && (
            <span className="text-sm text-muted" aria-live="off">
              Updated {fmtTime(o.now, { day: undefined, month: undefined, second: '2-digit' })}
            </span>
          )
        }
      />
      {!o ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
          <Skeleton className="h-40 lg:col-span-2" />
        </div>
      ) : (
        <div className="space-y-4">
          <GateWarning o={o} />
          <div className="grid gap-4 lg:grid-cols-2">
            <VotingPanel o={o} />
            <BlindHourPanel o={o} />
          </div>
          <Totals o={o} />
          <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
            <PerMinute o={o} />
            <Signals o={o} />
          </div>
          <Categories o={o} />
          <LiveCounts mode={o.results.mode} />
        </div>
      )}
    </>
  );
}

/* ───────────── warnings that would waste the event ───────────── */

function GateWarning({ o }: { o: OverviewData }) {
  if (o.access.mode === 'OFF')
    return (
      <Notice tone="warn">
        <p className="font-bold">The venue check is switched off.</p>
        <p>
          Anyone with the link can vote from anywhere. Turn it back on in{' '}
          <Link to="/admin/settings" className="font-bold underline">
            Settings
          </Link>{' '}
          before the event.
        </p>
      </Notice>
    );
  if (o.access.ranges === 0)
    return (
      <Notice tone="bad">
        <p className="font-bold">No venue network is set, so every visitor is turned away.</p>
        <p>
          Add the venue Wi-Fi's public address in{' '}
          <Link to="/admin/settings" className="font-bold underline">
            Settings
          </Link>
          .
        </p>
      </Notice>
    );
  return null;
}

/* ───────────── voting window ───────────── */

const VOTING_LABEL: Record<VotingStatus, string> = {
  SCHEDULED: 'Follow the schedule',
  OPEN: 'Open',
  CLOSED: 'Closed',
};

function VotingPanel({ o }: { o: OverviewData }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [target, setTarget] = useState<VotingStatus | null>(null);
  const set = useMutation({
    mutationFn: (s: VotingStatus) => adminApi.updateSettings({ votingStatus: s }),
    onSuccess: () => {
      setTarget(null);
      toast('good', 'Voting updated.');
      void qc.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (e) => toast('bad', explain(e)),
  });
  const state = o.voting.state;
  const tone = state === 'OPEN' ? 'good' : state === 'CLOSED' ? 'bad' : 'warn';
  const stateText = state === 'OPEN' ? 'Open' : state === 'CLOSED' ? 'Closed' : 'Not open yet';
  const why =
    o.voting.status === 'OPEN'
      ? 'Held open by you, whatever the schedule says.'
      : o.voting.status === 'CLOSED'
        ? 'Held closed by you, whatever the schedule says.'
        : o.voting.opensAt
          ? `Following the schedule: opens ${fmtTime(o.voting.opensAt)}${o.voting.closesAt ? `, closes ${fmtTime(o.voting.closesAt)}` : ''}.`
          : 'Following the schedule, but no opening time is set, so voting stays closed.';
  return (
    <Panel title="Voting">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Badge tone={tone}>{stateText}</Badge>
          <p className="text-sm text-muted">{why}</p>
        </div>
        <Segmented
          label="Voting"
          value={o.voting.status}
          onChange={(v) => v !== o.voting.status && setTarget(v)}
          options={(Object.keys(VOTING_LABEL) as VotingStatus[]).map((v) => ({
            value: v,
            label: VOTING_LABEL[v],
          }))}
        />
        <p className="text-sm text-muted">
          Phones see the change within a couple of seconds. Votes already cast always stay.
        </p>
      </div>
      <Confirm
        open={target !== null}
        onClose={() => setTarget(null)}
        title={
          target === 'CLOSED'
            ? 'Close voting?'
            : target === 'OPEN'
              ? 'Open voting?'
              : 'Follow the schedule?'
        }
        confirmLabel={
          target === 'CLOSED'
            ? 'Close voting'
            : target === 'OPEN'
              ? 'Open voting'
              : 'Follow the schedule'
        }
        danger={target === 'CLOSED'}
        typeToConfirm={target === 'CLOSED' ? 'CLOSE' : undefined}
        busy={set.isPending}
        onConfirm={() => target && set.mutate(target)}
      >
        {target === 'CLOSED' ? (
          <p>
            Every visitor is stopped from voting straight away, even if the schedule says it is
            open.
          </p>
        ) : target === 'OPEN' ? (
          <p>Visitors on the venue network can vote straight away, whatever the schedule says.</p>
        ) : (
          <p>The opening and closing times in Settings decide again.</p>
        )}
      </Confirm>
    </Panel>
  );
}

/* ───────────── Blind Hour / reveal ───────────── */

interface ModeInfo {
  label: string;
  short: string;
  consequence: string;
  typed?: string;
}
const MODES: Record<ResultsVisibility, ModeInfo> = {
  LIVE: {
    label: 'Live',
    short: 'The TVs show standings as votes arrive.',
    consequence: 'The TVs will show the real, moving standings again.',
  },
  FROZEN: {
    label: 'Blind Hour',
    short: 'The TVs keep the standings sealed at this moment. Votes keep arriving unseen.',
    consequence:
      'The TVs freeze on the standings as they are right now. Votes carry on, but nobody in the hall can see them change.',
  },
  HIDDEN: {
    label: 'Hidden',
    short: 'The TVs show no standings at all.',
    consequence: 'The TVs stop showing any standings, only the event screen.',
  },
  REVEAL: {
    label: 'Reveal',
    short: 'Announce the winners one category at a time.',
    consequence:
      'The TVs clear to a blank reveal screen. You then announce categories one by one; each shows the standings of that moment.',
    typed: 'REVEAL',
  },
};

function BlindHourPanel({ o }: { o: OverviewData }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [target, setTarget] = useState<ResultsVisibility | null>(null);
  const [revealing, setRevealing] = useState<{ id: string; name: string } | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin'] });
  const setMode = useMutation({
    mutationFn: (m: ResultsVisibility) => adminApi.setMode(m),
    onSuccess: (_r, m) => {
      setTarget(null);
      toast('good', `The TVs are switching to ${MODES[m].label}.`);
      refresh();
    },
    onError: (e) => toast('bad', explain(e)),
  });
  const reveal = useMutation({
    mutationFn: (id: string) => adminApi.reveal(id),
    onSuccess: () => {
      setRevealing(null);
      refresh();
    },
    onError: (e) => toast('bad', explain(e)),
  });
  const mode = o.results.mode;
  const revealed = new Set(o.results.revealedCategoryIds);
  const next = o.categories.find((c) => c.isActive && !revealed.has(c.id));

  return (
    <Panel title="Results on the TVs">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={mode === 'LIVE' ? 'good' : mode === 'REVEAL' ? 'purple' : 'warn'}>
            {MODES[mode].label}
          </Badge>
          <p className="min-w-0 text-sm text-muted">
            {mode === 'FROZEN' && o.results.frozenAt
              ? `Sealed at ${fmtTime(o.results.frozenAt)}. ${MODES[mode].short}`
              : MODES[mode].short}
          </p>
        </div>
        <Segmented
          label="Results on the TVs"
          value={mode}
          onChange={(v) => v !== mode && setTarget(v)}
          options={(Object.keys(MODES) as ResultsVisibility[]).map((v) => ({
            value: v,
            label: MODES[v].label,
          }))}
        />

        {mode === 'REVEAL' && (
          <div className="space-y-2 border-t border-line pt-4">
            <h3 className="text-sm font-bold text-navy">Announce</h3>
            <ol className="space-y-1.5">
              {o.categories
                .filter((c) => c.isActive)
                .map((c) => {
                  const done = revealed.has(c.id);
                  return (
                    <li
                      key={c.id}
                      className={`flex min-h-12 items-center justify-between gap-3 rounded-xl px-3 ${
                        next?.id === c.id
                          ? 'bg-purple-soft ring-1 ring-inset ring-purple/30'
                          : 'bg-canvas'
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span
                          className="size-3 shrink-0 rounded-full"
                          style={{ background: c.color }}
                        />
                        <span className="truncate text-[0.9375rem] font-bold text-navy">
                          {c.nameEn}
                        </span>
                      </span>
                      {done ? (
                        <Badge tone="good">
                          <AIcon name="check" size={14} /> Announced
                        </Badge>
                      ) : (
                        <Btn
                          small
                          variant={next?.id === c.id ? 'primary' : 'secondary'}
                          onClick={() => setRevealing({ id: c.id, name: c.nameEn })}
                        >
                          Reveal
                        </Btn>
                      )}
                    </li>
                  );
                })}
            </ol>
          </div>
        )}
      </div>

      <Confirm
        open={target !== null}
        onClose={() => setTarget(null)}
        title={target ? `Switch to ${MODES[target].label}?` : ''}
        confirmLabel={target ? `Switch to ${MODES[target].label}` : 'Switch'}
        typeToConfirm={target ? MODES[target].typed : undefined}
        busy={setMode.isPending}
        onConfirm={() => target && setMode.mutate(target)}
      >
        <p>{target && MODES[target].consequence}</p>
        <p className="text-sm text-muted">
          Every TV switches within a second. This is recorded in the audit log.
        </p>
      </Confirm>
      <Confirm
        open={revealing !== null}
        onClose={() => setRevealing(null)}
        title={`Reveal ${revealing?.name ?? ''}?`}
        confirmLabel="Reveal on the TVs"
        busy={reveal.isPending}
        onConfirm={() => revealing && reveal.mutate(revealing.id)}
      >
        <p>
          The TVs show this category's winner now. It cannot be taken back, and later votes will not
          change it.
        </p>
      </Confirm>
    </Panel>
  );
}

/* ───────────── numbers ───────────── */

function Totals({ o }: { o: OverviewData }) {
  const items: Array<[string, number, string]> = [
    ['Registered visitors', o.totals.visitors, 'People who confirmed their phone'],
    ['Votes cast', o.totals.votes, 'Across all categories'],
    ['Visitors who voted', o.totals.voters, 'At least one vote'],
  ];
  return (
    <Panel pad={false}>
      <dl className="grid divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {items.map(([label, value, hint]) => (
          <div key={label} className="px-5 py-4">
            <dt className="text-sm font-bold text-muted">{label}</dt>
            <dd className="num mt-1 text-3xl font-extrabold text-navy">{n(value)}</dd>
            <dd className="text-sm text-muted">{hint}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

function PerMinute({ o }: { o: OverviewData }) {
  const max = Math.max(1, ...o.perMinute.map((m) => m.votes));
  const lastFive = o.perMinute.slice(-5).reduce((s, m) => s + m.votes, 0);
  return (
    <Panel title="Votes per minute, last 30 minutes">
      <div
        role="img"
        aria-label={`Votes per minute over the last 30 minutes. Busiest minute ${max}. ${lastFive} votes in the last 5 minutes.`}
        className="flex h-32 items-end gap-[3px]"
      >
        {o.perMinute.map((m) => (
          <div key={m.at} className="flex h-full flex-1 items-end" title={`${m.votes} votes`}>
            <div
              className={`w-full rounded-t-[3px] ${m.votes ? 'bg-purple' : 'bg-line'}`}
              style={{ height: `${m.votes ? Math.max(6, (m.votes / max) * 100) : 3}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-sm text-muted">
        <span>30 min ago</span>
        <span>
          <b className="num text-navy">{lastFive}</b> votes in the last 5 minutes
        </span>
        <span>now</span>
      </div>
    </Panel>
  );
}

function Signals({ o }: { o: OverviewData }) {
  const { requested, verified } = o.otp;
  const rate = requested ? Math.round((verified / requested) * 100) : null;
  const lowRate = rate !== null && requested >= 20 && rate < 50;
  return (
    <Panel title="Things to watch">
      <ul className="space-y-3 text-[0.9375rem]">
        <li className="flex items-start justify-between gap-3">
          <span>
            SMS codes confirmed
            <span className="block text-sm text-muted">
              Last hour: {n(verified)} of {n(requested)}
            </span>
          </span>
          {rate === null ? (
            <Badge>No codes yet</Badge>
          ) : (
            <Badge tone={lowRate ? 'bad' : 'good'}>{rate}%</Badge>
          )}
        </li>
        {lowRate && (
          <li>
            <Notice tone="warn">
              Fewer than half of the codes sent are being typed in. Phones may not be receiving SMS.
            </Notice>
          </li>
        )}
        <li className="flex items-center justify-between gap-3">
          <span>TV displays online</span>
          <Badge
            tone={
              o.signals.displaysTotal && o.signals.displaysOnline === o.signals.displaysTotal
                ? 'good'
                : 'warn'
            }
          >
            {o.signals.displaysOnline} of {o.signals.displaysTotal}
          </Badge>
        </li>
        <li className="flex items-center justify-between gap-3">
          <span>Blocked visitors</span>
          <Badge>{o.signals.blockedVisitors}</Badge>
        </li>
        <li>
          <div className="flex items-center justify-between gap-3">
            <span>Phones sharing one device</span>
            <Badge tone={o.signals.sharedDevices.length ? 'warn' : 'good'}>
              {o.signals.sharedDevices.length ? o.signals.sharedDevices.length : 'None'}
            </Badge>
          </div>
          {o.signals.sharedDevices.length > 0 && (
            <p className="mt-1 text-sm text-muted">
              {o.signals.sharedDevices
                .map((d) => `${d.visitors} phones on device ${d.device}…`)
                .join(', ')}
              . Look them up under Visitors.
            </p>
          )}
        </li>
      </ul>
    </Panel>
  );
}

function Categories({ o }: { o: OverviewData }) {
  return (
    <Panel title="Votes by category" pad={false}>
      <p className="px-5 pt-1 text-sm text-muted">
        Totals only. Who is ahead stays hidden here too during the Blind Hour.
      </p>
      <ul className="mt-3 divide-y divide-line">
        {o.categories.map((c) => (
          <li key={c.id} className="flex min-h-12 items-center justify-between gap-3 px-5 py-2">
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="size-3 shrink-0 rounded-full" style={{ background: c.color }} />
              <span className="truncate text-[0.9375rem] font-bold text-navy">{c.nameEn}</span>
              {!c.isActive && <Badge>Hidden</Badge>}
            </span>
            <span className="num text-[0.9375rem] font-bold text-ink">{n(c.votes)}</span>
          </li>
        ))}
        {o.categories.length === 0 && (
          <li className="px-5 py-6 text-sm text-muted">
            No categories yet. Add them under Categories &amp; exhibitors.
          </li>
        )}
      </ul>
    </Panel>
  );
}

/* ───────────── who is ahead (organisers only) ───────────── */

function LiveCounts({ mode }: { mode: ResultsVisibility }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['admin', 'live'],
    queryFn: adminApi.liveResults,
    enabled: open,
    refetchInterval: open ? 15000 : false,
  });
  const content = useQuery({
    queryKey: ['admin', 'content'],
    queryFn: adminApi.content,
    enabled: open,
  });
  const catName = new Map(content.data?.categories.map((c) => [c.id, c.nameEn]));
  return (
    <Panel
      title="Who is ahead"
      action={
        <Btn small icon={open ? 'close' : 'eye'} onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Show live counts'}
        </Btn>
      }
    >
      {!open ? (
        <p className="text-sm text-muted">
          The real standings, as they are now.{' '}
          {mode === 'LIVE'
            ? 'The TVs show the same numbers.'
            : 'The TVs do not show them right now, so opening this is recorded in the audit log.'}
        </p>
      ) : q.error ? (
        <Notice tone="bad">{explain(q.error)}</Notice>
      ) : !q.data ? (
        <Skeleton className="h-24" />
      ) : (
        <div className="space-y-4">
          {q.data.audited && (
            <Notice tone="warn">
              The TVs are not showing these numbers. Your viewing is recorded. Do not read them out
              during the Blind Hour.
            </Notice>
          )}
          {q.data.categories.length === 0 && <p className="text-sm text-muted">No votes yet.</p>}
          <div className="grid gap-4 md:grid-cols-2">
            {q.data.categories.map((c) => (
              <div key={c.categoryId}>
                <h3 className="text-sm font-bold text-navy">
                  {catName.get(c.categoryId) ?? 'Category'}{' '}
                  <span className="num font-normal text-muted">· {n(c.total)} votes</span>
                </h3>
                <ol className="mt-1.5 space-y-1">
                  {c.rows.slice(0, 5).map((r, i) => (
                    <li
                      key={r.exhibitorId}
                      className="flex items-center justify-between gap-3 rounded-lg bg-canvas px-3 py-2 text-[0.9375rem]"
                    >
                      <span className="truncate">
                        <span className="num me-2 text-muted">{i + 1}</span>
                        {r.nameEn}
                      </span>
                      <b className="num text-navy">{n(r.votes)}</b>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}
