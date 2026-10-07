import { useQuery } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router';
import { Logo } from '../../design-system/Logo';
import { adminApi, setCsrf } from './api';
import { EnrollScreen, MfaScreen, PasswordScreen, SignIn } from './AuthScreens';
import { Shell } from './Shell';
import { Account } from './screens/Account';
import { Admins } from './screens/Admins';
import { Audit } from './screens/Audit';
import { Content } from './screens/Content';
import { Displays } from './screens/Displays';
import { Export } from './screens/Export';
import { Overview } from './screens/Overview';
import { Settings } from './screens/Settings';
import { SmsInbox } from './screens/SmsInbox';
import { Visitors } from './screens/Visitors';
import { Btn, ToastHost } from './ui';

/**
 * The organiser console. The server decides where a browser stands (`stage`): this component only draws the one
 * screen for that stage. Nothing here is a security boundary: every call is checked again by the API.
 */
export function AdminApp() {
  const session = useQuery({
    queryKey: ['admin', 'session'],
    queryFn: async () => {
      const s = await adminApi.session();
      if (s.authenticated) setCsrf(s.csrfToken);
      return s;
    },
    staleTime: Infinity,
    retry: 1,
  });

  return (
    <ToastHost>
      {session.isPending ? (
        <Loading />
      ) : session.error ? (
        <main
          className="grid min-h-dvh place-items-center gap-4 p-6 text-center"
          lang="en"
          dir="ltr"
        >
          <div className="space-y-4">
            <p className="text-base text-ink">The console cannot reach the server.</p>
            <Btn variant="primary" onClick={() => void session.refetch()}>
              Try again
            </Btn>
          </div>
        </main>
      ) : !session.data.authenticated ? (
        <SignIn />
      ) : session.data.stage === 'mfa' ? (
        <MfaScreen />
      ) : session.data.stage === 'enroll' ? (
        <EnrollScreen />
      ) : session.data.stage === 'password' ? (
        <PasswordScreen />
      ) : (
        <Shell admin={session.data.admin}>
          <Routes>
            <Route index element={<Overview />} />
            <Route path="content" element={<Content />} />
            <Route path="settings" element={<Settings />} />
            <Route path="displays" element={<Displays />} />
            <Route path="visitors" element={<Visitors role={session.data.admin.role} />} />
            <Route path="export" element={<Export />} />
            <Route path="audit" element={<Audit role={session.data.admin.role} />} />
            <Route
              path="users"
              element={<Admins role={session.data.admin.role} me={session.data.admin.username} />}
            />
            <Route path="inbox" element={<SmsInbox role={session.data.admin.role} />} />
            <Route path="account" element={<Account />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </Shell>
      )}
    </ToastHost>
  );
}

function Loading() {
  return (
    <main className="grid min-h-dvh place-items-center" lang="en" dir="ltr">
      <Logo className="w-56 opacity-60" alt="Loading the console" />
    </main>
  );
}
