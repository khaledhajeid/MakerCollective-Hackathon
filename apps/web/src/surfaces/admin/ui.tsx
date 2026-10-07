import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { AIcon, type AIconName } from './icons';

/**
 * The console's component vocabulary (Operate mode: familiar controls, dense but never cramped, 44 px targets).
 * One button shape, one field shape, one badge shape, used everywhere, so nothing on a screen is a surprise.
 */

/* ───────────── buttons ───────────── */

type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
const BTN: Record<BtnVariant, string> = {
  primary:
    'bg-purple text-white hover:bg-[#6d27c4] active:bg-[#5f20ae] disabled:bg-purple/40 shadow-[0_1px_2px_rgb(0_0_60/0.2)]',
  secondary:
    'bg-surface text-navy ring-1 ring-inset ring-line hover:bg-canvas hover:ring-faint active:bg-royal-soft disabled:text-muted/60',
  danger:
    'bg-crimson text-white hover:bg-[#8e2331] active:bg-[#7c1d2a] disabled:bg-crimson/40 shadow-[0_1px_2px_rgb(60_0_0/0.2)]',
  ghost:
    'bg-transparent text-[#3a54b8] hover:bg-royal-soft active:bg-royal-soft disabled:text-muted/60',
};

interface BtnProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: BtnVariant;
  icon?: AIconName;
  loading?: boolean;
  small?: boolean;
  className?: string;
}

export function Btn({
  variant = 'secondary',
  icon,
  loading,
  small,
  className = '',
  children,
  disabled,
  type = 'button',
  ...rest
}: BtnProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 font-bold whitespace-nowrap transition-colors duration-150 disabled:cursor-not-allowed ${
        small ? 'min-h-11 text-sm sm:min-h-9 sm:px-3' : 'min-h-11 text-[0.9375rem]'
      } ${BTN[variant]} ${className}`}
      {...rest}
    >
      {loading ? <Spinner /> : icon ? <AIcon name={icon} size={18} /> : null}
      {children}
    </button>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Working"
      className={`size-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}

/* ───────────── fields ───────────── */

const control =
  'min-h-11 w-full rounded-xl bg-surface px-3.5 text-[0.9375rem] text-ink ring-1 ring-inset outline-none transition-shadow duration-150 placeholder:text-muted/70 focus:ring-2 disabled:bg-canvas disabled:text-muted';
const ringFor = (bad: boolean) =>
  bad ? 'ring-crimson focus:ring-crimson' : 'ring-line hover:ring-faint focus:ring-purple';

interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  className?: string;
}

function Shell({
  label,
  hint,
  error,
  className = '',
  children,
}: FieldProps & {
  children: (a: { id: string; describedBy?: string; bad: boolean }) => ReactNode;
}) {
  const id = useId();
  const describedBy = error ? `${id}-e` : hint ? `${id}-h` : undefined;
  return (
    <div className={`space-y-1.5 ${className}`}>
      <label htmlFor={id} className="block text-sm font-bold text-ink">
        {label}
      </label>
      {children({ id, describedBy, bad: !!error })}
      {error ? (
        <p
          id={`${id}-e`}
          role="alert"
          className="flex items-start gap-1.5 text-sm font-bold text-crimson"
        >
          <AIcon name="alert" size={16} className="mt-0.5" />
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-h`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Input({
  label,
  hint,
  error,
  className,
  ...rest
}: FieldProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'id'>) {
  return (
    <Shell label={label} hint={hint} error={error} className={className}>
      {({ id, describedBy, bad }) => (
        <input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={bad || undefined}
          className={`${control} ${ringFor(bad)}`}
          {...rest}
        />
      )}
    </Shell>
  );
}

export function TextArea({
  label,
  hint,
  error,
  className,
  ...rest
}: FieldProps & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className' | 'id'>) {
  return (
    <Shell label={label} hint={hint} error={error} className={className}>
      {({ id, describedBy, bad }) => (
        <textarea
          id={id}
          aria-describedby={describedBy}
          aria-invalid={bad || undefined}
          className={`${control} min-h-24 py-2.5 leading-relaxed ${ringFor(bad)}`}
          {...rest}
        />
      )}
    </Shell>
  );
}

export function Select({
  label,
  hint,
  error,
  className,
  children,
  ...rest
}: FieldProps & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className' | 'id'>) {
  return (
    <Shell label={label} hint={hint} error={error} className={className}>
      {({ id, describedBy, bad }) => (
        <select
          id={id}
          aria-describedby={describedBy}
          className={`${control} ${ringFor(bad)}`}
          {...rest}
        >
          {children}
        </select>
      )}
    </Shell>
  );
}

export function Check({
  checked,
  onChange,
  children,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-1 text-[0.9375rem] text-ink has-[:disabled]:cursor-not-allowed has-[:disabled]:text-muted">
      <span className="relative grid size-5 shrink-0 place-items-center">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="peer absolute inset-0 size-5 cursor-pointer appearance-none rounded-md bg-surface ring-1 ring-inset ring-faint transition-colors checked:bg-purple checked:ring-purple disabled:cursor-not-allowed"
        />
        <AIcon
          name="check"
          size={14}
          strokeWidth={3.2}
          className="pointer-events-none relative text-white opacity-0 peer-checked:opacity-100"
        />
      </span>
      <span>{children}</span>
    </label>
  );
}

/** A row of mutually exclusive choices (a native radio group underneath, so arrows and screen readers just work). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; hint?: string }>;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  const name = useId();
  return (
    <fieldset className="min-w-0" disabled={disabled}>
      <legend className="sr-only">{label}</legend>
      <div className="inline-flex max-w-full flex-wrap gap-1 rounded-2xl bg-canvas p-1 ring-1 ring-inset ring-line">
        {options.map((o) => (
          <label
            key={o.value}
            className={`relative flex min-h-11 cursor-pointer items-center rounded-xl px-4 text-sm font-bold transition-colors has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-royal has-[:disabled]:cursor-not-allowed ${
              o.value === value
                ? 'bg-navy text-white shadow-[0_1px_3px_rgb(0_0_60/0.3)]'
                : 'text-navy hover:bg-surface'
            }`}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={o.value === value}
              onChange={() => onChange(o.value)}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/* ───────────── surfaces ───────────── */

export function Panel({
  title,
  action,
  children,
  className = '',
  pad = true,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  pad?: boolean;
}) {
  return (
    <section
      className={`rounded-2xl bg-surface shadow-[0_1px_2px_rgb(0_0_123/0.06),0_8px_24px_-12px_rgb(0_0_123/0.14)] ring-1 ring-line/70 ${className}`}
    >
      {(title || action) && (
        <header className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
          {title && <h2 className="text-base font-bold text-navy">{title}</h2>}
          {action}
        </header>
      )}
      <div className={pad ? 'p-5' : ''}>{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  lead,
  actions,
}: {
  title: string;
  lead?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1
          data-screen-title
          tabIndex={-1}
          className="text-[1.625rem] leading-tight font-extrabold text-navy"
        >
          {title}
        </h1>
        {lead && <p className="mt-1 max-w-[65ch] text-[0.9375rem] text-muted">{lead}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info' | 'purple';
const TONES: Record<Tone, string> = {
  neutral: 'bg-canvas text-muted ring-line',
  good: 'bg-turquoise-soft text-navy ring-turquoise/60',
  warn: 'bg-yellow-soft text-navy ring-yellow/70',
  bad: 'bg-crimson-soft text-crimson ring-crimson/25',
  info: 'bg-royal-soft text-[#3a54b8] ring-royal/25',
  purple: 'bg-purple-soft text-[#5f20ae] ring-purple/25',
};
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap ring-1 ring-inset ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export function Notice({
  tone = 'info',
  children,
  className = '',
}: {
  tone?: 'info' | 'warn' | 'bad' | 'good';
  children: ReactNode;
  className?: string;
}) {
  const t = { info: TONES.info, warn: TONES.warn, bad: TONES.bad, good: TONES.good }[tone];
  return (
    <div
      role={tone === 'bad' ? 'alert' : undefined}
      className={`flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm ring-1 ring-inset ${t} ${className}`}
    >
      <AIcon
        name={tone === 'bad' || tone === 'warn' ? 'alert' : 'info'}
        size={18}
        className="mt-0.5"
      />
      <div className="min-w-0 space-y-1">{children}</div>
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-xl bg-skeleton ${className}`} />;
}

export function Empty({
  icon,
  title,
  children,
  action,
}: {
  icon: AIconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-royal-soft text-royal">
        <AIcon name={icon} size={24} />
      </span>
      <h3 className="mt-1 text-base font-bold text-navy">{title}</h3>
      {children && <p className="max-w-[48ch] text-sm text-muted">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** A failed load: says what happened and offers the one next step. */
export function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <Panel>
      <Empty
        icon="alert"
        title="This could not be loaded"
        action={
          <Btn onClick={onRetry} icon="refresh">
            Try again
          </Btn>
        }
      >
        {explainLoad(error)}
      </Empty>
    </Panel>
  );
}
function explainLoad(error: unknown) {
  const m = error instanceof Error ? error.message : '';
  return m && m !== 'NETWORK' && m !== 'INTERNAL'
    ? m
    : 'Check the connection to the server, then try again.';
}

/* ───────────── dialog ───────────── */

/**
 * A native <dialog>: the browser supplies the focus trap, inert background, Esc and the top layer. Used only where a
 * decision or a short form genuinely needs protected focus (confirmations, one-time secrets, the photo cropper).
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  wide,
  locked,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
  /** Block dismissal while a request is in flight. */
  locked?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!locked) onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current && !locked) onClose();
      }}
      className={`m-auto max-h-[92dvh] w-[calc(100%-2rem)] overflow-auto rounded-2xl bg-surface p-0 text-ink shadow-[0_24px_64px_-12px_rgb(0_0_60/0.45)] backdrop:bg-navy-deep/55 ${
        wide ? 'max-w-2xl' : 'max-w-md'
      }`}
    >
      {open && (
        <div className="p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 id={titleId} className="text-lg font-extrabold text-navy">
              {title}
            </h2>
            <button
              type="button"
              aria-label="Close"
              disabled={locked}
              onClick={onClose}
              className="-me-2 -mt-2 grid size-11 place-items-center rounded-xl text-muted hover:bg-canvas disabled:opacity-40"
            >
              <AIcon name="close" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

/** Ask before anything that is hard to undo; the action is named on the button, and a phrase can be required. */
export function Confirm({
  open,
  onClose,
  title,
  children,
  confirmLabel,
  danger,
  typeToConfirm,
  busy,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** The organiser must type this exact word before the button works. */
  typeToConfirm?: string;
  busy?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title} locked={busy}>
      <ConfirmBody
        onClose={onClose}
        confirmLabel={confirmLabel}
        danger={danger}
        typeToConfirm={typeToConfirm}
        busy={busy}
        onConfirm={onConfirm}
      >
        {children}
      </ConfirmBody>
    </Dialog>
  );
}

/** Mounted only while the dialog is open, so the typed phrase always starts empty. */
function ConfirmBody({
  children,
  onClose,
  confirmLabel,
  danger,
  typeToConfirm,
  busy,
  onConfirm,
}: Pick<
  Parameters<typeof Confirm>[0],
  'children' | 'onClose' | 'confirmLabel' | 'danger' | 'typeToConfirm' | 'busy' | 'onConfirm'
>) {
  const [typed, setTyped] = useState('');
  const ready = !typeToConfirm || typed.trim().toUpperCase() === typeToConfirm.toUpperCase();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !busy) onConfirm();
      }}
      className="space-y-4"
    >
      <div className="space-y-2 text-[0.9375rem] text-ink">{children}</div>
      {typeToConfirm && (
        <Input
          label={`Type ${typeToConfirm} to confirm`}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          autoFocus
        />
      )}
      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <Btn onClick={onClose} disabled={busy}>
          Cancel
        </Btn>
        <Btn type="submit" variant={danger ? 'danger' : 'primary'} disabled={!ready} loading={busy}>
          {confirmLabel}
        </Btn>
      </div>
    </form>
  );
}

/* ───────────── toasts ───────────── */

interface Toast {
  id: number;
  tone: 'good' | 'bad';
  text: string;
}
const ToastCtx = createContext<(tone: Toast['tone'], text: string) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast['tone'], text: string) => {
    const id = Date.now() + Math.random();
    setItems((cur) => [...cur.slice(-3), { id, tone, text }]);
    setTimeout(
      () => setItems((cur) => cur.filter((t) => t.id !== id)),
      tone === 'bad' ? 9000 : 4000,
    );
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        dir="ltr"
        lang="en"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[70] flex flex-col items-center gap-2 px-4"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'bad' ? 'alert' : 'status'}
            className={`pointer-events-auto flex max-w-lg items-start gap-2.5 rounded-xl px-4 py-3 text-sm font-bold shadow-[0_12px_32px_-8px_rgb(0_0_60/0.45)] ${
              t.tone === 'bad' ? 'bg-crimson text-white' : 'bg-navy text-white'
            }`}
          >
            <AIcon name={t.tone === 'bad' ? 'alert' : 'check'} size={18} className="mt-0.5" />
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ───────────── small helpers ───────────── */

export function fmtTime(iso: string | null, opts: Intl.DateTimeFormatOptions = {}): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Amman',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    ...opts,
  }).format(new Date(iso));
}

/**
 * Hands a generated file to the browser's download. The link is attached to the page while it is clicked (Safari and older
 * Firefox ignore a detached one) and the temporary address is kept alive for a while: revoking it at once can cancel a
 * download that has not started yet, and for recovery codes this is the only copy.
 */
export function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function CopyBtn({ text, label = 'Copy' }: { text: string; label?: string }) {
  const toast = useToast();
  return (
    <Btn
      small
      icon="copy"
      onClick={() => {
        void navigator.clipboard
          .writeText(text)
          .then(() => toast('good', 'Copied'))
          .catch(() => toast('bad', 'Copy failed. Select the text and copy it by hand.'));
      }}
    >
      {label}
    </Btn>
  );
}
