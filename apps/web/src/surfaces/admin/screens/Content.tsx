import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdminCategory,
  AdminContent,
  AdminExhibitor,
  CategoryCreate,
  ExhibitorCreate,
} from '@mc/shared/manage';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { adminApi, explain } from '../api';
import { AIcon } from '../icons';
import {
  Badge,
  Btn,
  Check,
  Confirm,
  Dialog,
  Empty,
  Input,
  LoadError,
  Notice,
  PageHeader,
  Panel,
  Segmented,
  Select,
  Skeleton,
  TextArea,
  useToast,
} from '../ui';
import { BulkExhibitors } from './BulkExhibitors';
import { PhotoCropper } from './PhotoCropper';

const SWATCHES = [
  ['#00007b', 'Navy'],
  ['#7f32d9', 'Purple'],
  ['#4a68d8', 'Royal blue'],
  ['#74dccf', 'Turquoise'],
  ['#f8d749', 'Yellow'],
  ['#a52a3a', 'Crimson'],
] as const;

export function Content() {
  const [tab, setTab] = useState<'exhibitors' | 'categories'>('exhibitors');
  const q = useQuery({ queryKey: ['admin', 'content'], queryFn: adminApi.content });
  return (
    <>
      <PageHeader
        title="Categories & exhibitors"
        lead="What visitors vote on. Changes appear on phones and TVs within seconds."
      />
      <div className="mb-4">
        <Segmented
          label="Section"
          value={tab}
          onChange={setTab}
          options={[
            {
              value: 'exhibitors',
              label: `Exhibitors${q.data ? ` (${q.data.exhibitors.length})` : ''}`,
            },
            {
              value: 'categories',
              label: `Categories${q.data ? ` (${q.data.categories.length})` : ''}`,
            },
          ]}
        />
      </div>
      {q.error && !q.data ? (
        <LoadError error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <Skeleton className="h-64" />
      ) : tab === 'exhibitors' ? (
        <Exhibitors data={q.data} />
      ) : (
        <Categories data={q.data} />
      )}
    </>
  );
}

function useContentMutation<T, V>(fn: (v: V) => Promise<T>, done: string, after?: (r: T) => void) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      toast('good', done);
      void qc.invalidateQueries({ queryKey: ['admin', 'content'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
      after?.(r);
    },
    onError: (e) => toast('bad', explain(e)),
  });
}

/* ═══════════════════ categories ═══════════════════ */

function Categories({ data }: { data: AdminContent }) {
  const [editing, setEditing] = useState<AdminCategory | 'new' | null>(null);
  const [deleting, setDeleting] = useState<AdminCategory | null>(null);
  const cats = data.categories;
  const reorder = useContentMutation(adminApi.reorderCategories, 'Order saved.');
  const toggle = useContentMutation(
    (c: AdminCategory) => adminApi.updateCategory(c.id, { isActive: !c.isActive }),
    'Saved.',
  );
  const remove = useContentMutation(
    (c: AdminCategory) => adminApi.deleteCategory(c.id),
    'Category deleted.',
    () => setDeleting(null),
  );
  const move = (i: number, d: -1 | 1) => {
    const ids = cats.map((c) => c.id);
    const [a, b] = [ids[i]!, ids[i + d]!];
    ids[i] = b;
    ids[i + d] = a;
    reorder.mutate(ids);
  };

  return (
    <Panel
      title="Categories"
      action={
        <Btn variant="primary" icon="plus" onClick={() => setEditing('new')}>
          Add category
        </Btn>
      }
      pad={false}
    >
      {cats.length === 0 ? (
        <Empty
          icon="content"
          title="No categories yet"
          action={
            <Btn variant="primary" icon="plus" onClick={() => setEditing('new')}>
              Add the first category
            </Btn>
          }
        >
          A category is one award, such as "Best Robot". Visitors get one vote in each.
        </Empty>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {cats.map((c, i) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <span
                className="size-4 shrink-0 rounded-full ring-1 ring-black/10"
                style={{ background: c.color }}
              />
              <div className="min-w-0 flex-1 basis-48">
                <p className="break-words text-[0.9375rem] font-bold text-navy">{c.nameEn}</p>
                <p dir="rtl" lang="ar" className="break-words text-sm text-muted">
                  {c.nameAr}
                </p>
              </div>
              <span className="num text-sm text-muted">{c.exhibitorCount} exhibitors</span>
              {!c.isActive && <Badge>Hidden</Badge>}
              <div className="ms-auto flex items-center gap-1">
                <IconBtn
                  label={`Move ${c.nameEn} up`}
                  icon="up"
                  disabled={i === 0 || reorder.isPending}
                  onClick={() => move(i, -1)}
                />
                <IconBtn
                  label={`Move ${c.nameEn} down`}
                  icon="down"
                  disabled={i === cats.length - 1 || reorder.isPending}
                  onClick={() => move(i, 1)}
                />
                <Btn small onClick={() => toggle.mutate(c)} disabled={toggle.isPending}>
                  {c.isActive ? 'Hide' : 'Show'}
                </Btn>
                <Btn small icon="edit" onClick={() => setEditing(c)}>
                  Edit
                </Btn>
                <IconBtn label={`Delete ${c.nameEn}`} icon="trash" onClick={() => setDeleting(c)} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <CategoryDialog target={editing} onClose={() => setEditing(null)} />
      <Confirm
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.nameEn ?? ''}?`}
        confirmLabel="Delete category"
        danger
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
      >
        {deleting?.hasVotes ? (
          <Notice tone="warn">
            This category already has votes, so it cannot be deleted. Use Hide instead.
          </Notice>
        ) : (
          <p>
            The category and its place in the voting disappear. The exhibitors in it are kept and
            can be put in other categories.
          </p>
        )}
      </Confirm>
    </Panel>
  );
}

export function IconBtn({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: 'up' | 'down' | 'trash' | 'edit' | 'eye' | 'close';
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-11 place-items-center rounded-xl text-navy transition-colors hover:bg-royal-soft disabled:cursor-not-allowed disabled:text-muted/40 disabled:hover:bg-transparent sm:size-9"
    >
      <AIcon name={icon} size={18} />
    </button>
  );
}

function CategoryDialog({
  target,
  onClose,
}: {
  target: AdminCategory | 'new' | null;
  onClose: () => void;
}) {
  const open = target !== null;
  const cat = target && target !== 'new' ? target : null;
  // Remount the form for each target so its fields always start from that category.
  return (
    <Dialog open={open} onClose={onClose} title={cat ? 'Edit category' : 'Add category'} wide>
      {open && <CategoryForm key={cat?.id ?? 'new'} cat={cat} onClose={onClose} />}
    </Dialog>
  );
}

function CategoryForm({ cat, onClose }: { cat: AdminCategory | null; onClose: () => void }) {
  const [f, setF] = useState({
    nameEn: cat?.nameEn ?? '',
    nameAr: cat?.nameAr ?? '',
    descriptionEn: cat?.descriptionEn ?? '',
    descriptionAr: cat?.descriptionAr ?? '',
    color: cat?.color ?? '#7f32d9',
  });
  const save = useContentMutation(
    (b: CategoryCreate) => (cat ? adminApi.updateCategory(cat.id, b) : adminApi.createCategory(b)),
    cat ? 'Category saved.' : 'Category added.',
    onClose,
  );
  const hex = /^#[0-9a-fA-F]{6}$/.test(f.color);
  const ok = f.nameEn.trim() && f.nameAr.trim() && hex;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (ok)
          save.mutate({
            nameEn: f.nameEn,
            nameAr: f.nameAr,
            descriptionEn: f.descriptionEn || null,
            descriptionAr: f.descriptionAr || null,
            color: f.color,
          });
      }}
      className="space-y-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Name (English)"
          value={f.nameEn}
          maxLength={80}
          onChange={(e) => setF({ ...f, nameEn: e.target.value })}
          autoFocus
        />
        <Input
          label="Name (Arabic)"
          dir="rtl"
          lang="ar"
          value={f.nameAr}
          maxLength={80}
          onChange={(e) => setF({ ...f, nameAr: e.target.value })}
        />
        <TextArea
          label="Description (English), optional"
          value={f.descriptionEn}
          maxLength={300}
          onChange={(e) => setF({ ...f, descriptionEn: e.target.value })}
        />
        <TextArea
          label="Description (Arabic), optional"
          dir="rtl"
          lang="ar"
          value={f.descriptionAr}
          maxLength={300}
          onChange={(e) => setF({ ...f, descriptionAr: e.target.value })}
        />
      </div>
      <fieldset>
        <legend className="mb-1.5 text-sm font-bold text-ink">Colour</legend>
        <div className="flex flex-wrap items-center gap-2">
          {SWATCHES.map(([c, name]) => (
            <button
              key={c}
              type="button"
              aria-label={name}
              aria-pressed={f.color.toLowerCase() === c}
              onClick={() => setF({ ...f, color: c })}
              className={`grid size-11 place-items-center rounded-full ring-offset-2 transition-shadow sm:size-9 ${
                f.color.toLowerCase() === c
                  ? 'ring-2 ring-navy'
                  : 'ring-1 ring-black/10 hover:ring-faint'
              }`}
              style={{ background: c }}
            >
              {f.color.toLowerCase() === c && (
                <AIcon
                  name="check"
                  size={16}
                  className={c === '#f8d749' || c === '#74dccf' ? 'text-navy' : 'text-white'}
                  strokeWidth={3}
                />
              )}
            </button>
          ))}
          <input
            aria-label="Custom colour, hex"
            value={f.color}
            onChange={(e) => setF({ ...f, color: e.target.value })}
            maxLength={7}
            spellCheck={false}
            className={`num min-h-11 w-28 rounded-xl bg-surface px-3 text-[0.9375rem] ring-1 ring-inset outline-none focus:ring-2 sm:min-h-9 ${hex ? 'ring-line focus:ring-purple' : 'ring-crimson'}`}
          />
        </div>
      </fieldset>
      {save.error && <Notice tone="bad">{explain(save.error)}</Notice>}
      <div className="flex justify-end gap-2">
        <Btn onClick={onClose} disabled={save.isPending}>
          Cancel
        </Btn>
        <Btn type="submit" variant="primary" disabled={!ok} loading={save.isPending}>
          {cat ? 'Save changes' : 'Add category'}
        </Btn>
      </div>
    </form>
  );
}

/* ═══════════════════ exhibitors ═══════════════════ */

function Exhibitors({ data }: { data: AdminContent }) {
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [editing, setEditing] = useState<AdminExhibitor | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const catName = useMemo(() => new Map(data.categories.map((c) => [c.id, c])), [data.categories]);
  const list = data.exhibitors.filter((e) => {
    const s = search.trim().toLowerCase();
    if (
      s &&
      !`${e.nameEn} ${e.nameAr ?? ''} ${e.projectEn ?? ''} ${e.booth ?? ''}`
        .toLowerCase()
        .includes(s)
    )
      return false;
    if (catFilter === 'none') return e.categoryIds.length === 0;
    if (catFilter === 'nophoto') return !e.photoUrl;
    return !catFilter || e.categoryIds.includes(catFilter);
  });
  const noCategory = data.exhibitors.filter((e) => e.categoryIds.length === 0 && e.isActive).length;
  const noPhoto = data.exhibitors.filter((e) => !e.photoUrl).length;

  return (
    <Panel
      title="Exhibitors"
      action={
        <div className="flex flex-wrap gap-2">
          <Btn
            icon="upload"
            onClick={() => setImporting(true)}
            disabled={data.categories.length === 0}
          >
            Import from file
          </Btn>
          <Btn
            variant="primary"
            icon="plus"
            onClick={() => setEditing('new')}
            disabled={data.categories.length === 0}
          >
            Add exhibitor
          </Btn>
        </div>
      }
      pad={false}
    >
      <div className="space-y-3 px-5 pt-3">
        {data.categories.length === 0 && (
          <Notice tone="warn">
            Add at least one category first, so exhibitors have somewhere to compete.
          </Notice>
        )}
        {noCategory > 0 && (
          <Notice tone="warn">
            {noCategory} active exhibitor{noCategory > 1 ? 's are' : ' is'} in no category, so
            visitors cannot see
            {noCategory > 1 ? ' them' : ' it'}.
          </Notice>
        )}
        <div className="grid gap-3 sm:grid-cols-[1fr_16rem]">
          <Input
            label="Search"
            placeholder="Name, project or booth"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select label="Show" value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
            <option value="">All exhibitors</option>
            <option value="none">In no category ({noCategory})</option>
            <option value="nophoto">Without a photo ({noPhoto})</option>
            {data.categories.map((c) => (
              <option key={c.id} value={c.id}>
                In {c.nameEn}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {data.exhibitors.length === 0 ? (
        <Empty icon="image" title="No exhibitors yet">
          Add each project with a photo and the categories it competes in.
        </Empty>
      ) : list.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted">
          Nothing matches. Clear the search or the filter.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {list.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-4 px-5 py-3">
              <Thumb url={e.photoUrl} name={e.nameEn} />
              <div className="min-w-0 flex-1 basis-56">
                <p className="break-words text-[0.9375rem] font-bold text-navy">
                  {e.nameEn}
                  {!e.isActive && (
                    <span className="ms-2 align-middle">
                      <Badge>Hidden</Badge>
                    </span>
                  )}
                </p>
                <p className="break-words text-sm text-muted">
                  {[e.nameAr, e.projectEn, e.booth && `Booth ${e.booth}`]
                    .filter(Boolean)
                    .join(' · ') || 'No details yet'}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {e.categoryIds.map((id) => (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1.5 rounded-full bg-canvas px-2 py-0.5 text-xs font-bold text-navy ring-1 ring-inset ring-line"
                    >
                      <span
                        className="size-2 rounded-full"
                        style={{ background: catName.get(id)?.color }}
                      />
                      {catName.get(id)?.nameEn ?? '…'}
                    </span>
                  ))}
                </div>
              </div>
              <Btn small icon="edit" onClick={() => setEditing(e)}>
                Edit
              </Btn>
            </li>
          ))}
        </ul>
      )}
      <BulkExhibitors
        open={importing}
        onClose={() => setImporting(false)}
        categories={data.categories}
        exhibitors={data.exhibitors}
      />
      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing && editing !== 'new' ? 'Edit exhibitor' : 'Add exhibitor'}
        wide
      >
        {editing !== null && (
          <ExhibitorForm
            key={editing === 'new' ? 'new' : editing.id}
            ex={editing === 'new' ? null : editing}
            categories={data.categories}
            onClose={() => setEditing(null)}
          />
        )}
      </Dialog>
    </Panel>
  );
}

function Thumb({ url, name }: { url: string | null; name: string }) {
  return url ? (
    <img
      src={url}
      alt=""
      width={96}
      height={60}
      loading="lazy"
      className="h-[60px] w-24 shrink-0 rounded-lg bg-royal-soft object-cover ring-1 ring-black/5"
    />
  ) : (
    <span
      title={`${name} has no photo yet`}
      className="grid h-[60px] w-24 shrink-0 place-items-center rounded-lg bg-canvas text-faint ring-1 ring-inset ring-line"
    >
      <AIcon name="image" size={22} />
    </span>
  );
}

function ExhibitorForm({
  ex,
  categories,
  onClose,
}: {
  ex: AdminExhibitor | null;
  categories: AdminCategory[];
  onClose: () => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState({
    nameEn: ex?.nameEn ?? '',
    nameAr: ex?.nameAr ?? '',
    projectEn: ex?.projectEn ?? '',
    projectAr: ex?.projectAr ?? '',
    descriptionEn: ex?.descriptionEn ?? '',
    descriptionAr: ex?.descriptionAr ?? '',
    booth: ex?.booth ?? '',
    categoryIds: ex?.categoryIds ?? [],
    isActive: ex?.isActive ?? true,
  });
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [chosen, setChosen] = useState<File | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  // The preview's temporary address is released when it is replaced and when the form closes.
  useEffect(() => {
    const url = photo?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [photo]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'content'] });
    void qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
  };
  const save = useMutation({
    mutationFn: async () => {
      const body: ExhibitorCreate = {
        nameEn: f.nameEn,
        nameAr: f.nameAr || null,
        projectEn: f.projectEn || null,
        projectAr: f.projectAr || null,
        descriptionEn: f.descriptionEn || null,
        descriptionAr: f.descriptionAr || null,
        booth: f.booth || null,
        categoryIds: f.categoryIds,
        isActive: f.isActive,
      };
      const saved = ex
        ? await adminApi.updateExhibitor(ex.id, body)
        : await adminApi.createExhibitor(body);
      try {
        if (photo) await adminApi.setPhoto(saved.id, photo.blob);
        else if (removePhoto && ex?.photoUrl) await adminApi.removePhoto(saved.id);
      } catch (e) {
        return { photoError: e };
      }
      return { photoError: null };
    },
    onSuccess: (r) => {
      refresh();
      if (r.photoError)
        toast(
          'bad',
          `Saved, but the photo did not upload: ${explain(r.photoError)} Open it again to retry.`,
        );
      else toast('good', ex ? 'Exhibitor saved.' : 'Exhibitor added.');
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => adminApi.deleteExhibitor(ex!.id),
    onSuccess: () => {
      refresh();
      toast('good', 'Exhibitor deleted.');
      onClose();
    },
    onError: (e) => {
      setConfirmDelete(false);
      toast('bad', explain(e));
    },
  });

  const take = (file: File | undefined) => file && setChosen(file);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    take(e.dataTransfer.files[0]);
  };
  const shown = photo ? photo.url : removePhoto ? null : (ex?.photoUrl ?? null);
  const ok = f.nameEn.trim().length > 0;

  if (chosen)
    return (
      <PhotoCropper
        file={chosen}
        onCancel={() => setChosen(null)}
        onDone={(blob) => {
          setPhoto({ blob, url: URL.createObjectURL(blob) });
          setRemovePhoto(false);
          setChosen(null);
        }}
      />
    );

  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) save.mutate();
        }}
        className="space-y-5"
      >
        <div className="grid gap-5 sm:grid-cols-[14rem_1fr]">
          <div className="space-y-2">
            <p className="text-sm font-bold text-ink">Photo</p>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={onDrop}
              className={`grid aspect-[16/10] w-full place-items-center overflow-hidden rounded-xl text-center ring-1 ring-inset transition-colors ${
                over ? 'bg-purple-soft ring-purple' : 'bg-canvas ring-line'
              }`}
            >
              {shown ? (
                <img src={shown} alt="" className="size-full object-cover" />
              ) : (
                <span className="space-y-1 p-3 text-sm text-muted">
                  <AIcon name="image" size={28} className="mx-auto text-faint" />
                  Drop a photo here
                </span>
              )}
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                take(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <div className="flex flex-wrap gap-2">
              <Btn small icon="upload" onClick={() => fileInput.current?.click()}>
                {shown ? 'Replace' : 'Choose photo'}
              </Btn>
              {shown && (
                <Btn
                  small
                  onClick={() => {
                    setPhoto(null);
                    setRemovePhoto(true);
                  }}
                >
                  Remove
                </Btn>
              )}
            </div>
            {photo && (
              <p className="text-sm text-muted">New photo ready. It uploads when you save.</p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Name (English)"
              value={f.nameEn}
              maxLength={120}
              onChange={(e) => setF({ ...f, nameEn: e.target.value })}
              autoFocus={!ex}
            />
            <Input
              label="Name (Arabic)"
              dir="rtl"
              lang="ar"
              value={f.nameAr}
              maxLength={120}
              onChange={(e) => setF({ ...f, nameAr: e.target.value })}
            />
            <Input
              label="Project (English)"
              value={f.projectEn}
              maxLength={160}
              onChange={(e) => setF({ ...f, projectEn: e.target.value })}
            />
            <Input
              label="Project (Arabic)"
              dir="rtl"
              lang="ar"
              value={f.projectAr}
              maxLength={160}
              onChange={(e) => setF({ ...f, projectAr: e.target.value })}
            />
            <Input
              label="Booth"
              value={f.booth}
              maxLength={24}
              onChange={(e) => setF({ ...f, booth: e.target.value })}
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextArea
            label="Description (English)"
            value={f.descriptionEn}
            maxLength={600}
            onChange={(e) => setF({ ...f, descriptionEn: e.target.value })}
          />
          <TextArea
            label="Description (Arabic)"
            dir="rtl"
            lang="ar"
            value={f.descriptionAr}
            maxLength={600}
            onChange={(e) => setF({ ...f, descriptionAr: e.target.value })}
          />
        </div>
        <fieldset>
          <legend className="mb-1 text-sm font-bold text-ink">Competes in</legend>
          <div className="grid gap-x-4 sm:grid-cols-2">
            {categories.map((c) => (
              <Check
                key={c.id}
                checked={f.categoryIds.includes(c.id)}
                onChange={(on) =>
                  setF({
                    ...f,
                    categoryIds: on
                      ? [...f.categoryIds, c.id]
                      : f.categoryIds.filter((x) => x !== c.id),
                  })
                }
              >
                <span className="inline-flex items-center gap-2">
                  <span className="size-3 rounded-full" style={{ background: c.color }} />
                  {c.nameEn}
                </span>
              </Check>
            ))}
          </div>
          {ex?.hasVotes && (
            <p className="text-sm text-muted">
              A category that already has votes for this exhibitor cannot be removed.
            </p>
          )}
        </fieldset>
        <Check checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })}>
          Visible to voters
        </Check>
        {save.error && <Notice tone="bad">{explain(save.error)}</Notice>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            {ex && (
              <Btn
                variant="ghost"
                icon="trash"
                onClick={() => setConfirmDelete(true)}
                disabled={save.isPending}
              >
                Delete
              </Btn>
            )}
          </div>
          <div className="flex gap-2">
            <Btn onClick={onClose} disabled={save.isPending}>
              Cancel
            </Btn>
            <Btn type="submit" variant="primary" disabled={!ok} loading={save.isPending}>
              {ex ? 'Save changes' : 'Add exhibitor'}
            </Btn>
          </div>
        </div>
      </form>
      <Confirm
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${ex?.nameEn ?? ''}?`}
        confirmLabel="Delete exhibitor"
        danger
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
      >
        {ex?.hasVotes ? (
          <Notice tone="warn">
            This exhibitor already has votes, so it cannot be deleted. Untick "Visible to voters"
            instead.
          </Notice>
        ) : (
          <p>The exhibitor and their photo are removed for good.</p>
        )}
      </Confirm>
    </>
  );
}
