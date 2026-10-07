import { useQuery } from '@tanstack/react-query';
import type { AdminRole } from '@mc/shared';
import { adminApi } from '../api';
import { Empty, fmtTime, LoadError, Notice, PageHeader, Panel, Skeleton } from './../ui';
import { NoAccess } from './Audit';

export function SmsInbox({ role }: { role: AdminRole }) {
  const q = useQuery({
    queryKey: ['admin', 'inbox'],
    queryFn: adminApi.smsInbox,
    refetchInterval: 4000,
    enabled: role === 'SUPER_ADMIN',
    retry: false,
  });
  if (role !== 'SUPER_ADMIN') return <NoAccess />;
  if (q.error && !q.data) return <LoadError error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <>
      <PageHeader
        title="SMS inbox"
        lead="For the demo and for testing: the messages the system would have sent to phones, including their one-time codes."
      />
      <div className="space-y-4">
        <Notice tone="warn">
          These codes let anyone sign in as that phone. Keep this page off the projector. It only
          fills when the system runs with the demo inbox instead of a real SMS provider.
        </Notice>
        <Panel pad={false}>
          {!q.data ? (
            <Skeleton className="m-5 h-32" />
          ) : q.data.messages.length === 0 ? (
            <Empty icon="inbox" title="No messages yet">
              When a visitor asks for a code in demo mode, it appears here within seconds.
            </Empty>
          ) : (
            <ul className="divide-y divide-line">
              {q.data.messages.map((m) => (
                <li key={m.id} className="space-y-1 px-5 py-3.5">
                  <p className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-muted">
                    <span className="num font-bold text-navy">To {m.to}</span>
                    <span>{fmtTime(m.createdAt, { second: '2-digit' })}</span>
                  </p>
                  <p dir="auto" className="text-[0.9375rem] whitespace-pre-line text-ink">
                    {m.body.replace(/\n\n@.*$/s, '')}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
