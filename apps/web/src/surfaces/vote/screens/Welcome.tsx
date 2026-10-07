import { Button } from '../../../design-system/Button';
import { BRAND_TRAIL, Gear } from '../../../design-system/Motifs';
import { useI18n } from '../../../i18n';
import { navigate } from '../../../lib/nav';
import { ActionBar, BrandMark, Hero, LanguageToggle } from '../components/Chrome';
import { useVoter } from '../store';

const TRIANGLE = 'M44.6 25.7 0 0v51.4Z';

/** ① One promise, one button. The three steps are a real sequence, so they are shown as the brand's chevron trail. */
export function Welcome() {
  const { d } = useI18n();
  const { sessionEnded } = useVoter();
  return (
    <div className="flex min-h-dvh flex-col">
      <Hero className="flex min-h-[58dvh] flex-col px-6 pb-16 max-[700px]:min-h-[44dvh] max-[700px]:pb-12 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between">
          <BrandMark className="w-36" />
          <LanguageToggle onDark />
        </div>

        <div
          className="pointer-events-none relative mt-6 h-24 max-[700px]:hidden"
          aria-hidden="true"
        >
          <svg viewBox="0 0 44.6 51.4" className="drift absolute start-2 top-3 w-9">
            <path d={TRIANGLE} className="fill-yellow" />
          </svg>
          <span className="drift-slow absolute start-1/2 top-0 size-9 rounded-full bg-turquoise" />
          <Gear
            size={44}
            className="absolute end-6 top-5 text-white/80 !animate-[spin_14s_linear_infinite]"
          />
        </div>

        <div className="mt-auto">
          <h1 className="t-display max-w-[14ch]" tabIndex={-1} data-screen-title>
            {d.welcome.title}
          </h1>
          <p className="t-body mt-4 max-w-[36ch] text-white/90">{d.welcome.subtitle}</p>
        </div>
      </Hero>

      <div className="relative -mt-7 flex flex-1 flex-col rounded-t-[2rem] bg-canvas px-5 pt-8 shadow-[0_-14px_34px_-14px_rgb(0_0_60/0.5)]">
        <ol className="space-y-4 max-[700px]:space-y-3">
          {d.welcome.steps.map((label, i) => (
            <li key={label} className="flex items-center gap-4">
              <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-surface max-[700px]:size-11 shadow-[var(--shadow-card)]">
                <svg viewBox="0 0 44.6 51.4" className="h-6 rtl:-scale-x-100" aria-hidden="true">
                  <path d={TRIANGLE} fill={BRAND_TRAIL[i]} />
                </svg>
              </span>
              <span className="min-w-0">
                <span className="t-heading block text-navy">{label}</span>
                <span className="t-small block text-muted">
                  {d.welcome.stepsDetail[i]}
                </span>
              </span>
            </li>
          ))}
        </ol>

        {sessionEnded && (
          <p
            role="alert"
            className="t-small mt-5 rounded-[var(--radius-control)] bg-yellow-soft p-3.5 font-bold text-ink"
          >
            {d.errors.unauthenticated}
          </p>
        )}

        <ActionBar>
          <Button onClick={() => navigate('/vote/details')}>{d.welcome.start}</Button>
        </ActionBar>
      </div>
    </div>
  );
}
