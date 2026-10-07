import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminCredentialsIssued, AdminRole, AdminUser } from '@mc/shared';
import { useState } from 'react';
import { adminApi, explain } from '../api';
import {
  Badge,
  Btn,
  Confirm,
  CopyBtn,
  Dialog,
  Empty,
  fmtTime,
  Input,
  LoadError,
  Notice,
  PageHeader,
  Panel,
  Segmented,
  Skeleton,
  useToast,
} from '../ui';
import { NoAccess } from './Audit';

type Action =
  | { kind: 'role'; u: AdminUser }
  | { kind: 'disable' | 'enable' | 'reset' | 'signout'; u: AdminUser };

export function Admins({ role, me }: { role: AdminRole; me: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: adminApi.users,
    enabled: role === 'SUPER_ADMIN',
    retry: false,
  });
  const [creating, setCreating] = useState(false);
  const [username, setUsername] = useState('');
  const [newRole, setNewRole] = useState<AdminRole>('ADMIN');
  const [issued, setIssued] = useState<AdminCredentialsIssued | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin', 'users'] });

  const create = useMutation({
    mutationFn: () =>
      adminApi.createUser({ username: username.trim().toLowerCase(), role: newRole }),
    onSuccess: (r) => {
      setCreating(false);
      setUsername('');
      setIssued(r);
      refresh();
    },
  });
  const run = useMutation({
    mutationFn: async (a: Action) => {
      switch (a.kind) {
        case 'role':
          return adminApi.updateUser(a.u.id, {
            role: a.u.role === 'ADMIN' ? 'SUPER_ADMIN' : 'ADMIN',
          });
        case 'disable':
          return adminApi.updateUser(a.u.id, { isDisabled: true });
        case 'enable':
          return adminApi.updateUser(a.u.id, { isDisabled: false });
        case 'reset':
          return adminApi.resetUser(a.u.id);
        case 'signout':
          return adminApi.signOutUser(a.u.id);
      }
    },
    onSuccess: (r, a) => {
      setAction(null);
      refresh();
      if (a.kind === 'reset') setIssued(r as AdminCredentialsIssued);
      else toast('good', 'Done.');
    },
    onError: (e) => toast('bad', explain(e)),
  });
  const unlock = useMutation({
    mutationFn: (u: AdminUser) => adminApi.unlockUser(u.id),
    onSuccess: () => {
      toast('good', 'Unlocked. They can try again now.');
      refresh();
    },
    onError: (e) => toast('bad', explain(e)),
  });

  if (role !== 'SUPER_ADMIN') return <NoAccess />;
  if (q.error && !q.data) return <LoadError error={q.error} onRetry={() => void q.refetch()} />;
  const users = q.data?.users ?? [];
  const activeSupers = users.filter((u) => u.role === 'SUPER_ADMIN' && !u.isDisabled).length;

  return (
    <>
      <PageHeader
        title="Organisers"
        lead="Who can sign in to this console. Everyone needs a password and an authenticator app."
        actions={
          <Btn variant="primary" icon="plus" onClick={() => setCreating(true)}>
            Add an organiser
          </Btn>
        }
      />
      <div className="space-y-4">
        {activeSupers < 2 && users.length > 0 && (
          <Notice tone="warn">
            Only {activeSupers} active super admin. Add a second one before the event, so a lost
            phone does not lock everyone out.
          </Notice>
        )}
        <Panel pad={false}>
          {!q.data ? (
            <Skeleton className="m-5 h-40" />
          ) : users.length === 0 ? (
            <Empty icon="person" title="No organisers">
              Add one to get started.
            </Empty>
          ) : (
            <ul className="divide-y divide-line">
              {users.map((u) => {
                const isMe = u.username === me;
                return (
                  <li key={u.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                    <div className="min-w-0 flex-1 basis-56">
                      <p className="break-words text-[0.9375rem] font-bold text-navy">
                        {u.username} {isMe && <span className="font-normal text-muted">(you)</span>}
                      </p>
                      <p className="text-sm text-muted">
                        {u.lastLoginAt
                          ? `Last sign-in ${fmtTime(u.lastLoginAt)}`
                          : 'Has not signed in yet'}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <Badge tone={u.role === 'SUPER_ADMIN' ? 'purple' : 'info'}>
                          {u.role === 'SUPER_ADMIN' ? 'Super admin' : 'Admin'}
                        </Badge>
                        {u.isDisabled && <Badge tone="bad">Disabled</Badge>}
                        {u.lockedUntil && (
                          <Badge tone="warn">
                            Locked until{' '}
                            {fmtTime(u.lockedUntil, { day: undefined, month: undefined })}
                          </Badge>
                        )}
                        {!u.mfaEnabled && <Badge tone="warn">No authenticator yet</Badge>}
                        {u.mustChangePassword && <Badge tone="warn">Temporary password</Badge>}
                      </div>
                    </div>
                    {!isMe && (
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {u.lockedUntil && (
                          <Btn small onClick={() => unlock.mutate(u)} loading={unlock.isPending}>
                            Unlock
                          </Btn>
                        )}
                        <Btn
                          small
                          onClick={() => setAction({ kind: 'role', u })}
                          disabled={u.isDisabled}
                        >
                          {u.role === 'ADMIN' ? 'Make super admin' : 'Make admin'}
                        </Btn>
                        <Btn small onClick={() => setAction({ kind: 'signout', u })}>
                          Sign out
                        </Btn>
                        <Btn small onClick={() => setAction({ kind: 'reset', u })}>
                          Reset sign-in
                        </Btn>
                        <Btn
                          small
                          variant={u.isDisabled ? 'secondary' : 'ghost'}
                          onClick={() =>
                            setAction({ kind: u.isDisabled ? 'enable' : 'disable', u })
                          }
                        >
                          {u.isDisabled ? 'Enable' : 'Disable'}
                        </Btn>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title="Add an organiser"
        locked={create.isPending}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (username.trim().length >= 3) create.mutate();
          }}
          className="space-y-4"
        >
          <Input
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            hint="3 to 32 letters, numbers, dots, dashes or underscores."
          />
          <div className="space-y-1.5">
            <p className="text-sm font-bold text-ink">Role</p>
            <Segmented
              label="Role"
              value={newRole}
              onChange={setNewRole}
              options={[
                { value: 'ADMIN', label: 'Admin' },
                { value: 'SUPER_ADMIN', label: 'Super admin' },
              ]}
            />
            <p className="text-sm text-muted">
              An admin runs the event. A super admin can also manage organisers, read the audit log
              and the SMS inbox, and see real visitor details.
            </p>
          </div>
          {create.error && <Notice tone="bad">{explain(create.error)}</Notice>}
          <div className="flex justify-end gap-2">
            <Btn onClick={() => setCreating(false)} disabled={create.isPending}>
              Cancel
            </Btn>
            <Btn
              type="submit"
              variant="primary"
              disabled={username.trim().length < 3}
              loading={create.isPending}
            >
              Create
            </Btn>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={issued !== null}
        onClose={() => setIssued(null)}
        title="Give them this temporary password"
      >
        {issued && (
          <div className="space-y-4">
            <Notice tone="warn">
              Shown only now. Hand it over in person or through a private message, never in a group
              chat. They choose their own password at first sign-in, and it stops working after 48
              hours if unused.
            </Notice>
            <dl className="space-y-3 rounded-xl bg-canvas p-4">
              <div>
                <dt className="text-sm text-muted">Username</dt>
                <dd className="font-bold text-navy">{issued.user.username}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Temporary password</dt>
                <dd className="num text-lg font-bold tracking-wide break-all text-navy">
                  {issued.temporaryPassword}
                </dd>
              </div>
            </dl>
            <div className="flex justify-between gap-2">
              <CopyBtn text={issued.temporaryPassword} label="Copy password" />
              <Btn variant="primary" onClick={() => setIssued(null)}>
                I have passed it on
              </Btn>
            </div>
          </div>
        )}
      </Dialog>

      <Confirm
        open={action !== null}
        onClose={() => setAction(null)}
        title={
          action?.kind === 'role'
            ? `Change role of ${action.u.username}?`
            : action?.kind === 'disable'
              ? `Disable ${action.u.username}?`
              : action?.kind === 'enable'
                ? `Enable ${action.u.username}?`
                : action?.kind === 'reset'
                  ? `Reset sign-in for ${action.u.username}?`
                  : `Sign ${action?.u.username ?? ''} out everywhere?`
        }
        confirmLabel={
          action?.kind === 'role'
            ? 'Change role'
            : action?.kind === 'disable'
              ? 'Disable'
              : action?.kind === 'enable'
                ? 'Enable'
                : action?.kind === 'reset'
                  ? 'Reset sign-in'
                  : 'Sign out'
        }
        danger={action?.kind === 'disable' || action?.kind === 'reset'}
        busy={run.isPending}
        onConfirm={() => action && run.mutate(action)}
      >
        {action?.kind === 'role' && (
          <p>
            {action.u.username} becomes {action.u.role === 'ADMIN' ? 'a super admin' : 'an admin'}.
            It applies on their very next click.
          </p>
        )}
        {action?.kind === 'disable' && (
          <p>
            They are signed out at once and cannot sign in. Their history stays in the audit log.
          </p>
        )}
        {action?.kind === 'enable' && (
          <p>They can sign in again with their existing password and authenticator.</p>
        )}
        {action?.kind === 'reset' && (
          <p>
            For a lost phone or password. They are signed out everywhere, their authenticator and
            recovery codes are removed, and you get a new temporary password to give them. They set
            everything up again.
          </p>
        )}
        {action?.kind === 'signout' && (
          <p>Every browser they are signed in on is signed out at once.</p>
        )}
      </Confirm>
    </>
  );
}
