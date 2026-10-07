import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AdminCategory, AdminExhibitor } from '@mc/shared/manage';
import { useMemo, useRef, useState } from 'react';
import { adminApi, explain } from '../api';
import {
  decodeCsv,
  looksLikeExcelFile,
  parseCsv,
  previewExhibitors,
  templateCsv,
  type Preview,
  type RowState,
} from '../spreadsheet';
import { Badge, Btn, Dialog, Notice, saveFile, useToast } from '../ui';

const FILE_MAX_BYTES = 2 * 1024 * 1024;

const STATE: Record<RowState, { label: string; tone: 'good' | 'bad' | 'neutral' }> = {
  ready: { label: 'Ready', tone: 'good' },
  error: { label: 'Problem', tone: 'bad' },
  exists: { label: 'Already there', tone: 'neutral' },
  repeat: { label: 'Repeated', tone: 'neutral' },
};

/**
 * Add many exhibitors from one spreadsheet. The file is read in the browser and shown as a preview first; only the
 * rows marked Ready are sent, and the server adds them all or none. Photos are added afterwards, one exhibitor at a time.
 */
export function BulkExhibitors({
  open,
  onClose,
  categories,
  exhibitors,
}: {
  open: boolean;
  onClose: () => void;
  categories: AdminCategory[];
  exhibitors: AdminExhibitor[];
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const names = useMemo(() => exhibitors.map((e) => e.nameEn), [exhibitors]);

  const reset = () => {
    setFileName('');
    setPreview(null);
    setReadError(null);
    if (input.current) input.current.value = '';
  };
  const close = () => {
    reset();
    onClose();
  };

  const send = useMutation({
    mutationFn: (rows: NonNullable<Preview['ready']>) => adminApi.bulkCreateExhibitors(rows),
    onSuccess: (r) => {
      toast('good', `Added ${r.created} exhibitor${r.created === 1 ? '' : 's'}.`);
      void qc.invalidateQueries({ queryKey: ['admin', 'content'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
      close();
    },
    onError: (e) => toast('bad', explain(e)),
  });

  const choose = async (file: File | undefined) => {
    setPreview(null);
    setReadError(null);
    if (!file) return;
    setFileName(file.name);
    if (file.size > FILE_MAX_BYTES) {
      setReadError('That file is larger than 2 MB. Split it into smaller files.');
      return;
    }
    let bytes: ArrayBuffer;
    try {
      bytes = await file.arrayBuffer();
    } catch {
      setReadError('The file could not be read. Choose it again.');
      return;
    }
    if (looksLikeExcelFile(file.name, bytes)) {
      setReadError(
        'This is an Excel workbook. In Excel choose File, Save As, "CSV UTF-8 (Comma delimited)", then choose that file.',
      );
      return;
    }
    setPreview(previewExhibitors(parseCsv(decodeCsv(bytes)), categories, names));
  };

  const template = () =>
    saveFile(
      new Blob([templateCsv(categories[0]?.nameEn)], { type: 'text/csv;charset=utf-8' }),
      'mc2026-exhibitors-template.csv',
    );

  const count = (s: RowState) => preview?.rows.filter((r) => r.state === s).length ?? 0;
  const skipped = (preview?.rows.length ?? 0) - (preview?.ready.length ?? 0);

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Add exhibitors from a file"
      wide
      locked={send.isPending}
    >
      <div className="space-y-4">
        <div className="space-y-2 text-sm text-muted">
          <p>
            Fill in a spreadsheet, save it as <strong>CSV</strong>, and choose it here. You see
            every row checked before anything is added. Columns:{' '}
            <span className="num text-ink">
              name_en (required), name_ar, project_en, project_ar, description_en, description_ar,
              booth, categories, visible
            </span>
            . Put several categories in one cell separated by{' '}
            <span className="num text-ink">;</span>, by their English or Arabic name. Photos are
            added afterwards, from each exhibitor.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={input}
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            className="sr-only"
            tabIndex={-1}
            aria-label="Spreadsheet file (CSV)"
            onChange={(e) => void choose(e.target.files?.[0])}
          />
          <Btn variant="primary" icon="upload" onClick={() => input.current?.click()}>
            {fileName ? 'Choose another file' : 'Choose a CSV file'}
          </Btn>
          <Btn icon="download" onClick={template}>
            Download template
          </Btn>
          {fileName && (
            <span className="num min-w-0 break-all text-sm text-muted" dir="auto">
              {fileName}
            </span>
          )}
        </div>

        {readError && <Notice tone="bad">{readError}</Notice>}
        {preview?.fatal && <Notice tone="bad">{preview.fatal}</Notice>}

        {preview && !preview.fatal && (
          <>
            <div className="flex flex-wrap items-center gap-2" aria-live="polite">
              <Badge tone="good">{count('ready')} ready</Badge>
              {count('error') > 0 && <Badge tone="bad">{count('error')} with a problem</Badge>}
              {count('exists') > 0 && <Badge>{count('exists')} already there</Badge>}
              {count('repeat') > 0 && <Badge>{count('repeat')} repeated</Badge>}
            </div>
            {skipped > 0 && (
              <Notice tone={count('error') > 0 ? 'warn' : 'info'}>
                {skipped} row{skipped === 1 ? ' is' : 's are'} left out.{' '}
                {count('error') > 0
                  ? 'Fix the problems in the file and choose it again to include them.'
                  : 'Only the ready rows are added.'}
              </Notice>
            )}
            <div
              className="max-h-[22rem] overflow-auto rounded-xl ring-1 ring-line"
              tabIndex={0}
              role="region"
              aria-label="Rows in the file"
            >
              <table className="w-full min-w-[34rem] text-sm">
                <thead className="sticky top-0 bg-surface text-muted">
                  <tr className="border-b border-line">
                    <th scope="col" className="px-3 py-2 text-start font-bold">
                      Row
                    </th>
                    <th scope="col" className="px-3 py-2 text-start font-bold">
                      Name
                    </th>
                    <th scope="col" className="px-3 py-2 text-start font-bold">
                      Categories
                    </th>
                    <th scope="col" className="px-3 py-2 text-start font-bold">
                      Result
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line align-top">
                  {preview.rows.map((r) => (
                    <tr
                      key={r.line}
                      className={r.state === 'error' ? 'bg-crimson-soft/40' : undefined}
                    >
                      <td className="num px-3 py-2 text-muted">{r.line}</td>
                      <td className="px-3 py-2 font-bold break-words text-navy" dir="auto">
                        {r.nameEn || '—'}
                      </td>
                      <td className="px-3 py-2 break-words text-muted" dir="auto">
                        {r.categories.join(', ') || '—'}
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={STATE[r.state].tone}>{STATE[r.state].label}</Badge>
                        {r.reason && <p className="mt-1 text-xs text-muted">{r.reason}</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="flex flex-wrap justify-end gap-3">
          <Btn onClick={close} disabled={send.isPending}>
            Cancel
          </Btn>
          <Btn
            variant="primary"
            icon="plus"
            disabled={!preview || preview.ready.length === 0}
            loading={send.isPending}
            onClick={() => preview && send.mutate(preview.ready)}
          >
            {preview && preview.ready.length > 0
              ? `Add ${preview.ready.length} exhibitor${preview.ready.length === 1 ? '' : 's'}`
              : 'Add exhibitors'}
          </Btn>
        </div>
      </div>
    </Dialog>
  );
}
