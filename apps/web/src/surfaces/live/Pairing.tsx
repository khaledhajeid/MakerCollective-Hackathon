import { useState, type FormEvent } from 'react';
import { Logo } from '../../design-system/Logo';
import { Rings } from '../../design-system/Motifs';
import type { PairIssue } from './useDisplay';
import { A, Bi, E, SlowGear } from './parts';

/** First run on a TV: type the display code (or open the pairing link from the organiser and skip this). */
export function Pairing({
  issue,
  pairing,
  onPair,
}: {
  issue: PairIssue;
  pairing: boolean;
  onPair: (code: string) => void;
}) {
  const [code, setCode] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (code.trim()) onPair(code);
  };
  const problem =
    issue === 'invalid'
      ? ([A.pairInvalid, E.pairInvalid] as const)
      : issue === 'revoked'
        ? ([A.pairRevoked, E.pairRevoked] as const)
        : issue === 'origin'
          ? ([A.pairOrigin, E.pairOrigin] as const)
          : issue === 'network'
            ? ([A.pairNetwork, E.pairNetwork] as const)
            : null;

  return (
    <main className="tv-ground relative flex size-full items-center justify-between overflow-hidden px-[120px] text-white">
      <Rings
        className="rings-turn absolute -start-[300px] top-1/2 size-[1200px] -translate-y-1/2 opacity-60"
        stroke="rgb(255 255 255 / 0.08)"
      />
      <div className="relative z-10 flex w-[1000px] flex-col gap-[40px]">
        <Logo variant="white" className="h-[96px] w-auto self-start" alt="" />
        <Bi
          k="pairTitle"
          arClass="text-[96px] font-bold leading-[1.2]"
          enClass="text-[48px] leading-[1.15] text-white/80"
        />
        <Bi
          k="pairBody"
          arClass="text-[44px] font-normal leading-[1.4] text-white/90"
          enClass="text-[40px] leading-[1.2] text-white/72"
        />
        <form onSubmit={submit} className="flex items-end gap-[24px]">
          <label className="flex flex-1 flex-col gap-[10px]">
            <span className="text-[40px] font-bold leading-[1.2]">
              {A.pairLabel}{' '}
              <bdi lang="en" className="font-normal text-white/72">
                {E.pairLabel}
              </bdi>
            </span>
            <input
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              dir="ltr"
              lang="en"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-invalid={issue === 'invalid' || undefined}
              className="h-[96px] rounded-[28px] border-[3px] border-white/40 bg-white/10 px-[32px] text-[40px] text-white outline-none placeholder:text-white/50 focus:border-turquoise"
              placeholder="mcd_…"
            />
          </label>
          <button
            type="submit"
            disabled={pairing || !code.trim()}
            className="h-[96px] rounded-[28px] bg-white px-[56px] text-[40px] font-bold text-navy transition-colors disabled:bg-white/15 disabled:text-white/65"
          >
            {pairing ? A.pairing : A.pairAction}
          </button>
        </form>
        {problem && (
          <p role="alert" className="m-0 text-[40px] font-bold leading-[1.3] text-white">
            {problem[0]}{' '}
            <bdi lang="en" className="font-normal text-white/80">
              {problem[1]}
            </bdi>
          </p>
        )}
      </div>
      <SlowGear size={520} className="relative z-10 text-white/70" />
    </main>
  );
}
