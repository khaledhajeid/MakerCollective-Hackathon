import { useState, type FormEvent } from 'react';
import { Button } from '../../../design-system/Button';
import { CheckRow, FieldShell, TextField, controlClass } from '../../../design-system/Field';
import { Icon } from '../../../design-system/Icon';
import { useI18n } from '../../../i18n';
import { ApiError, api } from '../../../lib/api';
import { navigate } from '../../../lib/nav';
import { formatNational, isJordanMobile, nationalDigits } from '../../../lib/phone';
import { ActionBar, TopBar } from '../components/Chrome';
import { errorMessage } from '../errors';
import { useVoter } from '../store';

type FieldErrors = Partial<Record<'name' | 'phone' | 'consent', string>>;

/** ② Name, number, consent. One screen, one job: get a code sent. */
export function Details() {
  const { d, locale, fmt } = useI18n();
  const { draft, setDraft, setChallenge, recheckAccess } = useVoter();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const national = nationalDigits(draft.phone);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const next: FieldErrors = {};
    if (draft.name.trim().length < 2) next.name = d.details.errName;
    if (!isJordanMobile(national)) next.phone = d.details.errPhone;
    if (!draft.voteConsent) next.consent = d.details.errConsent;
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length) {
      // Move focus to the first problem so keyboard and screen-reader users land on it.
      document.querySelector<HTMLElement>('[aria-invalid="true"], [data-consent-invalid]')?.focus();
      return;
    }
    setBusy(true);
    try {
      const r = await api.requestOtp({
        name: draft.name.trim(),
        phone: `+962${national}`,
        voteConsent: draft.voteConsent,
        outreachConsent: draft.outreachConsent,
        locale,
      });
      const now = Date.now();
      setChallenge({
        id: r.challengeId,
        maskedPhone: r.maskedPhone,
        expiresAt: now + r.expiresInSeconds * 1000,
        resendAt: now + r.resendAfterSeconds * 1000,
      });
      navigate('/vote/code');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NOT_ON_VENUE_NETWORK') void recheckAccess();
      setFormError(errorMessage(err, d, fmt));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex min-h-dvh flex-col">
      <TopBar back="/vote" />
      <div className="flex-1 space-y-6 px-5 pt-6">
        <div className="space-y-2">
          <h1 className="t-title text-navy" tabIndex={-1} data-screen-title>
            {d.details.title}
          </h1>
          <p className="t-body text-muted">{d.details.subtitle}</p>
        </div>

        <TextField
          label={d.details.nameLabel}
          placeholder={d.details.namePlaceholder}
          value={draft.name}
          onChange={(e) => {
            setDraft({ ...draft, name: e.target.value });
            if (errors.name) setErrors((p) => ({ ...p, name: undefined }));
          }}
          autoComplete="name"
          enterKeyHint="next"
          maxLength={80}
          error={errors.name}
        />

        <FieldShell label={d.details.phoneLabel} hint={d.details.phoneHint} error={errors.phone}>
          {({ id, describedBy, invalid }) => (
            <div className="flex items-stretch gap-2">
              <span
                dir="ltr"
                className="grid min-h-14 place-items-center rounded-[var(--radius-control)] bg-purple-soft px-4 text-[1.0625rem] font-bold text-navy"
              >
                +962
              </span>
              <input
                id={id}
                dir="ltr"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                enterKeyHint="done"
                placeholder="79 123 4567"
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                value={formatNational(national)}
                onChange={(e) => {
                  setDraft({ ...draft, phone: nationalDigits(e.target.value) });
                  if (errors.phone) setErrors((p) => ({ ...p, phone: undefined }));
                }}
                className={`${controlClass(invalid)} min-w-0 flex-1 text-start tabular-nums tracking-wide rtl:text-end`}
              />
            </div>
          )}
        </FieldShell>

        <div className="space-y-1 rounded-[var(--radius-card)] bg-surface p-2 shadow-[var(--shadow-card)]">
          <div data-consent-invalid={errors.consent ? '' : undefined} tabIndex={-1}>
            <CheckRow
              checked={draft.voteConsent}
              invalid={!!errors.consent}
              onChange={(v) => {
                setDraft({ ...draft, voteConsent: v });
                if (v) setErrors((p) => ({ ...p, consent: undefined }));
              }}
            >
              {d.details.consentVote}
            </CheckRow>
          </div>
          {errors.consent && (
            <p
              role="alert"
              className="t-small flex items-center gap-1.5 px-3 pb-2 font-bold text-crimson"
            >
              <Icon name="alert" size={18} className="shrink-0" />
              {errors.consent}
            </p>
          )}
          <CheckRow
            checked={draft.outreachConsent}
            onChange={(v) => setDraft({ ...draft, outreachConsent: v })}
          >
            {d.details.consentOutreach}
          </CheckRow>
        </div>

        <details className="group rounded-[var(--radius-control)] px-1">
          <summary className="t-small flex min-h-12 cursor-pointer list-none items-center gap-2 font-bold text-royal [&::-webkit-details-marker]:hidden">
            <Icon name="shield" size={18} />
            {d.details.dataTitle}
            <Icon
              name="forward"
              size={16}
              flip
              className="ms-auto transition-transform group-open:rotate-90 rtl:group-open:-rotate-90"
            />
          </summary>
          <p className="t-small pb-2 pt-1 text-muted">{d.details.dataBody}</p>
        </details>

        {formError && (
          <p
            role="alert"
            className="t-small flex items-start gap-2 rounded-[var(--radius-control)] bg-crimson-soft p-3.5 font-bold text-crimson"
          >
            <Icon name="alert" size={20} className="mt-0.5 shrink-0" />
            {formError}
          </p>
        )}
      </div>
      <ActionBar>
        <Button type="submit" loading={busy}>
          {busy ? d.details.sending : d.details.send}
        </Button>
      </ActionBar>
    </form>
  );
}
