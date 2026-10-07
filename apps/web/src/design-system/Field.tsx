import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { Icon } from './Icon';

interface FieldShellProps {
  label: string;
  hint?: string;
  error?: string | null;
  children: (a: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

/** Label above the control (clearer than floating labels in Arabic), hint, and an error that says what to do. */
export function FieldShell({ label, hint, error, children }: FieldShellProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="t-label block text-navy">
        {label}
      </label>
      {children({
        id,
        describedBy: [errId, hintId].filter(Boolean).join(' ') || undefined,
        invalid: !!error,
      })}
      {error ? (
        <p
          id={errId}
          role="alert"
          className="t-small flex items-start gap-1.5 font-bold text-crimson"
        >
          <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p id={hintId} className="t-small text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The box a field lives in. The ring, the soft purple lift on focus and the "looks right" tick belong to the box, so
 * a leading piece (a badge, the +962 prefix) and the input read as ONE control, not two things side by side.
 */
export function FieldControl({
  invalid,
  valid,
  lead,
  children,
}: {
  invalid: boolean;
  /** The value is complete and acceptable: shows a tick at the end. Never the only signal (errors say it in words). */
  valid?: boolean;
  lead?: ReactNode;
  children: ReactNode;
}) {
  const showTick = !!valid && !invalid;
  return (
    // A tap anywhere in the box (the badge, the padding, the tick) puts the cursor in the field, like a plain input.
    // The transparent outline is what forced-colors / High Contrast mode draws as the focus indicator (shadows are dropped).
    <div
      onPointerDown={(e) => {
        const input = e.currentTarget.querySelector('input');
        if (input && e.target !== input) {
          e.preventDefault();
          input.focus();
        }
      }}
      className={`group flex min-h-14 items-center rounded-[var(--radius-control)] ps-2 pe-3 outline-transparent ring-[1.5px] ring-inset transition-[box-shadow,background-color] duration-200 focus-within:outline-2 focus-within:ring-[2.5px] ${
        invalid
          ? 'bg-crimson-soft/40 ring-crimson focus-within:ring-crimson'
          : 'bg-surface ring-line focus-within:shadow-[0_10px_24px_-12px_rgb(127_50_217/0.55)] focus-within:ring-purple'
      }`}
    >
      {lead && <span className="me-2 flex shrink-0">{lead}</span>}
      {children}
      {/* Takes no room until it shows, so a long name keeps the whole width. */}
      <span
        aria-hidden="true"
        className={`grid size-7 shrink-0 place-items-center overflow-hidden rounded-full bg-turquoise-soft text-navy transition-[width,margin,opacity,transform] duration-300 ease-[var(--ease-out-expo)] ${
          showTick ? 'ms-2 w-7 scale-100 opacity-100' : 'ms-0 w-0 scale-50 opacity-0'
        }`}
      >
        <Icon name="check" size={15} strokeWidth={3.2} className="shrink-0" />
      </span>
    </div>
  );
}

/** The round badge at the start of a field (`wide`: a pill, for text such as the +962 prefix). It warms to purple while the field has focus. */
export function LeadBadge({
  children,
  wide,
  decorative = true,
}: {
  children: ReactNode;
  wide?: boolean;
  /** False when the badge carries information a screen reader needs (the +962 prefix). */
  decorative?: boolean;
}) {
  return (
    <span
      aria-hidden={decorative || undefined}
      className={`grid h-10 shrink-0 place-items-center rounded-full bg-royal-soft text-[1.0625rem] font-black text-navy transition-colors duration-200 group-focus-within:bg-purple-soft group-focus-within:text-purple ${
        wide ? 'px-3.5' : 'w-10'
      }`}
    >
      {children}
    </span>
  );
}

export const inputClass =
  'h-14 min-w-0 flex-1 bg-transparent px-1 text-[1.0625rem] text-ink outline-none placeholder:text-muted [&:-webkit-autofill]:transition-[background-color] [&:-webkit-autofill]:duration-[99999ms] [&:-webkit-autofill]:[-webkit-text-fill-color:var(--color-ink)]';

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'id'> {
  label: string;
  hint?: string;
  error?: string | null;
  lead?: ReactNode;
  valid?: boolean;
}

export function TextField({ label, hint, error, lead, valid, ...input }: TextFieldProps) {
  return (
    <FieldShell label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => (
        <FieldControl invalid={invalid} valid={valid} lead={lead}>
          <input
            id={id}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            className={inputClass}
            {...input}
          />
        </FieldControl>
      )}
    </FieldShell>
  );
}

interface CheckProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
  invalid?: boolean;
}

/** A 48 px-tall checkbox row: the whole row is the target, not just the 24 px box. */
export function CheckRow({ checked, onChange, children, invalid }: CheckProps) {
  return (
    <label
      className={`flex min-h-12 cursor-pointer items-start gap-3 rounded-[var(--radius-control)] p-3 transition-colors ${
        invalid ? 'bg-crimson-soft' : 'active:bg-purple-soft'
      }`}
    >
      <span className="relative mt-0.5 grid size-6 shrink-0 place-items-center">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer absolute inset-0 size-6 cursor-pointer appearance-none rounded-md bg-surface ring-[1.5px] ring-inset ring-faint transition-colors checked:bg-purple checked:ring-purple"
        />
        <Icon
          name="check"
          size={16}
          strokeWidth={3.4}
          className="pointer-events-none relative text-white opacity-0 transition-opacity peer-checked:opacity-100"
        />
      </span>
      <span className="t-body text-ink">{children}</span>
    </label>
  );
}
