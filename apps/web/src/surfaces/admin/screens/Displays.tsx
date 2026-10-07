import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminDisplay, DisplayCreated } from '@mc/shared/manage';
import { useState } from 'react';
import { adminApi, explain } from '../api';
import { QrSvg } from '../AuthScreens';
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
  Skeleton,
  useToast,
} from '../ui';

export function Displays() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ['admin', 'displays'],
    queryFn: adminApi.displays,
    refetchInterval: 10000,
  });
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [created, setCreated] = useState<DisplayCreated | null>(null);
  const [revoking, setRevoking] = useState<AdminDisplay | null>(null);

  const create = useMutation({
    mutationFn: () => adminApi.createDisplay(label.trim()),
    onSuccess: (r) => {
      setAdding(false);
      setLabel('');
      setCreated(r);
      void qc.invalidateQueries({ queryKey: ['admin', 'displays'] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => adminApi.revokeDisplay(id),
    onSuccess: () => {
      setRevoking(null);
      toast('good', 'That screen is switched off.');
      void qc.invalidateQueries({ queryKey: ['admin', 'displays'] });
    },
    onError: (e) => toast('bad', explain(e)),
  });

  if (q.error && !q.data) return <LoadError error={q.error} onRetry={() => void q.refetch()} />;
  const rows = q.data?.displays ?? [];
  return (
    <>
      <PageHeader
        title="TV displays"
        lead="Each hall screen pairs once with its own link. Switch a screen off here and it goes blank within seconds."
        actions={
          <Btn variant="primary" icon="plus" onClick={() => setAdding(true)}>
            Add a display
          </Btn>
        }
      />
      <Panel pad={false}>
        {!q.data ? (
          <Skeleton className="m-5 h-24" />
        ) : rows.length === 0 ? (
          <Empty
            icon="tv"
            title="No displays yet"
            action={
              <Btn variant="primary" icon="plus" onClick={() => setAdding(true)}>
                Add the first display
              </Btn>
            }
          >
            Add one per screen. You get a link to open on that screen's browser.
          </Empty>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1 basis-48">
                  <p className="break-words text-[0.9375rem] font-bold text-navy">{d.label}</p>
                  <p className="text-sm text-muted">
                    {d.revokedAt
                      ? `Switched off ${fmtTime(d.revokedAt)}`
                      : d.lastSeenAt
                        ? `Last seen ${fmtTime(d.lastSeenAt)}`
                        : 'Never connected yet'}
                  </p>
                </div>
                {d.revokedAt ? (
                  <Badge tone="bad">Switched off</Badge>
                ) : d.online ? (
                  <Badge tone="good">Online</Badge>
                ) : (
                  <Badge tone="warn">Offline</Badge>
                )}
                {!d.revokedAt && (
                  <Btn small variant="secondary" onClick={() => setRevoking(d)}>
                    Switch off
                  </Btn>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        title="Add a display"
        locked={create.isPending}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (label.trim()) create.mutate();
          }}
          className="space-y-4"
        >
          <Input
            label="Name of the screen"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={80}
            placeholder="Main hall"
            autoFocus
            hint="Only for you, to tell the screens apart."
          />
          {create.error && <Notice tone="bad">{explain(create.error)}</Notice>}
          <div className="flex justify-end gap-2">
            <Btn onClick={() => setAdding(false)} disabled={create.isPending}>
              Cancel
            </Btn>
            <Btn
              type="submit"
              variant="primary"
              disabled={!label.trim()}
              loading={create.isPending}
            >
              Create
            </Btn>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={created !== null}
        onClose={() => setCreated(null)}
        title="Open this on the screen"
        wide
      >
        {created && (
          <div className="space-y-4">
            <Notice tone="warn">
              This link is shown only now. Anyone with it can show the results screen, so open it on
              the TV and do not share it. If it is lost, add a new display and switch this one off.
            </Notice>
            <div className="grid items-center gap-5 sm:grid-cols-[13rem_1fr]">
              <QrSvg text={created.pairingUrl} label="QR code that opens the display link" />
              <div className="space-y-3">
                <p className="text-sm text-muted">
                  Scan with the TV's browser device, or copy the link and open it on the TV.
                </p>
                <p className="num rounded-xl bg-canvas p-3 text-sm font-bold break-all text-navy">
                  {created.pairingUrl}
                </p>
                <CopyBtn text={created.pairingUrl} label="Copy link" />
              </div>
            </div>
            <div className="flex justify-end">
              <Btn variant="primary" onClick={() => setCreated(null)}>
                I have opened it
              </Btn>
            </div>
          </div>
        )}
      </Dialog>

      <Confirm
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        title={`Switch off ${revoking?.label ?? ''}?`}
        confirmLabel="Switch off"
        danger
        busy={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate(revoking.id)}
      >
        <p>
          The screen goes blank within a few seconds and cannot be turned back on. Add a new display
          to replace it.
        </p>
      </Confirm>
    </>
  );
}
