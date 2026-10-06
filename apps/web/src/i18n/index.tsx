import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Locale } from '@mc/shared';
import { ar, en, type Dict } from './dict';

const STORAGE_KEY = 'mc_locale';
const DICTS: Record<Locale, Dict> = { ar, en };

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'ar' || saved === 'en') return saved;
  } catch {
    /* storage can be blocked (private mode) — fall through */
  }
  return 'ar'; // Arabic-first: the default for everyone, whatever the phone's language
}

interface I18n {
  locale: Locale;
  dir: 'rtl' | 'ltr';
  d: Dict;
  setLocale: (l: Locale) => void;
  /** Locale-aware pick between an Arabic and an English value, falling back to whichever exists. */
  pick: (arValue: string | null | undefined, enValue: string | null | undefined) => string;
  /** `{name}`-style substitution. */
  fmt: (template: string, vars: Record<string, string | number>) => string;
  /** Western digits in both languages: they match SMS codes, phone numbers and Jordanian UI convention. */
  time: (iso: string) => string;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  useEffect(() => {
    const el = document.documentElement;
    el.lang = locale;
    el.dir = dir;
  }, [locale, dir]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* non-fatal */
    }
  }, []);

  const value = useMemo<I18n>(
    () => ({
      locale,
      dir,
      d: DICTS[locale],
      setLocale,
      pick: (a, e) =>
        locale === 'ar' ? a?.trim() || e?.trim() || '' : e?.trim() || a?.trim() || '',
      // Numbers are wrapped in LRI…PDI so digit groups ("79 123 4567", "0 of 3") never reorder inside RTL text.
      fmt: (template, vars) =>
        template.replace(/\{(\w+)\}/g, (m, k: string) => {
          if (!(k in vars)) return m;
          const v = vars[k]!;
          return typeof v === 'number' ? `\u2066${v}\u2069` : String(v);
        }),
      time: (iso) =>
        new Intl.DateTimeFormat(locale === 'ar' ? 'ar-JO-u-nu-latn' : 'en-GB', {
          timeZone: 'Asia/Amman',
          weekday: 'short',
          hour: 'numeric',
          minute: '2-digit',
        }).format(new Date(iso)),
    }),
    [locale, dir, setLocale],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n outside I18nProvider');
  return v;
}

/** Plural-aware count text for the (admin-defined) number of projects, using the CLDR rules for the locale. */
export function useCountLabel() {
  const { locale, d, fmt } = useI18n();
  const rules = useMemo(() => new Intl.PluralRules(locale), [locale]);
  return (n: number) => {
    const forms = d.category.count;
    return fmt(forms[rules.select(n)] ?? forms.other, { n });
  };
}
