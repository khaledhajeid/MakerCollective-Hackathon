import type {
  AdminCredentialsIssued,
  AdminSessionInfo,
  AdminUser,
  AuditPage,
  CreateAdmin,
  MfaEnrollStart,
  MfaEnrolled,
  MfaVerified,
  UpdateAdmin,
} from '@mc/shared';
import type {
  AdminCategory,
  AdminContent,
  AdminDisplay,
  AdminExhibitor,
  AdminSettings,
  CategoryCreate,
  CategoryPatch,
  DisplayCreated,
  ExhibitorCreate,
  ExhibitorPatch,
  ExportKind,
  LiveResults,
  ModeChanged,
  NetworkMe,
  Overview,
  SettingsPatch,
  SmsInbox,
  VisitorPage,
} from '@mc/shared/manage';
import type { ErrorCode, ResultsVisibility } from '@mc/shared';
import { ApiError } from '../../lib/api';

export { ApiError };

/** The per-session CSRF token the server issued at sign-in. It lives in memory only (never in storage). */
let csrf = '';
export const setCsrf = (token: string) => {
  csrf = token;
};

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

async function request<T>(
  method: Method,
  path: string,
  body?: unknown,
  raw?: { blob: Blob; type: string },
): Promise<T> {
  let res: Response;
  const headers: Record<string, string> = {};
  if (method !== 'GET') headers['x-csrf-token'] = csrf;
  let payload: BodyInit | undefined;
  if (raw) {
    headers['content-type'] = raw.type;
    payload = raw.blob;
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  try {
    res = await fetch(`/api/admin${path}`, {
      method,
      credentials: 'same-origin',
      headers,
      body: payload,
      signal: AbortSignal.timeout(raw ? 60_000 : 20_000),
    });
  } catch {
    throw new ApiError(0, 'NETWORK');
  }
  if (res.ok) {
    try {
      return (await res.json()) as T;
    } catch {
      throw new ApiError(0, 'NETWORK');
    }
  }
  let code: ErrorCode | null = null;
  let message = '';
  let details: unknown;
  try {
    const parsed = (await res.json()) as {
      error?: { code?: ErrorCode; message?: string; details?: unknown };
    };
    code = parsed.error?.code ?? null;
    message = parsed.error?.message ?? '';
    details = parsed.error?.details;
  } catch {
    /* gateway page */
  }
  if (!code && (res.status === 502 || res.status === 503 || res.status === 504))
    throw new ApiError(res.status, 'NETWORK');
  const err = Object.assign(new ApiError(res.status, code ?? 'INTERNAL', details), { path });
  // The server's sentence is written for organisers ("This category already has votes…"); keep it.
  err.message = message || err.message;
  throw err;
}

const get = <T>(p: string) => request<T>('GET', p);
const send = <T>(m: Exclude<Method, 'GET'>, p: string, b?: unknown) => request<T>(m, p, b ?? {});

export const adminApi = {
  /* sign-in */
  session: () => get<AdminSessionInfo>('/auth/session'),
  login: (username: string, password: string) =>
    send<AdminSessionInfo>('POST', '/auth/login', { username, password }),
  verify: (body: { code: string } | { recoveryCode: string }) =>
    send<MfaVerified>('POST', '/auth/mfa/verify', body),
  enrollStart: () => send<MfaEnrollStart>('POST', '/auth/mfa/enroll/start'),
  enrollConfirm: (code: string) => send<MfaEnrolled>('POST', '/auth/mfa/enroll/confirm', { code }),
  recoveryCodes: (code: string) =>
    send<{ recoveryCodes: string[] }>('POST', '/auth/recovery-codes', { code }),
  changePassword: (currentPassword: string, newPassword: string) =>
    send<AdminSessionInfo>('POST', '/auth/password', { currentPassword, newPassword }),
  logout: () => send<{ ok: true }>('POST', '/auth/logout'),

  /* event */
  overview: () => get<Overview>('/overview'),
  liveResults: () => get<LiveResults>('/results/live'),
  setMode: (mode: ResultsVisibility) => send<ModeChanged>('POST', '/results/mode', { mode }),
  reveal: (categoryId: string) =>
    send<{ categoryId: string; changed: boolean }>('POST', '/results/reveal', { categoryId }),

  /* content */
  content: () => get<AdminContent>('/content'),
  createCategory: (b: CategoryCreate) => send<AdminCategory>('POST', '/categories', b),
  updateCategory: (id: string, b: CategoryPatch) =>
    send<AdminCategory>('PATCH', `/categories/${id}`, b),
  reorderCategories: (ids: string[]) =>
    send<{ categories: AdminCategory[] }>('PUT', '/categories/order', { ids }),
  deleteCategory: (id: string) => send<{ ok: true }>('DELETE', `/categories/${id}`),
  createExhibitor: (b: ExhibitorCreate) => send<AdminExhibitor>('POST', '/exhibitors', b),
  updateExhibitor: (id: string, b: ExhibitorPatch) =>
    send<AdminExhibitor>('PATCH', `/exhibitors/${id}`, b),
  deleteExhibitor: (id: string) => send<{ ok: true }>('DELETE', `/exhibitors/${id}`),
  setPhoto: (id: string, blob: Blob) =>
    request<AdminExhibitor>('PUT', `/exhibitors/${id}/photo`, undefined, {
      blob,
      type: 'image/webp',
    }),
  removePhoto: (id: string) => send<AdminExhibitor>('DELETE', `/exhibitors/${id}/photo`),

  /* settings */
  settings: () => get<AdminSettings>('/settings'),
  updateSettings: (b: SettingsPatch) => send<AdminSettings>('PATCH', '/settings', b),
  networkMe: () => get<NetworkMe>('/network/me'),

  /* displays */
  displays: () => get<{ displays: AdminDisplay[] }>('/displays'),
  createDisplay: (label: string) => send<DisplayCreated>('POST', '/displays', { label }),
  revokeDisplay: (id: string) => send<{ ok: true }>('DELETE', `/displays/${id}`),

  /* visitors */
  visitors: (q: { after?: string; phone?: string }) => {
    const p = new URLSearchParams({ limit: '50' });
    if (q.after) p.set('after', q.after);
    if (q.phone) p.set('phone', q.phone);
    return get<VisitorPage>(`/visitors?${p}`);
  },
  blockVisitor: (id: string, blocked: boolean) =>
    send<{ blocked: boolean }>('POST', `/visitors/${id}/block`, { blocked }),
  signOutVisitor: (id: string) => send<{ ok: true }>('POST', `/visitors/${id}/sign-out`),
  revealVisitor: (id: string, reason: string) =>
    send<{ name: string; phone: string }>('POST', `/visitors/${id}/reveal`, { reason }),
  clearThrottle: (phone: string) =>
    send<{ cleared: number }>('POST', '/otp-throttle/clear', { phone }),

  /* export, inbox */
  exportUrl: (kind: ExportKind) => `/api/admin/export/${kind}`,
  smsInbox: () => get<SmsInbox>('/sms-inbox'),

  /* accounts, audit (SUPER_ADMIN) */
  users: () => get<{ users: AdminUser[] }>('/users'),
  createUser: (b: CreateAdmin) => send<AdminCredentialsIssued>('POST', '/users', b),
  updateUser: (id: string, b: UpdateAdmin) => send<AdminUser>('PATCH', `/users/${id}`, b),
  unlockUser: (id: string) => send<AdminUser>('POST', `/users/${id}/unlock`),
  resetUser: (id: string) => send<AdminCredentialsIssued>('POST', `/users/${id}/reset-credentials`),
  signOutUser: (id: string) => send<{ ended: number }>('POST', `/users/${id}/sign-out`),
  audit: (before?: number) => get<AuditPage>(`/audit?limit=50${before ? `&before=${before}` : ''}`),
};

/** One sentence an organiser can act on, for any failed call. */
export function explain(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Something went wrong. Try again.';
  if (err.isNetwork) return 'Cannot reach the server. Check the connection and try again.';
  switch (err.code) {
    case 'UNAUTHENTICATED':
      return 'You were signed out. Sign in again.';
    case 'FORBIDDEN':
      return 'Your role cannot do that.';
    case 'RATE_LIMITED':
      return `Too many attempts. Wait ${err.retryAfterSeconds ?? 60} seconds and try again.`;
    case 'CSRF_FAILED':
      return 'The page was out of date. Reload and try again.';
    case 'INTERNAL':
      return 'The server hit a problem. Try again in a moment.';
    default:
      return err.message && err.message !== err.code
        ? err.message
        : 'That did not work. Try again.';
  }
}
