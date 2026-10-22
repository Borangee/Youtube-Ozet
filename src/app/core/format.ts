/** Arayüzdeki tarih/süre biçimlendirmeleri. Sunucu ISO zaman damgası gönderir. */

const rtf = new Intl.RelativeTimeFormat('tr', { numeric: 'auto' });

export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const diff = t - now;
  const abs = Math.abs(diff);
  if (abs < 45_000) return diff <= 0 ? 'az önce' : 'birazdan';
  const minutes = Math.round(diff / 60_000);
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
  const hours = Math.round(diff / 3_600_000);
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
  const days = Math.round(diff / 86_400_000);
  if (Math.abs(days) < 7) return rtf.format(days, 'day');
  return new Date(t).toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'short',
    year: new Date(t).getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric',
  });
}

export function absoluteTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Date(t).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
}

export function duration(seconds: number | null | undefined): string {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function countdown(ms: number): string {
  if (ms <= 0) return 'şimdi';
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
