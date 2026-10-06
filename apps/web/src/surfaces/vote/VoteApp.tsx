import { Logo } from '../../design-system/Logo';

/** Visitor voting surface — real flow lands in Phase 3. */
export function VoteApp() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-between gap-8 px-6 py-10">
      <Logo className="w-64" />
      <div className="space-y-3 text-center">
        <h1 className="text-3xl font-bold text-navy">صوّت لصنّاعك المفضلين</h1>
        <p className="text-muted" lang="en" dir="ltr">
          Vote for your favourite makers
        </p>
      </div>
      <img src="/brand/chevrons.svg" alt="" className="h-6" />
    </main>
  );
}
