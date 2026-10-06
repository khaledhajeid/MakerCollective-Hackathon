import { useState } from 'react';
import { Button } from '../../../design-system/Button';
import { Icon } from '../../../design-system/Icon';
import { useI18n } from '../../../i18n';
import { ActionBar, BrandMark, Hero, LanguageToggle } from '../components/Chrome';
import { VoteRecap } from '../components/VoteRecap';
import { errorMessage } from '../errors';
import { useVoter } from '../store';

/** Not on the venue network (F10/F11): never a dead end — says which Wi-Fi to join and re-checks by itself. */
export function GateScreen() {
  const { d } = useI18n();
  const { access, recheckAccess } = useVoter();
  const [busy, setBusy] = useState(false);
  const [again, setAgain] = useState(false);
  const check = async () => {
    setBusy(true);
    const a = await recheckAccess();
    setBusy(false);
    setAgain(a ? !a.allowed : true);
  };
  return (
    <div className="flex min-h-dvh flex-col">
      <Hero tone="teal" className="px-6 pb-12 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between">
          <BrandMark className="w-32" />
          <LanguageToggle onDark />
        </div>
        <div className="mt-12 grid size-16 place-items-center rounded-full bg-white/12 ring-1 ring-white/30">
          <Icon name="wifi" size={32} />
        </div>
        <h1 className="t-display mt-6" tabIndex={-1} data-screen-title>
          {d.gate.title}
        </h1>
        <p className="t-body mt-3 max-w-[36ch] text-white/90">{d.gate.body}</p>
      </Hero>
      <div className="relative -mt-6 flex flex-1 flex-col rounded-t-[2rem] bg-canvas px-5 pt-7">
        <div className="rounded-[var(--radius-card)] bg-surface p-5 shadow-[var(--shadow-card)]">
          <p className="t-small text-muted">{d.gate.networkLabel}</p>
          <p
            className="mt-1 break-words text-[1.75rem] font-bold leading-tight text-navy"
            dir="auto"
          >
            {access?.wifiSsid ?? d.gate.networkUnknown}
          </p>
          <p className="t-small mt-3 flex items-start gap-2 text-ink">
            <Icon name="lock" size={18} className="mt-0.5 shrink-0 text-purple" />
            {d.gate.password}
          </p>
        </div>
        <p className="t-small mt-4 flex items-start gap-2 px-1 text-muted">
          <Icon name="info" size={18} className="mt-0.5 shrink-0" />
          {d.gate.dataTip}
        </p>
        {again && (
          <p
            role="alert"
            className="t-small mt-4 rounded-[var(--radius-control)] bg-yellow-soft p-3 font-bold text-ink"
          >
            {d.gate.stillBlocked}
          </p>
        )}
        <ActionBar>
          <Button loading={busy} onClick={() => void check()}>
            {d.gate.retry}
          </Button>
        </ActionBar>
      </div>
    </div>
  );
}

/** Voting window is closed or has not opened yet; a signed-in visitor still sees their own votes. */
export function ClosedScreen() {
  const { d, fmt, time } = useI18n();
  const { voting, visitor, votes } = useVoter();
  const soon = voting?.state === 'NOT_YET_OPEN';
  const hasVotes = visitor && Object.keys(votes).length > 0;
  return (
    <div className="flex min-h-dvh flex-col">
      <Hero className="px-6 pb-14 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between">
          <BrandMark className="w-32" />
          <LanguageToggle onDark />
        </div>
        <div className="mt-12 grid size-16 place-items-center rounded-full bg-white/12 ring-1 ring-white/30">
          <Icon name={soon ? 'clock' : 'check'} size={32} />
        </div>
        <h1 className="t-display mt-6" tabIndex={-1} data-screen-title>
          {soon ? d.closed.titleSoon : d.closed.titleClosed}
        </h1>
        <p className="t-body mt-3 max-w-[36ch] text-white/90">
          {soon ? d.closed.bodySoon : d.closed.bodyClosed}
        </p>
        {soon && voting?.opensAt && (
          <p className="t-label mt-5 inline-flex rounded-full bg-yellow px-4 py-2 text-navy">
            {fmt(d.closed.opensAt, { time: time(voting.opensAt) })}
          </p>
        )}
      </Hero>
      <div className="relative -mt-6 flex-1 rounded-t-[2rem] bg-canvas px-5 pb-10 pt-7">
        {hasVotes && (
          <>
            <h2 className="t-heading mb-3">{d.closed.yourVotes}</h2>
            <VoteRecap />
          </>
        )}
      </div>
    </div>
  );
}

/** The very first load failed (offline, server restarting). Retry is one tap. */
export function BootError() {
  const { d } = useI18n();
  const { bootError, retryBoot } = useVoter();
  const { fmt } = useI18n();
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-canvas px-8 text-center">
      <div className="grid size-16 place-items-center rounded-full bg-crimson-soft text-crimson">
        <Icon name="signal" size={30} />
      </div>
      <p className="t-heading max-w-[28ch]" role="alert" tabIndex={-1} data-screen-title>
        {errorMessage(bootError, d, fmt)}
      </p>
      <div className="w-full max-w-xs">
        <Button onClick={retryBoot}>{d.common.tryAgain}</Button>
      </div>
      <LanguageToggle />
    </div>
  );
}
