import { useEffect, useState } from 'react';
import { Button } from '../../../design-system/Button';
import { ChevronTrail } from '../../../design-system/Motifs';
import { useI18n } from '../../../i18n';
import { navigate } from '../../../lib/nav';
import { Celebration } from '../components/Celebration';
import { BrandMark, Hero, LanguageToggle } from '../components/Chrome';
import { VoteRecap } from '../components/VoteRecap';
import { useVoter } from '../store';

/** ⑦ All categories voted: the big reward moment, then a recap of the choices. */
export function Finish() {
  const { d, fmt } = useI18n();
  const { visitor, categories, signOut } = useVoter();
  const total = categories.data?.length ?? 0;
  const [lit, setLit] = useState(0);
  useEffect(() => {
    const t = window.setTimeout(() => setLit(total), 600);
    return () => window.clearTimeout(t);
  }, [total]);
  const firstName = (visitor?.name ?? '').trim().split(/\s+/)[0] ?? '';

  return (
    <Hero
      tone="teal"
      className="flex min-h-dvh flex-col px-6 pb-10 pt-[max(1rem,env(safe-area-inset-top))]"
    >
      <div className="flex items-center justify-between">
        <BrandMark className="w-28" />
        <LanguageToggle onDark />
      </div>

      <div className="mt-6 flex flex-col items-center text-center">
        <Celebration size={104} />
        <h1 className="t-display -mt-6" tabIndex={-1} data-screen-title dir="auto">
          {fmt(d.finish.title, { name: firstName })}
        </h1>
        <p className="t-body mt-3 max-w-[34ch] text-white/90">{d.finish.body}</p>
        <ChevronTrail total={total} filled={lit} onDark stagger={160} className="mt-6" />
      </div>

      <section className="mt-8" aria-labelledby="recap-title">
        <h2 id="recap-title" className="t-heading mb-3 text-white">
          {d.finish.recap}
        </h2>
        <VoteRecap onDark />
      </section>

      <div className="mt-auto space-y-2 pt-8">
        <Button variant="onDark" onClick={() => navigate('/vote', { replace: true, dir: 'back' })}>
          {d.finish.review}
        </Button>
        <button
          type="button"
          onClick={() =>
            void signOut().then(() => navigate('/vote', { replace: true, dir: 'back' }))
          }
          className="t-small mx-auto block min-h-12 rounded-lg px-4 font-bold text-white/80 underline decoration-2 underline-offset-4"
        >
          {d.common.signOut}
        </button>
      </div>
    </Hero>
  );
}
