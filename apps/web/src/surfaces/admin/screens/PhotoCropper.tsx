import { PHOTO_MAX_BYTES } from '@mc/shared/manage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Btn, Notice } from '../ui';

/** The voter cards and the TV rows both show photos at 16:10, so that is the one crop the console offers. */
const ASPECT = 16 / 10;
const OUT_W = 1280;
const OUT_H = OUT_W / ASPECT;
const MAX_ZOOM = 4;

/**
 * Crop to 16:10 and encode to WebP in the browser. Re-encoding through a canvas drops everything but pixels (EXIF, GPS,
 * colour profiles), and the server then re-checks the file's structure anyway: this step is for the organiser's
 * convenience and for privacy, never the only line of defence.
 */
export function PhotoCropper({
  file,
  onCancel,
  onDone,
}: {
  file: File;
  onCancel: () => void;
  onDone: (blob: Blob) => void;
}) {
  const [bmp, setBmp] = useState<ImageBitmap | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  // Where the organiser dragged the picture to (its top-left inside the frame); null until they touch it.
  const [dragged, setDragged] = useState<{ x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [fw, setFw] = useState(480);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  useEffect(() => {
    let alive = true;
    let opened: ImageBitmap | null = null;
    createImageBitmap(file, { imageOrientation: 'from-image' })
      .then((b) => {
        // A full-resolution decoded picture is large: release it as soon as this screen goes away.
        if (!alive) return b.close();
        opened = b;
        setBmp(b);
      })
      .catch(
        () =>
          alive &&
          setFailed(
            'This file is not an image the browser can open. Choose a JPG, PNG or WebP photo.',
          ),
      );
    return () => {
      alive = false;
      opened?.close();
    };
  }, [file]);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFw(Math.round(el.clientWidth)));
    ro.observe(el);
    setFw(Math.round(el.clientWidth));
    return () => ro.disconnect();
  }, [bmp]);

  const fh = Math.round(fw / ASPECT);
  const scaleOf = useCallback(
    (z: number) => (bmp ? Math.max(fw / bmp.width, fh / bmp.height) * z : 1),
    [bmp, fw, fh],
  );
  const clamp = useCallback(
    (x: number, y: number, z: number) => {
      if (!bmp) return { x, y };
      const s = scaleOf(z);
      return {
        x: Math.min(0, Math.max(fw - bmp.width * s, x)),
        y: Math.min(0, Math.max(fh - bmp.height * s, y)),
      };
    },
    [bmp, fw, fh, scaleOf],
  );

  // Until it is dragged the picture is centred; either way it always covers the frame, whatever size the frame is.
  const pos = (() => {
    if (!bmp) return { x: 0, y: 0 };
    const s0 = scaleOf(zoom);
    return dragged
      ? clamp(dragged.x, dragged.y, zoom)
      : clamp((fw - bmp.width * s0) / 2, (fh - bmp.height * s0) / 2, zoom);
  })();
  const setPos = (p: { x: number; y: number }) => setDragged(p);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !bmp) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = fw * dpr;
    c.height = fh * dpr;
    const ctx = c.getContext('2d')!;
    const s = scaleOf(zoom) * dpr;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, pos.x * dpr, pos.y * dpr, bmp.width * s, bmp.height * s);
  }, [bmp, fw, fh, zoom, pos.x, pos.y, scaleOf]);

  const changeZoom = (z: number) => {
    if (!bmp) return;
    // Zoom around the centre of the frame, so the part you framed stays framed.
    const s0 = scaleOf(zoom);
    const s1 = scaleOf(z);
    const cx = (fw / 2 - pos.x) / s0;
    const cy = (fh / 2 - pos.y) / s0;
    setZoom(z);
    setDragged(clamp(fw / 2 - cx * s1, fh / 2 - cy * s1, z));
  };

  const small = bmp ? bmp.width < 900 : false;

  const finish = async () => {
    if (!bmp) return;
    setBusy(true);
    try {
      const k = OUT_W / fw;
      const s = scaleOf(zoom) * k; // output pixels per image pixel
      const out = document.createElement('canvas');
      out.width = OUT_W;
      out.height = OUT_H;
      const ctx = out.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bmp, pos.x * k, pos.y * k, bmp.width * s, bmp.height * s);
      let blob: Blob | null = null;
      for (const q of [0.86, 0.78, 0.68, 0.55]) {
        blob = await new Promise<Blob | null>((r) => out.toBlob(r, 'image/webp', q));
        if (!blob || blob.type !== 'image/webp') break;
        if (blob.size <= PHOTO_MAX_BYTES - 8 * 1024) break;
      }
      if (!blob || blob.type !== 'image/webp') {
        setFailed(
          'This browser cannot save WebP photos. Use a recent Chrome, Edge, Firefox or Safari 17.',
        );
      } else if (blob.size > PHOTO_MAX_BYTES) {
        setFailed('The photo is still too detailed to fit. Choose a simpler or smaller photo.');
      } else onDone(blob);
    } finally {
      setBusy(false);
    }
  };

  if (failed)
    return (
      <div className="space-y-4">
        <Notice tone="bad">{failed}</Notice>
        <Btn onClick={onCancel}>Back</Btn>
      </div>
    );
  if (!bmp) return <p className="py-10 text-center text-sm text-muted">Opening the photo…</p>;

  return (
    <div className="space-y-4">
      <div
        ref={frame}
        tabIndex={0}
        role="group"
        aria-label="Photo frame. Drag to move, or use the arrow keys."
        style={{ height: fh }}
        className="relative w-full cursor-grab touch-none overflow-hidden rounded-2xl bg-navy-deep ring-1 ring-line active:cursor-grabbing"
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) setPos(clamp(d.px + e.clientX - d.x, d.py + e.clientY - d.y, zoom));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 40 : 10;
          const d: Record<string, [number, number]> = {
            ArrowLeft: [step, 0],
            ArrowRight: [-step, 0],
            ArrowUp: [0, step],
            ArrowDown: [0, -step],
          };
          const v = d[e.key];
          if (v) {
            e.preventDefault();
            setPos(clamp(pos.x + v[0], pos.y + v[1], zoom));
          }
        }}
      >
        <canvas ref={canvas} style={{ width: fw, height: fh }} className="block" />
        <div className="pointer-events-none absolute inset-0 rounded-2xl ring-2 ring-inset ring-white/60" />
      </div>
      <label className="flex min-h-11 items-center gap-3 text-sm font-bold text-ink">
        Zoom
        <input
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={zoom}
          onChange={(e) => changeZoom(Number(e.target.value))}
          className="h-11 flex-1 accent-purple"
        />
      </label>
      {small && (
        <Notice tone="warn">
          This photo is small and may look soft on the TVs. A photo at least 1280 pixels wide is
          best.
        </Notice>
      )}
      <p className="text-sm text-muted">
        Drag the photo to choose what shows. Voters and the TVs see this 16:10 frame.
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <Btn onClick={onCancel} disabled={busy}>
          Choose another
        </Btn>
        <Btn variant="primary" onClick={() => void finish()} loading={busy}>
          Use this photo
        </Btn>
      </div>
    </div>
  );
}
