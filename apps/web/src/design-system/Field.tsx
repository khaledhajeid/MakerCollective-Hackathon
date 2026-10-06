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
      <label htmlFor={id} className="t-label block text-ink">
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

export const controlClass = (invalid: boolean) =>
  `min-h-14 w-full rounded-[var(--radius-control)] bg-surface px-4 text-[1.0625rem] text-ink ring-[1.5px] ring-inset outline-none transition-shadow duration-150 placeholder:text-[#7c7c9c] focus:ring-[2.5px] ${
    invalid ? 'ring-crimson focus:ring-crimson' : 'ring-line focus:ring-purple'
  }`;

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'id'> {
  label: string;
  hint?: string;
  error?: string | null;
}

export function TextField({ label, hint, error, ...input }: TextFieldProps) {
  return (
    <FieldShell label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={controlClass(invalid)}
          {...input}
        />
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
          className="peer absolute inset-0 size-6 cursor-pointer appearance-none rounded-md bg-surface ring-[1.5px] ring-inset ring-[#8b8bab] transition-colors checked:bg-purple checked:ring-purple"
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
