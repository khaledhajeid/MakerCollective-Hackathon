import { useInfiniteQuery } from '@tanstack/react-query';
import type { AdminRole } from '@mc/shared';
import { useState } from 'react';
import { adminApi, explain } from '../api';
import { Btn, Empty, fmtTime, Input, Notice, PageHeader, Panel, Skeleton, useToast } from '../ui';
import { downloadCsv } from './Export';

export function NoAccess() {
  return (
    <Panel>
      <Empty icon="lock" title="Only a super admin can open this">
        Ask a super admin if you need something from here.
      </Empty>
    </Panel>
  );
}

const detailText = (d: unknown): string => {
  if (d === null || d === undefined) return '';
  if (typeof d !== 'object') return String(d);
  return Object.entries(d as Record<string, unknown>)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ');
};

export function Audit({ role }: { role: AdminRole }) {
  const [filter, setFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const save = async () => {
    setSaving(true);
    try {
      toast('good', `Saved ${await downloadCsv(adminApi.auditExportUrl, 'mc2026-audit.csv')}`);
    } catch (e) {
      toast('bad', explain(e));
    } finally {
      setSaving(false);
    }
  };
  const q = useInfiniteQuery({
    queryKey: ['admin', 'audit'],
    queryFn: ({ pageParam }) => adminApi.audit(pageParam),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (l) => l.nextBefore ?? undefined,
    enabled: role === 'SUPER_ADMIN',
    retry: false,
  });
  if (role !== 'SUPER_ADMIN') return <NoAccess />;
  const all = q.data?.pages.flatMap((p) => p.entries) ?? [];
  const f = filter.trim().toLowerCase();
  const rows = f
    ? all.filter((e) =>
        `${e.actor} ${e.action} ${e.entity ?? ''} ${detailText(e.details)}`
          .toLowerCase()
          .includes(f),
      )
    : all;
  return (
    <>
      <PageHeader
        title="Audit log"
        lead="Who did what, newest first. Entries cannot be edited or deleted. No passwords, codes or phone numbers are ever written here. The CSV holds the newest 100,000 entries, oldest first."
        actions={
          <>
            <Btn icon="download" onClick={() => void save()} loading={saving}>
              Download CSV
            </Btn>
            <Btn icon="refresh" onClick={() => void q.refetch()} loading={q.isRefetching}>
              Refresh
            </Btn>
          </>
        }
      />
      <Panel pad={false}>
        <div className="border-b border-line p-4">
          <Input
            label="Filter what is loaded"
            placeholder="A name, an action such as settings.update, a word"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="max-w-xl"
          />
        </div>
        {q.error && !q.data ? (
          <div className="p-5">
            <Notice tone="bad">{explain(q.error)}</Notice>
          </div>
        ) : !q.data ? (
          <Skeleton className="m-5 h-48" />
        ) : rows.length === 0 ? (
          <Empty icon="log" title="Nothing matches">
            Clear the filter, or load older entries.
          </Empty>
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Audit entries">
            <table className="w-full min-w-[52rem] text-[0.9375rem]">
              <thead>
                <tr className="border-b border-line text-sm text-muted">
                  <th scope="col" className="px-5 py-3 text-start font-bold">
                    When
                  </th>
                  <th scope="col" className="px-3 py-3 text-start font-bold">
                    Who
                  </th>
                  <th scope="col" className="px-3 py-3 text-start font-bold">
                    What
                  </th>
                  <th scope="col" className="px-3 py-3 text-start font-bold">
                    Details
                  </th>
                  <th scope="col" className="px-5 py-3 text-start font-bold">
                    From
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line align-top">
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td className="num px-5 py-2.5 whitespace-nowrap text-muted">
                      {fmtTime(e.at, { second: '2-digit' })}
                    </td>
                    <td className="px-3 py-2.5 font-bold text-navy">{e.actor}</td>
                    <td className="num px-3 py-2.5 font-bold">{e.action}</td>
                    <td className="max-w-[28rem] px-3 py-2.5 text-sm break-words text-muted">
                      {detailText(e.details)}
                    </td>
                    <td className="num px-5 py-2.5 text-sm text-muted">{e.ip ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {q.hasNextPage && (
          <div className="border-t border-line p-4 text-center">
            <Btn onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>
              Load older entries
            </Btn>
          </div>
        )}
      </Panel>
    </>
  );
}
