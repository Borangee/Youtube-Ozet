import type { Chapter, ChannelSearchResult } from '../shared/types';

/**
 * YouTube ile konuşan her şey burada: RSS beslemesi, kanal çözümleme, arama,
 * video sayfası meta verisi ve altyazı. API anahtarı gerektirmez.
 *
 * Bu dosyanın üst kısmındaki ayrıştırıcılar saf fonksiyonlardır ve
 * youtube.spec.ts içinde örnek verilerle test edilir.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

// AB bölgesindeki sunuculardan istek atılınca YouTube çerez onay sayfasına yönlendiriyor.
// Bu çerezler onay sayfasını atlatır.
const CONSENT_COOKIE = 'SOCS=CAI; CONSENT=YES+cb';

const CHANNEL_ID_RE = /^UC[0-9A-Za-z_-]{22}$/;
const VIDEO_ID_RE = /^[0-9A-Za-z_-]{11}$/;

export function isChannelId(value: string): boolean {
  return CHANNEL_ID_RE.test(value);
}

export function isVideoId(value: string): boolean {
  return VIDEO_ID_RE.test(value);
}

// ---------------------------------------------------------------------------
// Saf yardımcılar
// ---------------------------------------------------------------------------

export function decodeEntities(text: string): string {
  if (!text) return '';
  return text
    .replace(/&#(\d+);/g, (_, n: string) => safeFromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => safeFromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&'); // en sonda, çift çözümlemeyi önlemek için
}

function safeFromCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/**
 * HTML içindeki `marker` ifadesinden sonra gelen ilk JSON nesnesini,
 * süslü parantezleri dengeli şekilde sayarak çıkarır. Regex ile `.*?` kullanmak
 * iç içe nesnelerde yanlış yerde kesiyordu.
 */
export function extractJsonObject(source: string, marker: string): unknown | null {
  const markerIdx = source.indexOf(marker);
  if (markerIdx === -1) return null;
  const start = source.indexOf('{', markerIdx + marker.length);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Nesne ağacında verilen anahtara sahip tüm değerleri toplar. */
export function collectByKey<T>(root: unknown, key: string, limit = 200): T[] {
  const found: T[] = [];
  const stack: unknown[] = [root];
  while (stack.length > 0 && found.length < limit) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) stack.push(node[i]);
      continue;
    }
    const rec = node as Record<string, unknown>;
    if (key in rec) found.push(rec[key] as T);
    const values = Object.values(rec);
    for (let i = values.length - 1; i >= 0; i--) stack.push(values[i]);
  }
  return found;
}

export interface FeedEntry {
  id: string;
  title: string;
  publishedAt: string;
  description: string;
  isShortLink: boolean;
}

export interface ParsedFeed {
  channelId: string | null;
  channelName: string | null;
  entries: FeedEntry[];
}

/**
 * YouTube Atom beslemesini ayrıştırır. Dikkat: beslemenin en başında kanalın
 * kendi <published> ve <title> alanları da var; eski kod ilk <published>'ı
 * alıp kanalın açılış tarihini "son video tarihi" diye gösteriyordu.
 * Burada her alan yalnızca kendi <entry> bloğunun içinden okunur.
 */
export function parseFeed(xml: string): ParsedFeed {
  const firstEntry = xml.indexOf('<entry>');
  const head = firstEntry === -1 ? xml : xml.slice(0, firstEntry);

  const channelId = head.match(/<yt:channelId>([^<]+)<\/yt:channelId>/)?.[1]?.trim() ?? null;
  const channelName = head.match(/<author>\s*<name>([\s\S]*?)<\/name>/)?.[1] ?? head.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? null;

  const entries: FeedEntry[] = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const block = m[1];
    const id = block.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1]?.trim();
    if (!id || !isVideoId(id)) continue;
    const title = decodeEntities(block.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? '');
    const publishedAt = block.match(/<published>([^<]+)<\/published>/)?.[1]?.trim() ?? '';
    const description = decodeEntities(block.match(/<media:description>([\s\S]*?)<\/media:description>/)?.[1]?.trim() ?? '');
    const link = block.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/)?.[1] ?? '';
    entries.push({
      id,
      title: title || 'Başlıksız video',
      publishedAt: normalizeDate(publishedAt),
      description,
      isShortLink: link.includes('/shorts/'),
    });
  }

  return {
    channelId: channelId && isChannelId(channelId) ? channelId : null,
    channelName: channelName ? decodeEntities(channelName.trim()) : null,
    entries,
  };
}

function normalizeDate(raw: string): string {
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

export type ChannelInput =
  | { kind: 'id'; id: string }
  | { kind: 'handle'; handle: string }
  | { kind: 'path'; path: string }
  | { kind: 'query'; query: string };

/** Kullanıcının yazdığı şeyi (link, @handle, kanal kimliği, isim) sınıflandırır. */
export function parseChannelInput(raw: string): ChannelInput | null {
  const input = raw.trim();
  if (!input) return null;
  if (isChannelId(input)) return { kind: 'id', id: input };

  const urlMatch = input.match(/^(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/(.+)$/i);
  if (urlMatch) {
    const path = urlMatch[1].split(/[?#]/)[0];
    const segments = path.split('/').filter(Boolean);
    const [first, second] = segments;
    if (!first) return null;
    if (first.startsWith('@')) return { kind: 'handle', handle: cleanHandle(first) };
    if (first === 'channel' && second && isChannelId(second)) return { kind: 'id', id: second };
    if ((first === 'c' || first === 'user') && second) {
      return { kind: 'path', path: `${first}/${encodeURIComponent(safeDecodeURIComponent(second))}` };
    }
    return null;
  }

  if (input.startsWith('@')) {
    const handle = cleanHandle(input);
    return handle.length > 1 ? { kind: 'handle', handle } : null;
  }

  // Boşluk içermeyen tek kelime büyük ihtimalle bir kullanıcı adı
  if (/^[A-Za-z0-9._-]{3,30}$/.test(input)) return { kind: 'handle', handle: `@${input}` };
  return { kind: 'query', query: input };
}

function cleanHandle(handle: string): string {
  const decoded = safeDecodeURIComponent(handle.replace(/^@+/, ''));
  return '@' + decoded.replace(/[^\p{L}\p{N}._-]/gu, '');
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export interface ChannelPageInfo {
  id: string;
  name: string;
  handle: string | null;
  avatar: string;
  subscribers: string | null;
}

/** Kanal sayfası HTML'inden kimlik, ad, kullanıcı adı ve avatarı çıkarır. */
export function parseChannelPage(html: string): ChannelPageInfo | null {
  const id =
    html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[0-9A-Za-z_-]{22})"/)?.[1] ??
    html.match(/<meta itemprop="identifier" content="(UC[0-9A-Za-z_-]{22})"/)?.[1] ??
    html.match(/"externalId":"(UC[0-9A-Za-z_-]{22})"/)?.[1];
  if (!id) return null;

  const name = decodeEntities(html.match(/<meta property="og:title" content="([^"]*)"/)?.[1] ?? '');
  const avatar = decodeEntities(html.match(/<meta property="og:image" content="([^"]*)"/)?.[1] ?? '');
  const vanity = html.match(/"vanityChannelUrl":"https?:\/\/www\.youtube\.com\/(@[^"]+)"/)?.[1];
  const subscribers =
    html.match(/"content":"([^"]{1,30}?\s(?:abone|subscribers?))"/i)?.[1] ??
    html.match(/"subscriberCountText":\{"simpleText":"([^"]+)"/)?.[1] ??
    null;

  return {
    id,
    name: name || 'YouTube kanalı',
    handle: vanity ? cleanHandle(safeDecodeURIComponent(vanity)) : null,
    avatar,
    subscribers,
  };
}

interface ChannelRenderer {
  channelId?: string;
  title?: { simpleText?: string; runs?: { text?: string }[] };
  navigationEndpoint?: { browseEndpoint?: { canonicalBaseUrl?: string } };
  subscriberCountText?: { simpleText?: string };
  videoCountText?: { simpleText?: string };
  thumbnail?: { thumbnails?: { url: string }[] };
}

/** Arama sonuç sayfasının ytInitialData'sından kanal kartlarını çıkarır. */
export function parseSearchResults(html: string, limit = 8): ChannelSearchResult[] {
  const data = extractJsonObject(html, 'var ytInitialData =');
  if (!data) return [];

  const results: ChannelSearchResult[] = [];
  for (const r of collectByKey<ChannelRenderer>(data, 'channelRenderer')) {
    const id = r.channelId ?? '';
    if (!isChannelId(id) || results.some((x) => x.id === id)) continue;

    const name = r.title?.simpleText ?? r.title?.runs?.map((x) => x.text ?? '').join('') ?? 'YouTube kanalı';
    const base = r.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl ?? '';
    // YouTube 2024'ten beri bu iki alanı karıştırıyor: kullanıcı adı subscriberCountText'te,
    // abone sayısı videoCountText'te gelebiliyor.
    const subText = r.subscriberCountText?.simpleText ?? '';
    const videoText = r.videoCountText?.simpleText ?? '';
    const handleRaw = base.startsWith('/@') ? base.slice(1) : subText.startsWith('@') ? subText : null;
    const subscribers = [subText, videoText].find((t) => t && !t.startsWith('@') && /abone|subscriber/i.test(t)) ?? null;

    const thumbs = r.thumbnail?.thumbnails ?? [];
    let avatar = thumbs.length > 0 ? thumbs[thumbs.length - 1].url : '';
    if (avatar.startsWith('//')) avatar = 'https:' + avatar;

    results.push({
      id,
      name,
      handle: handleRaw ? cleanHandle(safeDecodeURIComponent(handleRaw)) : '',
      avatar,
      subscribers,
    });
    if (results.length >= limit) break;
  }
  return results;
}

export interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
}

export interface VideoMeta {
  title: string | null;
  description: string | null;
  lengthSeconds: number | null;
  isUpcoming: boolean;
  isLiveNow: boolean;
  playable: boolean;
  captionTracks: CaptionTrack[];
}

interface PlayerResponse {
  playabilityStatus?: { status?: string };
  videoDetails?: {
    title?: string;
    shortDescription?: string;
    lengthSeconds?: string;
    isUpcoming?: boolean;
    isLive?: boolean;
  };
  microformat?: {
    playerMicroformatRenderer?: {
      liveBroadcastDetails?: { isLiveNow?: boolean };
    };
  };
  captions?: {
    playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] };
  };
}

/** İzleme sayfasındaki ytInitialPlayerResponse'tan video bilgilerini okur. */
export function parseWatchPage(html: string): VideoMeta | null {
  const player = extractJsonObject(html, 'var ytInitialPlayerResponse =') as PlayerResponse | null;
  if (!player) return null;

  const details = player.videoDetails ?? {};
  const length = parseInt(details.lengthSeconds ?? '', 10);
  const status = player.playabilityStatus?.status ?? 'UNKNOWN';
  return {
    title: details.title ?? null,
    description: details.shortDescription ?? null,
    lengthSeconds: Number.isFinite(length) && length > 0 ? length : null,
    isUpcoming: Boolean(details.isUpcoming) || status === 'LIVE_STREAM_OFFLINE',
    isLiveNow: Boolean(player.microformat?.playerMicroformatRenderer?.liveBroadcastDetails?.isLiveNow) || Boolean(details.isLive),
    playable: status === 'OK',
    captionTracks: (player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []).filter((t) => t?.baseUrl),
  };
}

/** Tercih edilen dile göre altyazı seçer: önce elle yazılmış, sonra otomatik. */
export function pickCaptionTrack(tracks: CaptionTrack[], preferred: string[]): CaptionTrack | null {
  for (const lang of preferred) {
    const manual = tracks.find((t) => t.languageCode.startsWith(lang) && t.kind !== 'asr');
    if (manual) return manual;
    const auto = tracks.find((t) => t.languageCode.startsWith(lang));
    if (auto) return auto;
  }
  return tracks[0] ?? null;
}

/** json3 biçimindeki altyazıyı düz metne çevirir. */
export function parseTranscriptJson3(body: string): string {
  try {
    const data = JSON.parse(body) as { events?: { segs?: { utf8?: string }[] }[] };
    return (data.events ?? [])
      .flatMap((e) => e.segs ?? [])
      .map((s) => s.utf8 ?? '')
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return '';
  }
}

/**
 * Açıklamadaki "00:00 Giriş" biçimli bölüm listesini çıkarır.
 * YouTube'un kuralına uygun olarak ilk bölüm 0:00'da başlamalı ve en az 3 bölüm olmalı.
 */
export function parseChapters(description: string): Chapter[] {
  if (!description) return [];
  const chapters: Chapter[] = [];
  for (const rawLine of description.split(/\r?\n/)) {
    const line = rawLine.trim();
    const m = line.match(/^[([]?((?:\d{1,2}:)?\d{1,2}:\d{2})[)\]]?\s*[-–—:|•·]?\s*(.+)$/);
    if (!m) continue;
    const seconds = timeToSeconds(m[1]);
    const label = m[2].trim();
    if (seconds === null || !label) continue;
    if (chapters.length > 0 && seconds <= chapters[chapters.length - 1].seconds) continue;
    chapters.push({ seconds, time: m[1], label: label.slice(0, 120) });
  }
  if (chapters.length < 3 || chapters[0].seconds !== 0) return [];
  return chapters.slice(0, 40);
}

function timeToSeconds(time: string): number | null {
  const parts = time.split(':').map((p) => parseInt(p, 10));
  if (parts.some((p) => !Number.isFinite(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

// ---------------------------------------------------------------------------
// Ağ çağrıları
// ---------------------------------------------------------------------------

interface FetchOptions {
  timeoutMs?: number;
  html?: boolean;
  method?: string;
  redirect?: RequestRedirect;
}

async function ytFetch(url: string, opts: FetchOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {
    'User-Agent': UA,
    'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
  };
  if (opts.html) headers['Cookie'] = CONSENT_COOKIE;
  return fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    redirect: opts.redirect ?? 'follow',
    signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
  });
}

async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  const res = await ytFetch(url, opts);
  if (!res.ok) throw new Error(`YouTube ${res.status} döndürdü`);
  return res.text();
}

export async function fetchChannelFeed(channelId: string): Promise<ParsedFeed> {
  if (!isChannelId(channelId)) throw new Error('Geçersiz kanal kimliği');
  const res = await ytFetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
  if (res.status === 404) throw new Error('Kanal bulunamadı (RSS 404)');
  if (!res.ok) throw new Error(`RSS beslemesi alınamadı (HTTP ${res.status})`);
  return parseFeed(await res.text());
}

export async function fetchChannelPage(path: string): Promise<ChannelPageInfo | null> {
  const html = await fetchText(`https://www.youtube.com/${path}?hl=tr`, { html: true });
  return parseChannelPage(html);
}

export async function searchChannels(query: string): Promise<ChannelSearchResult[]> {
  const q = encodeURIComponent(query.trim().slice(0, 100));
  // sp=EgIQAg%3D%3D: yalnızca kanal sonuçları
  const html = await fetchText(`https://www.youtube.com/results?search_query=${q}&sp=EgIQAg%253D%253D&hl=tr&gl=TR`, {
    html: true,
  });
  return parseSearchResults(html);
}

export async function fetchVideoMeta(videoId: string): Promise<VideoMeta | null> {
  if (!isVideoId(videoId)) return null;
  try {
    const html = await fetchText(`https://www.youtube.com/watch?v=${videoId}&hl=tr`, { html: true });
    return parseWatchPage(html);
  } catch {
    return null;
  }
}

export async function fetchTranscript(tracks: CaptionTrack[], preferred: string[]): Promise<string> {
  const track = pickCaptionTrack(tracks, preferred);
  if (!track) return '';
  try {
    const url = new URL(track.baseUrl);
    if (url.hostname !== 'www.youtube.com') return '';
    url.searchParams.set('fmt', 'json3');
    const body = await fetchText(url.toString(), { timeoutMs: 15_000 });
    return parseTranscriptJson3(body);
  } catch {
    return '';
  }
}

/**
 * /shorts/ID adresi Shorts videolarında 200, normal videolarda yönlendirme döner.
 * Belirsiz durumlarda false döner ki video yanlışlıkla atlanmasın.
 */
export async function checkIsShort(videoId: string): Promise<boolean> {
  if (!isVideoId(videoId)) return false;
  try {
    const res = await ytFetch(`https://www.youtube.com/shorts/${videoId}`, {
      method: 'HEAD',
      redirect: 'manual',
      html: true,
      timeoutMs: 8_000,
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

/** Yüksek çözünürlüklü kapak görseli varsa onu, yoksa hqdefault'u döner. */
export async function pickThumbnail(videoId: string): Promise<string> {
  const maxres = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
  try {
    const res = await fetch(maxres, { method: 'HEAD', signal: AbortSignal.timeout(5_000) });
    if (res.ok) return maxres;
  } catch {
    // hqdefault'a düş
  }
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

export function defaultThumbnail(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

export function videoUrl(videoId: string, seconds?: number): string {
  return `https://www.youtube.com/watch?v=${videoId}${seconds ? `&t=${seconds}s` : ''}`;
}
