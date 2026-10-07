import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { adminApi, explain } from '../api';
import { PasswordScreen, RecoveryCodeList } from '../AuthScreens';
import { Btn, Check, Dialog, Input, Notice, PageHeader, Panel } from '../ui';

export function Account() {
  return (
    <>
      <PageHeader title="Your account" lead="Your password and your recovery codes." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Change password">
          <PasswordScreen forced={false} />
        </Panel>
        <RecoveryCodes />
      </div>
    </>
  );
}

function RecoveryCodes() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [saved, setSaved] = useState(false);
  const make = useMutation({ mutationFn: () => adminApi.recoveryCodes(code.trim()) });
  const close = () => {
    setOpen(false);
    setCode('');
    setSaved(false);
    make.reset();
  };
  return (
    <Panel title="Recovery codes">
      <div className="space-y-4">
        <p className="text-[0.9375rem] text-ink">
          If you lose your phone, a recovery code signs you in once. Make a fresh set if you are
          running low or lost the list. The old codes stop working.
        </p>
        <Btn icon="key" onClick={() => setOpen(true)}>
          Make new recovery codes
        </Btn>
      </div>
      <Dialog open={open} onClose={close} title="New recovery codes" locked={make.isPending}>
        {make.data ? (
          <div className="space-y-4">
            <p className="text-sm text-muted">Shown only now. Your old codes no longer work.</p>
            <RecoveryCodeList codes={make.data.recoveryCodes} />
            <Check checked={saved} onChange={setSaved}>
              I saved these somewhere safe.
            </Check>
            <div className="flex justify-end">
              <Btn variant="primary" disabled={!saved} onClick={close}>
                Done
              </Btn>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (code.length === 6) make.mutate();
            }}
            className="space-y-4"
          >
            <Input
              label="Current authenticator code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              hint="Type the 6-digit code from your app to confirm it is you."
              autoFocus
            />
            {make.error && <Notice tone="bad">{explain(make.error)}</Notice>}
            <div className="flex justify-end gap-2">
              <Btn onClick={close} disabled={make.isPending}>
                Cancel
              </Btn>
              <Btn
                type="submit"
                variant="primary"
                disabled={code.length !== 6}
                loading={make.isPending}
              >
                Make new codes
              </Btn>
            </div>
          </form>
        )}
      </Dialog>
    </Panel>
  );
}
