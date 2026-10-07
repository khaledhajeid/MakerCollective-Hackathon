import { AnimatePresence, animate, m, useMotionValue } from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { spring } from './motion';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** id of the element that titles the sheet (aria-labelledby). */
  labelledBy: string;
  /** Block dismissal (backdrop, Esc, drag) while a vote is in flight. */
  locked?: boolean;
  handleLabel: string;
  children: ReactNode;
}

/**
 * Bottom sheet on a native <dialog>: the browser supplies the focus trap, inert background, Esc handling and
 * the top layer, so none of that is re-implemented (and none of it can be got wrong). We add the spring
 * entrance, a backdrop fade and drag-to-dismiss from the handle.
 */
export function Sheet({
  open,
  onClose,
  labelledBy,
  locked = false,
  handleLabel,
  children,
}: SheetProps) {
  return (
    <AnimatePresence>
      {open && (
        <SheetBody
          onClose={onClose}
          labelledBy={labelledBy}
          locked={locked}
          handleLabel={handleLabel}
        >
          {children}
        </SheetBody>
      )}
    </AnimatePresence>
  );
}

function SheetBody({
  onClose,
  labelledBy,
  locked,
  handleLabel,
  children,
}: Omit<SheetProps, 'open'>) {
  const dialog = useRef<HTMLDialogElement>(null);
  const y = useMotionValue(0);
  const drag = useRef<{ startY: number; startT: number } | null>(null);

  useEffect(() => {
    const el = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    el?.showModal();
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = '';
      previous?.focus?.({ preventScroll: true });
    };
  }, []);

  const close = () => {
    if (!locked) onClose();
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby={labelledBy}
      onCancel={(e) => {
        e.preventDefault(); // Esc: route through our own exit animation
        close();
      }}
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none overflow-hidden border-0 bg-transparent p-0 text-ink backdrop:bg-transparent"
      // `overflow: clip` (not just hidden): the panel starts translated off-screen, and showModal() focuses the confirm
      // button inside it. A hidden-overflow box can still be scrolled by that focus, which made the whole sheet jump
      // up by its own height as it opened (visible on iOS Safari). A clipped box cannot be scrolled at all. Browsers
      // without `clip` drop the declaration and keep the class's `overflow-hidden`.
      style={{ zIndex: 'var(--z-sheet)', overflow: 'clip' }}
    >
      <m.div
        className="absolute inset-0 bg-[rgb(0_0_50/0.58)]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.22 }}
        onClick={close}
      />
      <m.div
        className="absolute inset-x-0 bottom-0 mx-auto max-h-full w-full max-w-md overflow-y-auto overscroll-contain rounded-t-[2rem] bg-surface pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[var(--shadow-sheet)]"
        style={{ y }}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '105%' }}
        transition={spring.sheet}
      >
        <div
          className="flex h-9 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
          role="presentation"
          title={handleLabel}
          onPointerDown={(e) => {
            if (locked) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { startY: e.clientY, startT: e.timeStamp };
          }}
          onPointerMove={(e) => {
            if (drag.current) y.set(Math.max(0, e.clientY - drag.current.startY));
          }}
          onPointerUp={(e) => {
            const d = drag.current;
            drag.current = null;
            if (!d) return;
            const dy = Math.max(0, e.clientY - d.startY);
            const velocity = dy / Math.max(1, e.timeStamp - d.startT);
            if (dy > 110 || velocity > 0.6) close();
            else animate(y, 0, spring.sheet);
          }}
          onPointerCancel={() => {
            drag.current = null;
            animate(y, 0, spring.sheet);
          }}
        >
          <span className="h-1.5 w-11 rounded-full bg-line" />
        </div>
        {children}
      </m.div>
    </dialog>
  );
}
