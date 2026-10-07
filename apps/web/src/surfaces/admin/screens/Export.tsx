import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { ExportKind } from '@mc/shared/manage';
import { adminApi, ApiError, explain } from '../api';
import { Btn, Notice, PageHeader, Panel, saveFile, useToast } from '../ui';

const FILES: Array<{ kind: ExportKind; title: string; text: string; note: string }> = [
  {
    kind: 'results',
    title: 'Results',
    text: 'Every exhibitor in every category with its vote count and rank.',
    note: 'Only while the results are Live: the file shows the real standings.',
  },
  {
    kind: 'votes',
    title: 'Vote ledger',
    text: 'One line per vote: when, which category, which exhibitor, and an anonymous voter reference.',
    note: 'No names or phone numbers. The reference lets an auditor check one vote per person per category.',
  },
  {
    kind: 'outreach',
    title: 'People who agreed to be contacted',
    text: 'Name and phone of visitors who ticked the box to hear about future events. Blocked visitors are left out.',
    note: 'Contains personal data. Use it only for the purpose they agreed to, then delete the file.',
  },
];

async function download(kind: ExportKind) {
  let res: Response;
  try {
    res = await fetch(adminApi.exportUrl(kind), { credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'NETWORK');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    const err = new ApiError(res.status, (body?.error?.code as never) ?? 'INTERNAL');
    err.message = body?.error?.message ?? err.message;
    throw err;
  }
  const name =
    /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ??
    `mc2026-${kind}.csv`;
  saveFile(await res.blob(), name);
  return name;
}

export function Export() {
  const toast = useToast();
  const [busy, setBusy] = useState<ExportKind | null>(null);
  const overview = useQuery({ queryKey: ['admin', 'overview'], queryFn: adminApi.overview });
  const sealed = !!overview.data && overview.data.results.mode !== 'LIVE';
  const run = async (kind: ExportKind) => {
    setBusy(kind);
    try {
      toast('good', `Saved ${await download(kind)}`);
    } catch (e) {
      toast('bad', explain(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <PageHeader
        title="Export"
        lead="CSV files that open in Excel, Numbers and Google Sheets. Every download is recorded in the audit log."
      />
      {sealed && (
        <Notice tone="warn" className="mb-4">
          <p className="font-bold">
            The results are sealed on the TVs, so the results and vote files are not available.
          </p>
          <p>
            To read the standings, use &quot;Who is ahead&quot; on the Overview (that is recorded),
            or switch the results back to Live.
          </p>
        </Notice>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        {FILES.map((f) => (
          <Panel key={f.kind} title={f.title} className="flex flex-col">
            <div className="flex h-full flex-col gap-4">
              <p className="text-[0.9375rem] text-ink">{f.text}</p>
              <p className="text-sm text-muted">{f.note}</p>
              <Btn
                className="mt-auto self-start"
                variant="primary"
                icon="download"
                loading={busy === f.kind}
                disabled={busy !== null || (sealed && f.kind !== 'outreach')}
                onClick={() => void run(f.kind)}
              >
                Download CSV
              </Btn>
            </div>
          </Panel>
        ))}
      </div>
    </>
  );
}
