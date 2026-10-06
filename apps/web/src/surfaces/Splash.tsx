/** Shown while a surface's code chunk loads — brand chevrons pulse in sequence. */
export function Splash() {
  return (
    <div className="flex min-h-dvh items-center justify-center" role="status" aria-label="Loading">
      <img src="/brand/chevrons.svg" alt="" className="h-6 animate-pulse" />
    </div>
  );
}
