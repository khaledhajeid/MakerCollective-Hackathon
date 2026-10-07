import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { AdminRole } from '@mc/shared';
import type { AdminVisitor } from '@mc/shared/manage';
import { useEffect, useState, type FormEvent } from 'react';
import { adminApi, explain } from '../api';
import {
  Badge,
  Btn,
  Confirm,
  Dialog,
  Empty,
  fmtTime,
  Input,
  LoadError,
  Notice,
  PageHeader,
  Panel,
  Skeleton,
  useToast,
} from '../ui';

export function Visitors({ role }: { role: AdminRole }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [phone, setPhone] = useState('');
  const [search, setSearch] = useState('');
  const q = useInfiniteQuery({
    queryKey: ['admin', 'visitors', search],
    queryFn: ({ pageParam }) => adminApi.visitors({ after: pageParam, phone: search || undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextAfter ?? undefined,
    retry: false,
  });
  const rows = q.data?.pages.flatMap((p) => p.visitors) ?? [];
  const total = q.data?.pages[0]?.total;

  const [acting, setActing] = useState<{
    kind: 'block' | 'unblock' | 'signout';
    v: AdminVisitor;
  } | null>(null);
  const [unmasking, setUnmasking] = useState<AdminVisitor | null>(null);
  const act = useMutation({
    mutationFn: async ({ kind, v }: { kind: 'block' | 'unblock' | 'signout'; v: AdminVisitor }) => {
      if (kind === 'signout') await adminApi.signOutVisitor(v.id);
      else await adminApi.blockVisitor(v.id, kind === 'block');
    },
    onSuccess: () => {
      setActing(null);
      toast('good', 'Done.');
      void qc.invalidateQueries({ queryKey: ['admin', 'visitors'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
    },
    onError: (e) => toast('bad', explain(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSearch(phone.trim());
  };

  return (
    <>
      <PageHeader
        title="Visitors"
        lead="People who confirmed a phone number. Names and numbers are masked here; only a super admin can see a real one, with a reason that is logged."
      />
      <div className="space-y-4">
        <Panel>
          <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
            <Input
              label="Find by phone number"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="079 123 4567"
              className="min-w-0 flex-1 basis-60"
              hint="Any format a visitor might have typed."
            />
            <Btn type="submit" icon="search">
              Search
            </Btn>
            {search && (
              <Btn
                onClick={() => {
                  setPhone('');
                  setSearch('');
                }}
              >
                Show everyone
              </Btn>
            )}
          </form>
        </Panel>

        <ThrottleClear />

        <Panel
          title={
            search
              ? 'Search result'
              : `Everyone${total !== undefined ? ` (${total.toLocaleString('en-US')})` : ''}`
          }
          pad={false}
        >
          {q.error && !q.data ? (
            <div className="p-5">
              <Notice tone="bad">{explain(q.error)}</Notice>
            </div>
          ) : !q.data ? (
            <Skeleton className="m-5 h-40" />
          ) : rows.length === 0 ? (
            <Empty icon="users" title={search ? 'No one has that number' : 'No visitors yet'}>
              {search
                ? 'Check the digits. A number only appears once its owner has confirmed an SMS code.'
                : 'Visitors appear here as they confirm their phone at the event.'}
            </Empty>
          ) : (
            <>
              <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Visitors">
                <table className="w-full min-w-[44rem] text-start text-[0.9375rem]">
                  <thead>
                    <tr className="border-b border-line text-sm text-muted">
                      <th scope="col" className="px-5 py-3 text-start font-bold">
                        Visitor
                      </th>
                      <th scope="col" className="px-3 py-3 text-start font-bold">
                        Phone
                      </th>
                      <th scope="col" className="px-3 py-3 text-end font-bold">
                        Votes
                      </th>
                      <th scope="col" className="px-3 py-3 text-start font-bold">
                        Joined
                      </th>
                      <th scope="col" className="px-3 py-3 text-start font-bold">
                        Device
                      </th>
                      <th scope="col" className="px-5 py-3 text-end font-bold">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {rows.map((v) => (
                      <tr key={v.id} className={v.isBlocked ? 'bg-crimson-soft/40' : undefined}>
                        <td className="px-5 py-3 font-bold text-navy">
                          {v.name} {v.isBlocked && <Badge tone="bad">Blocked</Badge>}
                        </td>
                        <td className="num px-3 py-3">{v.phone}</td>
                        <td className="num px-3 py-3 text-end">{v.votes}</td>
                        <td className="px-3 py-3 whitespace-nowrap text-muted">
                          {fmtTime(v.createdAt)}
                        </td>
                        <td className="num px-3 py-3 text-muted">{v.device ?? '—'}</td>
                        <td className="px-5 py-2">
                          <div className="flex justify-end gap-1">
                            {role === 'SUPER_ADMIN' && (
                              <Btn small icon="eye" onClick={() => setUnmasking(v)}>
                                Reveal
                              </Btn>
                            )}
                            <Btn small onClick={() => setActing({ kind: 'signout', v })}>
                              Sign out
                            </Btn>
                            <Btn
                              small
                              variant={v.isBlocked ? 'secondary' : 'ghost'}
                              onClick={() =>
                                setActing({ kind: v.isBlocked ? 'unblock' : 'block', v })
                              }
                            >
                              {v.isBlocked ? 'Unblock' : 'Block'}
                            </Btn>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {q.hasNextPage && (
                <div className="border-t border-line p-4 text-center">
                  <Btn onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>
                    Show more
                  </Btn>
                </div>
              )}
            </>
          )}
          {q.error && q.data && (
            <div className="p-4">
              <LoadError error={q.error} onRetry={() => void q.refetch()} />
            </div>
          )}
        </Panel>
      </div>

      <Confirm
        open={acting !== null}
        onClose={() => setActing(null)}
        title={
          acting?.kind === 'block'
            ? 'Block this visitor?'
            : acting?.kind === 'unblock'
              ? 'Unblock this visitor?'
              : 'Sign this visitor out?'
        }
        confirmLabel={
          acting?.kind === 'block' ? 'Block' : acting?.kind === 'unblock' ? 'Unblock' : 'Sign out'
        }
        danger={acting?.kind === 'block'}
        busy={act.isPending}
        onConfirm={() => acting && act.mutate(acting)}
      >
        {acting?.kind === 'block' && (
          <p>
            {acting.v.name} ({acting.v.phone}) is signed out and cannot sign in or vote again. Votes
            already cast stay.
          </p>
        )}
        {acting?.kind === 'unblock' && (
          <p>{acting.v.name} can sign in with a new SMS code again.</p>
        )}
        {acting?.kind === 'signout' && (
          <p>
            {acting.v.name} is signed out on every phone. They sign in again with a new SMS code.
            Votes stay.
          </p>
        )}
      </Confirm>
      <Unmask visitor={unmasking} onClose={() => setUnmasking(null)} />
    </>
  );
}

/** "My number keeps saying wait": forgets the recent codes for one phone so the owner can ask again. */
function ThrottleClear() {
  const toast = useToast();
  const [phone, setPhone] = useState('');
  const clear = useMutation({
    mutationFn: () => adminApi.clearThrottle(phone.trim()),
    onSuccess: (r) => {
      toast(
        'good',
        r.cleared
          ? 'Cleared. They can ask for a new code now.'
          : 'Nothing was blocking that number.',
      );
      setPhone('');
    },
    onError: (e) => toast('bad', explain(e)),
  });
  return (
    <Panel title="A visitor cannot get a code">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (phone.trim()) clear.mutate();
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <Input
          label="Their phone number"
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="079 123 4567"
          className="min-w-0 flex-1 basis-60"
          hint='Clears "wait before asking again" and "too many tries" for this one number.'
        />
        <Btn type="submit" loading={clear.isPending} disabled={!phone.trim()}>
          Clear the wait
        </Btn>
      </form>
    </Panel>
  );
}

function Unmask({ visitor, onClose }: { visitor: AdminVisitor | null; onClose: () => void }) {
  return (
    <Dialog open={visitor !== null} onClose={onClose} title="Reveal a visitor">
      {visitor && <UnmaskBody visitor={visitor} onClose={onClose} />}
    </Dialog>
  );
}

function UnmaskBody({ visitor, onClose }: { visitor: AdminVisitor; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const reveal = useMutation({
    mutationFn: (v: AdminVisitor) => adminApi.revealVisitor(v.id, reason.trim()),
  });
  // The real details do not linger on screen: they hide themselves after half a minute.
  useEffect(() => {
    if (!reveal.data) return;
    const t = setTimeout(onClose, 30_000);
    return () => clearTimeout(t);
  }, [reveal.data, onClose]);

  return reveal.data ? (
    <div className="space-y-4">
      <dl className="space-y-3 rounded-xl bg-canvas p-4">
        <div>
          <dt className="text-sm text-muted">Name</dt>
          <dd className="text-lg font-bold text-navy" dir="auto">
            {reveal.data.name}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Phone</dt>
          <dd className="num text-lg font-bold text-navy">{reveal.data.phone}</dd>
        </div>
      </dl>
      <p className="text-sm text-muted">
        This closes by itself in 30 seconds. Your reason was recorded.
      </p>
      <div className="flex justify-end">
        <Btn variant="primary" onClick={onClose}>
          Done
        </Btn>
      </div>
    </div>
  ) : (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (reason.trim().length >= 3) reveal.mutate(visitor);
      }}
      className="space-y-4"
    >
      <p className="text-[0.9375rem]">
        You are about to see the real name and number of <b>{visitor.name}</b> ({visitor.phone}).
        This is recorded with your name and the reason below.
      </p>
      <Input
        label="Why do you need it?"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={120}
        placeholder="For example: prize winner, call to confirm"
        autoFocus
      />
      {reveal.error && <Notice tone="bad">{explain(reveal.error)}</Notice>}
      <div className="flex justify-end gap-2">
        <Btn onClick={onClose} disabled={reveal.isPending}>
          Cancel
        </Btn>
        <Btn
          type="submit"
          variant="primary"
          disabled={reason.trim().length < 3}
          loading={reveal.isPending}
        >
          Reveal
        </Btn>
      </div>
    </form>
  );
}
