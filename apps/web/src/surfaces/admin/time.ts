/** Event time zone helpers: organisers type and read times in Jordan time, whatever the laptop's own zone is. */

const TZ = 'Asia/Amman';
function parts(d: Date) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(d);
  const g = (t: string) => f.find((p) => p.type === t)!.value;
  return { y: g('year'), mo: g('month'), d: g('day'), h: g('hour'), mi: g('minute') };
}
/** ISO instant → the "YYYY-MM-DDTHH:mm" a datetime-local box shows, in Amman time. */
export function toAmman(iso: string | null): string {
  if (!iso) return '';
  const p = parts(new Date(iso));
  return `${p.y}-${p.mo}-${p.d}T${p.h}:${p.mi}`;
}
/** What the organiser typed (Amman time) → an ISO instant. */
export function fromAmman(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const asUtc = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
  // Find the offset that Amman has at that moment (it is +3 all year now, but the zone database decides, not us).
  const p = parts(new Date(asUtc));
  const shown = Date.UTC(+p.y, +p.mo - 1, +p.d, +p.h, +p.mi);
  return new Date(asUtc - (shown - asUtc)).toISOString();
}
