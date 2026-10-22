import type { AutomationStatus, BulkAddResult, Channel, ChannelCandidate, Digest } from '../shared/types';
import { isEmailConfigured, renderDigestEmail, sendEmail } from './mailer';
import { getStore, toPublicChannel, type StoredChannel } from './store';
import { fallbackSummary, isGeminiConfigured, summarizeVideo } from './summarizer';
import {
  checkIsShort,
  defaultThumbnail,
  fetchChannelFeed,
  fetchChannelPage,
  fetchTranscript,
  fetchVideoMeta,
  isChannelId,
  parseChannelInput,
  pickThumbnail,
  searchChannels,
  videoUrl,
  type FeedEntry,
} from './youtube';

/**
 * Arka plan otomasyonu: kanalları belirli aralıklarla tarar, yeni videoları
 * kuyruğa ekler ve kuyruğu sırayla işler (özetle → e-posta gönder).
 *
 * Eski sürümdeki sorunlar ve buradaki karşılıkları:
 * - Yalnızca "son video kimliği" tutuluyordu; video silinince ya da aynı anda
 *   iki video gelince yanlış/eksik mail gidiyordu. Artık her kanal için görülen
 *   video kimlikleri listesi tutuluyor.
 * - E-posta ya da Gemini hata verince video bir daha denenmiyordu. Artık
 *   3 denemeye kadar tekrar deneniyor.
 * - fetch çağrılarında zaman aşımı yoktu; tek bir takılan istek tüm taramaları
 *   sonsuza dek kilitleyebiliyordu.
 * - Tarayıcı sekmesi de kendi sayacıyla tarama tetikliyordu; açık her sekme
 *   ekstra tarama demekti. Artık zamanlayıcı yalnızca sunucuda.
 */

const NOTIFY_MAX_AGE_MS = 72 * 60 * 60 * 1000;
const ADDED_GRACE_MS = 60 * 60 * 1000;
const MAX_NEW_PER_CHANNEL = 3;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 10 * 60 * 1000;
const LIVE_RECHECK_MS = 15 * 60 * 1000;
const LIVE_MAX_WAIT_MS = 48 * 60 * 60 * 1000;
const MIN_TRIGGER_GAP_MS = 45 * 1000;
const SCAN_CONCURRENCY = 4;
const SHORTS_MAX_SECONDS = 180;

let scanning = false;
let processing = false;
let lastScanStartedAt = 0;
let nextScanAt = Date.now() + 20_000;

// Beslemeden gelen açıklamalar; izleme sayfası açılamazsa özet için kullanılır.
const feedDescriptions = new Map<string, string>();

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Durum
// ---------------------------------------------------------------------------

export function getAutomationStatus(authEnabled: boolean): AutomationStatus {
  const store = getStore();
  return {
    enabled: store.scan.enabled,
    intervalMinutes: store.scan.intervalMinutes,
    scanning,
    processing,
    lastScanAt: store.stats.lastScanAt,
    nextScanAt: store.scan.enabled ? new Date(nextScanAt).toISOString() : null,
    totalScans: store.stats.totalScans,
    totalEmails: store.stats.totalEmails,
    serverTime: new Date().toISOString(),
    setup: {
      gemini: isGeminiConfigured(),
      email: isEmailConfigured(),
      channels: store.channels.length > 0,
      auth: authEnabled,
    },
    cronPath: `/api/cron/scan?key=${encodeURIComponent(store.cronKey)}`,
    appUrl: process.env['APP_URL'] && !process.env['APP_URL'].startsWith('MY_') ? process.env['APP_URL'] : null,
  };
}

export function setAutomationEnabled(enabled: boolean): void {
  const store = getStore();
  store.updateSettings({ scan: { enabled } });
  if (enabled) nextScanAt = Date.now() + 5_000;
  store.log('info', enabled ? 'Otomatik tarama açıldı.' : 'Otomatik tarama durduruldu.');
}

export function rescheduleAfterSettingsChange(): void {
  const store = getStore();
  const interval = store.scan.intervalMinutes * 60_000;
  const base = lastScanStartedAt || Date.now();
  nextScanAt = Math.max(Date.now() + 5_000, base + interval);
}

// ---------------------------------------------------------------------------
// Tarama
// ---------------------------------------------------------------------------

export interface ScanResult {
  started: boolean;
  scanned: number;
  newVideos: number;
  errors: number;
}

export async function runScan(source: 'auto' | 'manual' | 'cron'): Promise<ScanResult> {
  if (scanning) return { started: false, scanned: 0, newVideos: 0, errors: 0 };
  if (source === 'cron' && Date.now() - lastScanStartedAt < MIN_TRIGGER_GAP_MS) {
    return { started: false, scanned: 0, newVideos: 0, errors: 0 };
  }

  const store = getStore();
  scanning = true;
  lastScanStartedAt = Date.now();
  nextScanAt = lastScanStartedAt + store.scan.intervalMinutes * 60_000;
  store.stats.totalScans += 1;
  store.stats.lastScanAt = new Date().toISOString();
  store.save();

  let newVideos = 0;
  let errors = 0;
  const channels = store.channels.filter((c) => !c.paused);
  try {
    const results = await mapLimit(channels, SCAN_CONCURRENCY, scanChannel);
    for (const r of results) {
      newVideos += r.newVideos;
      if (r.error) errors += 1;
    }
    // Her 5 dakikada bir "yeni video yok" yazmak günlüğü boğuyordu;
    // yalnızca elle yapılan taramalarda ya da bir şey olduğunda kayıt düşülür.
    if (source !== 'auto' || newVideos > 0 || errors > 0) {
      const label = source === 'manual' ? 'Elle tarama' : source === 'cron' ? 'Dış tetikleyici taraması' : 'Otomatik tarama';
      store.log(
        errors > 0 ? 'warn' : 'info',
        `${label}: ${channels.length} kanal kontrol edildi, ${newVideos} yeni video` + (errors > 0 ? `, ${errors} kanalda hata.` : '.'),
      );
    }
  } finally {
    scanning = false;
    store.save();
  }

  void drainQueue();
  return { started: true, scanned: channels.length, newVideos, errors };
}

async function scanChannel(ch: StoredChannel): Promise<{ newVideos: number; error: boolean }> {
  const store = getStore();
  const now = Date.now();
  let entries: FeedEntry[];
  try {
    const feed = await fetchChannelFeed(ch.id);
    entries = feed.entries;
    if (feed.channelName && feed.channelName !== ch.name) ch.name = feed.channelName;
  } catch (err) {
    ch.lastCheckedAt = new Date(now).toISOString();
    ch.lastError = errorMessage(err);
    return { newVideos: 0, error: true };
  }

  ch.lastCheckedAt = new Date(now).toISOString();
  ch.lastError = null;
  if (entries[0]) {
    ch.lastVideo = { id: entries[0].id, title: entries[0].title, publishedAt: entries[0].publishedAt };
  }

  const unseen = entries.filter((e) => !ch.seenIds.includes(e.id));
  if (unseen.length === 0) return { newVideos: 0, error: false };
  store.markSeen(ch, unseen.map((e) => e.id));

  // Kanal kaldırıldıysa (tarama sürerken) iş üretme
  if (!store.findChannel(ch.id)) return { newVideos: 0, error: false };

  // YouTube beslemesi yeni videoları birkaç dakika gecikmeli gösterebiliyor; kanal
  // eklenmeden kısa süre önce yayınlanıp beslemeye sonradan düşen videolar da yeni sayılır.
  const addedAt = Date.parse(ch.addedAt) - ADDED_GRACE_MS;
  const fresh = unseen
    .filter((e) => {
      const published = Date.parse(e.publishedAt);
      return published >= addedAt && now - published <= NOTIFY_MAX_AGE_MS;
    })
    .slice(0, MAX_NEW_PER_CHANNEL)
    .reverse(); // eskiden yeniye işlensin

  for (const entry of fresh) {
    if (store.findDigest(entry.id)) continue;
    feedDescriptions.set(entry.id, entry.description);
    const skipAsShort = store.scan.skipShorts && entry.isShortLink;
    store.addDigest(createDigest(ch, entry, 'auto', true, skipAsShort ? 'skipped' : 'queued'));
    if (skipAsShort) {
      updateDigest(entry.id, { statusNote: 'Shorts videosu olduğu için atlandı.' });
    } else {
      store.log('success', `${ch.name} yeni video yükledi: "${entry.title}"`);
    }
  }
  return { newVideos: fresh.length, error: false };
}

function createDigest(
  ch: Channel,
  entry: FeedEntry,
  source: Digest['source'],
  wantsEmail: boolean,
  status: Digest['status'],
): Digest {
  return {
    id: entry.id,
    channelId: ch.id,
    channelName: ch.name,
    channelAvatar: ch.avatar,
    title: entry.title,
    url: videoUrl(entry.id),
    thumbnail: defaultThumbnail(entry.id),
    publishedAt: entry.publishedAt,
    detectedAt: new Date().toISOString(),
    durationSeconds: null,
    source,
    status,
    statusNote: null,
    attempts: 0,
    nextAttemptAt: null,
    summary: null,
    emailedAt: null,
    wantsEmail,
  };
}

function updateDigest(id: string, patch: Partial<Digest>): void {
  const d = getStore().findDigest(id);
  if (d) Object.assign(d, patch);
  getStore().save();
}

// ---------------------------------------------------------------------------
// Kuyruk işleme
// ---------------------------------------------------------------------------

function nextDueDigest(): Digest | undefined {
  const now = Date.now();
  const due = getStore().digests.filter(
    (d) =>
      (d.status === 'queued' || d.status === 'waiting') && (!d.nextAttemptAt || Date.parse(d.nextAttemptAt) <= now),
  );
  return due.sort((a, b) => a.detectedAt.localeCompare(b.detectedAt))[0];
}

export async function drainQueue(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    // Aynı turda sonsuz döngüye girmemek için bir üst sınır
    for (let i = 0; i < 25; i++) {
      const next = nextDueDigest();
      if (!next) break;
      await processDigest(next);
    }
  } finally {
    processing = false;
    getStore().save();
  }
}

function scheduleRetry(d: Digest, note: string): void {
  if (d.attempts >= MAX_ATTEMPTS) {
    d.status = 'failed';
    d.statusNote = note;
    d.nextAttemptAt = null;
    getStore().log('error', `"${d.title}" işlenemedi: ${note}`);
  } else {
    d.status = 'queued';
    d.statusNote = `${note} (tekrar denenecek)`;
    d.nextAttemptAt = new Date(Date.now() + RETRY_DELAY_MS).toISOString();
    getStore().log('warn', `"${d.title}" için ${d.attempts}. deneme başarısız: ${note}`);
  }
}

async function processDigest(d: Digest): Promise<void> {
  const store = getStore();
  d.status = 'processing';
  d.statusNote = null;
  d.attempts += 1;
  store.save();

  try {
    const meta = await fetchVideoMeta(d.id);
    if (meta && (meta.isUpcoming || meta.isLiveNow)) {
      d.attempts -= 1; // bekleme deneme sayılmaz
      if (Date.now() - Date.parse(d.detectedAt) > LIVE_MAX_WAIT_MS) {
        d.status = 'skipped';
        d.statusNote = 'Yayın 48 saat içinde tamamlanmadığı için atlandı.';
      } else {
        d.status = 'waiting';
        d.statusNote = meta.isLiveNow ? 'Canlı yayın sürüyor, bitince özetlenecek.' : 'Prömiyer henüz başlamadı, yayınlanınca özetlenecek.';
        d.nextAttemptAt = new Date(Date.now() + LIVE_RECHECK_MS).toISOString();
      }
      return;
    }
    if (meta?.title) d.title = meta.title;
    if (meta?.lengthSeconds) d.durationSeconds = meta.lengthSeconds;

    if (d.source === 'auto' && store.scan.skipShorts && !d.summary) {
      const maybeShort = d.durationSeconds === null || d.durationSeconds <= SHORTS_MAX_SECONDS;
      if (maybeShort && (await checkIsShort(d.id))) {
        d.status = 'skipped';
        d.statusNote = 'Shorts videosu olduğu için atlandı.';
        return;
      }
    }

    if (d.thumbnail === defaultThumbnail(d.id)) d.thumbnail = await pickThumbnail(d.id);

    if (!d.summary) {
      const description = meta?.description || feedDescriptions.get(d.id) || '';
      if (isGeminiConfigured()) {
        const prefs = store.summarySettings;
        const transcript = meta?.captionTracks.length
          ? await fetchTranscript(meta.captionTracks, prefs.language === 'tr' ? ['tr', 'en'] : ['en', 'tr'])
          : '';
        try {
          d.summary = await summarizeVideo({
            videoId: d.id,
            title: d.title,
            channelName: d.channelName,
            description,
            transcript,
            durationSeconds: d.durationSeconds,
            language: prefs.language,
            length: prefs.length,
            watchVideo: prefs.watchVideo,
          });
        } catch (err) {
          if (d.attempts < MAX_ATTEMPTS) {
            scheduleRetry(d, `Gemini özeti alınamadı: ${errorMessage(err).slice(0, 160)}`);
            return;
          }
          // Son denemede de olmadıysa en azından bildirimi özetsiz gönder
          d.summary = fallbackSummary(description);
        }
      } else {
        d.summary = fallbackSummary(description);
      }
    }

    if (!d.wantsEmail) {
      d.status = 'ready';
      return;
    }
    if (!isEmailConfigured()) {
      d.status = 'ready';
      d.statusNote = 'E-posta ayarları eksik olduğu için gönderilmedi.';
      return;
    }

    try {
      await sendEmail(renderDigestEmail(d, d.summary));
      d.status = 'sent';
      d.emailedAt = new Date().toISOString();
      d.wantsEmail = false;
      d.nextAttemptAt = null;
      store.stats.totalEmails += 1;
      store.log('success', `"${d.title}" özeti e-postayla gönderildi.`);
    } catch (err) {
      scheduleRetry(d, errorMessage(err));
    }
  } catch (err) {
    scheduleRetry(d, errorMessage(err));
  } finally {
    store.save();
  }
}

// ---------------------------------------------------------------------------
// Elle yapılan işlemler
// ---------------------------------------------------------------------------

export async function summarizeLatest(channelId: string, sendMail: boolean): Promise<Digest> {
  const store = getStore();
  const ch = store.findChannel(channelId);
  if (!ch) throw new Error('Kanal bulunamadı.');
  const feed = await fetchChannelFeed(ch.id);
  const entry = feed.entries[0];
  if (!entry) throw new Error('Bu kanalda henüz video yok.');
  store.markSeen(ch, [entry.id]);

  let d = store.findDigest(entry.id);
  if (d) {
    if (sendMail && d.status !== 'processing') {
      d.wantsEmail = true;
      d.status = 'queued';
      d.attempts = 0;
      d.nextAttemptAt = null;
    }
  } else {
    feedDescriptions.set(entry.id, entry.description);
    d = createDigest(ch, entry, 'manual', sendMail, 'queued');
    store.addDigest(d);
  }
  store.save();
  void drainQueue();
  return d;
}

export function requeueDigest(id: string, mode: 'resend' | 'regenerate'): Digest {
  const store = getStore();
  const d = store.findDigest(id);
  if (!d) throw new Error('Özet bulunamadı.');
  if (d.status === 'processing') throw new Error('Bu video şu an işleniyor.');
  if (mode === 'resend') {
    d.wantsEmail = true;
  } else {
    d.summary = null;
    d.wantsEmail = d.wantsEmail && !d.emailedAt;
  }
  d.status = 'queued';
  d.statusNote = null;
  d.attempts = 0;
  d.nextAttemptAt = null;
  store.save();
  void drainQueue();
  return d;
}

/**
 * Bir girdiyi (link, @handle, kanal kimliği ya da isim) kanala çevirir ve
 * listeye ekler. Kanalın mevcut videoları "görüldü" sayılır; yalnızca
 * eklendikten sonra yüklenen videolar için e-posta gider.
 */
export async function addChannel(candidate: ChannelCandidate, allowSearch: boolean): Promise<Channel> {
  const store = getStore();
  let id = candidate.id && isChannelId(candidate.id) ? candidate.id : '';
  let page: Awaited<ReturnType<typeof fetchChannelPage>> = null;

  if (!id) {
    const parsed = parseChannelInput(candidate.input ?? candidate.handle ?? '');
    if (!parsed) throw new Error('Geçerli bir kanal linki, @kullanıcıadı ya da kanal kimliği gir.');
    if (parsed.kind === 'id') id = parsed.id;
    else if (parsed.kind === 'handle' || parsed.kind === 'path') {
      const path = parsed.kind === 'handle' ? `@${encodeURIComponent(parsed.handle.slice(1))}` : parsed.path;
      page = await fetchChannelPage(path).catch(
        () => null,
      );
      if (!page) throw new Error(`"${candidate.input}" adlı bir kanal bulunamadı.`);
      id = page.id;
    } else {
      if (!allowSearch) throw new Error('Kanalı aramadan seç ya da @kullanıcıadı gir.');
      const [first] = await searchChannels(parsed.query);
      if (!first) throw new Error(`"${parsed.query}" için kanal bulunamadı.`);
      id = first.id;
      candidate = { ...candidate, name: candidate.name ?? first.name, handle: first.handle, avatar: first.avatar, subscribers: first.subscribers };
    }
  }

  if (store.findChannel(id)) throw new Error('Bu kanal zaten listende.');

  const feed = await fetchChannelFeed(id);
  if (!candidate.avatar && !page) page = await fetchChannelPage(`channel/${id}`).catch(() => null);

  const now = new Date().toISOString();
  const latest = feed.entries[0];
  const channel: StoredChannel = {
    id,
    name: candidate.name || page?.name || feed.channelName || 'YouTube kanalı',
    handle: candidate.handle || page?.handle || '',
    avatar: candidate.avatar || page?.avatar || '',
    subscribers: candidate.subscribers ?? page?.subscribers ?? null,
    addedAt: now,
    paused: false,
    lastVideo: latest ? { id: latest.id, title: latest.title, publishedAt: latest.publishedAt } : null,
    lastCheckedAt: now,
    lastError: null,
    seenIds: feed.entries.map((e) => e.id),
  };
  if (store.findChannel(id)) throw new Error('Bu kanal zaten listende.');
  store.addChannel(channel);
  store.log('info', `${channel.name} takibe alındı.`);
  return toPublicChannel(channel);
}

export async function addChannelsBulk(inputs: string[]): Promise<BulkAddResult> {
  const result: BulkAddResult = { added: [], skipped: [] };
  const unique = [...new Set(inputs.map((i) => i.trim()).filter(Boolean))].slice(0, 50);
  await mapLimit(unique, 3, async (input) => {
    try {
      result.added.push(await addChannel({ input }, true));
    } catch (err) {
      result.skipped.push({ input, reason: errorMessage(err) });
    }
  });
  return result;
}

// ---------------------------------------------------------------------------
// Zamanlayıcı
// ---------------------------------------------------------------------------

declare global {
  var __ozetciTimer: ReturnType<typeof setInterval> | undefined;
}

/**
 * Sunucu tarafındaki tek zamanlayıcı. Geliştirme sunucusunda modül yeniden
 * yüklendiğinde eski zamanlayıcı durdurulur, böylece iki kat tarama olmaz.
 */
export function startScheduler(): void {
  if (globalThis.__ozetciTimer) clearInterval(globalThis.__ozetciTimer);
  const store = getStore();
  // Sunucu kapandığında yarıda kalan işler kuyruğa geri alınır
  for (const d of store.digests) if (d.status === 'processing') d.status = 'queued';
  store.save();

  globalThis.__ozetciTimer = setInterval(() => {
    if (store.scan.enabled && !scanning && Date.now() >= nextScanAt) {
      runScan('auto').catch((err) => console.error('[ozetci] Tarama hatası:', err));
    } else if (!scanning) {
      void drainQueue();
    }
  }, 10_000);
  globalThis.__ozetciTimer.unref?.();
  console.log(`[ozetci] Zamanlayıcı başladı (her ${store.scan.intervalMinutes} dakikada bir tarama).`);
}
