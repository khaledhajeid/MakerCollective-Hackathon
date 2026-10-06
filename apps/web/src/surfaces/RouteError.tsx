import { Logo } from '../design-system/Logo';

export function RouteError() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 p-6 text-center">
      <Logo className="w-56" />
      <p className="text-lg font-bold text-navy">حدث خطأ غير متوقع · Something went wrong</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="min-h-12 rounded-full bg-purple px-8 font-bold text-white"
      >
        إعادة المحاولة · Try again
      </button>
    </main>
  );
}
