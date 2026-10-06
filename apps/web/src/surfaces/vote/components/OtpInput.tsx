import { toAsciiDigits } from '@mc/shared/digits';
import { forwardRef } from 'react';

interface OtpInputProps {
  value: string;
  onChange: (v: string) => void;
  label: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  length?: number;
}

/**
 * Six visual cells over ONE real input. A single input is what makes iOS "From Messages" autofill, Android
 * WebOTP, paste and the numeric keyboard all work; separate per-digit inputs break every one of them.
 */
export const OtpInput = forwardRef<HTMLInputElement, OtpInputProps>(function OtpInput(
  { value, onChange, label, disabled, invalid, describedBy, length = 6 },
  ref,
) {
  return (
    <div className="relative" dir="ltr">
      <input
        ref={ref}
        data-autofocus
        value={value}
        disabled={disabled}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={length * 2}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(e) =>
          onChange(toAsciiDigits(e.target.value).replace(/\D/g, '').slice(0, length))
        }
        className="absolute inset-0 z-10 h-full w-full cursor-text bg-transparent text-[16px] text-transparent caret-transparent outline-none"
      />
      <div className="grid grid-cols-6 gap-2" aria-hidden="true">
        {Array.from({ length }, (_, i) => {
          const active = !disabled && i === Math.min(value.length, length - 1);
          const filled = i < value.length;
          return (
            <div
              key={i}
              className={`grid h-16 place-items-center rounded-[var(--radius-control)] text-[1.75rem] font-bold tabular-nums transition-[box-shadow,transform] duration-150 ${
                invalid
                  ? 'bg-crimson-soft text-crimson ring-2 ring-crimson'
                  : active
                    ? 'bg-surface text-navy ring-[2.5px] ring-purple'
                    : 'bg-surface text-navy ring-[1.5px] ring-line'
              } ${filled ? 'scale-[1.03]' : ''}`}
            >
              {value[i] ?? ''}
            </div>
          );
        })}
      </div>
    </div>
  );
});
