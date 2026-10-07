import { Rings } from '../../design-system/Motifs';
import { Bi, QrCode, SlowGear, voteUrl } from './parts';

/**
 * Nothing is released yet (Blind Hour hidden, or Reveal before the first announcement). There are no numbers
 * anywhere on this screen by construction: the server sent none.
 */
export function SealedScreen() {
  return (
    <section
      aria-label="Sealed"
      className="tv-stage-in relative flex h-full items-center justify-between overflow-hidden rounded-[40px] bg-white/[0.05]"
    >
      <Rings
        className="rings-turn absolute -start-[260px] top-1/2 size-[1100px] -translate-y-1/2 opacity-70"
        stroke="rgb(255 255 255 / 0.1)"
      />
      <div className="relative z-10 flex flex-col gap-[28px] ps-[96px]">
        <Bi
          k="resultsSealed"
          arClass="text-[120px] font-bold leading-[1.2]"
          enClass="text-[56px] leading-[1.15] text-white/80"
        />
        <Bi
          k="announceSoon"
          arClass="text-[56px] font-bold leading-[1.25] text-white"
          enClass="text-[40px] leading-[1.15] text-dim"
        />
      </div>
      <SlowGear size={560} className="relative z-10 me-[80px] text-white/85" />
    </section>
  );
}

/** Live, but nobody has voted yet: invite the room to be first. */
export function WaitingScreen() {
  return (
    <section
      aria-label="Waiting"
      className="tv-stage-in relative flex h-full items-center justify-between overflow-hidden rounded-[40px] bg-white/[0.05]"
    >
      <Rings
        className="rings-turn absolute -start-[260px] top-1/2 size-[1100px] -translate-y-1/2 opacity-70"
        stroke="rgb(255 255 255 / 0.1)"
      />
      <div className="relative z-10 flex flex-col gap-[28px] ps-[96px]">
        <Bi
          k="waitingTitle"
          arClass="text-[104px] font-bold leading-[1.2]"
          enClass="text-[52px] leading-[1.15] text-white/80"
        />
        <Bi
          k="waitingBody"
          arClass="text-[56px] font-bold leading-[1.25] text-white"
          enClass="text-[40px] leading-[1.15] text-dim"
        />
      </div>
      <div className="relative z-10 me-[96px] flex items-center justify-center">
        <SlowGear size={640} className="absolute text-white/30" />
        <QrCode text={voteUrl()} size={380} className="relative" />
      </div>
    </section>
  );
}
