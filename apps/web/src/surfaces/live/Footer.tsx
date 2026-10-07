import { A, E, QrCode, voteUrl } from './parts';

/**
 * The way in for anyone who walks up: a large static QR to the voter app, centred under the board, with the call to
 * action beside it. When there is more than one page of categories, the page dots sit at the far end.
 */
export function Footer({ showQr, pages, page }: { showQr: boolean; pages: number; page: number }) {
  return (
    <footer className="grid h-[200px] shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-[40px] text-white">
      {/* Right of the QR (reading side): what to do. The QR itself sits on the exact centre line of the screen. */}
      {showQr ? (
        <span className="block justify-self-end">
          <span lang="ar" className="block text-[56px] font-bold leading-[1.3]">
            {A.scanToVote}
          </span>
          <bdi lang="en" className="block text-[40px] leading-[1.2] text-dim">
            {E.scanToVote}
          </bdi>
        </span>
      ) : (
        <span />
      )}
      {showQr ? <QrCode text={voteUrl()} size={184} /> : <span />}
      {pages > 1 ? (
        <div className="flex items-center gap-[12px] justify-self-end" aria-hidden="true">
          {Array.from({ length: pages }, (_, i) => (
            <span
              key={i}
              className={`h-[16px] rounded-full transition-[width,background-color] duration-500 ${
                i === page ? 'w-[72px] bg-white' : 'w-[16px] bg-white/30'
              }`}
            />
          ))}
        </div>
      ) : (
        <span />
      )}
    </footer>
  );
}
