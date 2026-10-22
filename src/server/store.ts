import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  Channel,
  Digest,
  LogEntry,
  LogLevel,
  PublicSettings,
  SettingsUpdate,
  SummaryLanguage,
  SummaryLength,
} from '../shared/types';
import { isChannelId, isVideoId } from './youtube';

/**
 * Kalıcı durum: ayarlar, kanallar, özet geçmişi ve günlük.
 * Tek bir JSON dosyasında tutulur ve her yazımda önce geçici dosyaya yazılıp
 * yeniden adlandırılır; böylece yazım yarıda kesilirse dosya bozulmaz.
 */

export interface StoredChannel extends Channel {
  seenIds: string[];
}

interface StoredSettings {
  email: {
    senderEmail: string;
    receiverEmails: string[];
    smtpHost: string;
    smtpPort: number;
    appPassword: string;
  };
  scan: PublicSettings['scan'];
  summary: PublicSettings['summary'];
}

interface StoredState {
  version: 2;
  settings: StoredSettings;
  channels: StoredChannel[];
  digests: Digest[];
  logs: LogEntry[];
  stats: { totalScans: number; totalEmails: number; lastScanAt: string | null };
  secrets: { cronKey: string };
  savedAt: string;
}

export const MAX_DIGESTS = 200;
const MAX_LOGS = 150;
const MAX_SEEN_IDS = 60;
export const INTERVAL_OPTIONS = [5, 10, 15, 30, 60];

const dataDir = process.env['DATA_DIR'] || join(process.cwd(), 'data');
const stateFile = join(dataDir, 'state.json');
const legacyStateFile = join(process.cwd(), 'automation-state.json');

function env(name: string): string {
  return (process.env[name] ?? '').trim();
}

function defaultState(): StoredState {
  return {
    version: 2,
    settings: {
      email: { senderEmail: '', receiverEmails: [], smtpHost: '', smtpPort: 0, appPassword: '' },
      scan: { enabled: true, intervalMinutes: clampInterval(Number(env('CHECK_INTERVAL_MINUTES')) || 5), skipShorts: true },
      summary: { language: 'tr', length: 'medium', watchVideo: true },
    },
    channels: [],
    digests: [],
    logs: [],
    stats: { totalScans: 0, totalEmails: 0, lastScanAt: null },
    secrets: { cronKey: randomBytes(18).toString('base64url') },
    savedAt: new Date().toISOString(),
  };
}

export function clampInterval(minutes: number): number {
  if (!Number.isFinite(minutes)) return 5;
  return INTERVAL_OPTIONS.reduce((best, opt) => (Math.abs(opt - minutes) < Math.abs(best - minutes) ? opt : best), 5);
}

function normalizeEmails(list: unknown): string[] {
  const raw = Array.isArray(list) ? list : typeof list === 'string' ? list.split(/[,;\s]+/) : [];
  const out: string[] = [];
  for (const item of raw) {
    const email = String(item).trim().toLowerCase();
    if (isValidEmail(email) && !out.includes(email)) out.push(email);
  }
  return out.slice(0, 10);
}

export function isValidEmail(email: string): boolean {
  // Satır sonu içeren adresler e-posta başlığı enjeksiyonuna yol açabilir.
  return email.length <= 254 && /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(email);
}

function loadFromDisk(): StoredState {
  if (existsSync(stateFile)) {
    try {
      const parsed = JSON.parse(readFileSync(stateFile, 'utf-8')) as Partial<StoredState>;
      return mergeWithDefaults(parsed);
    } catch (err) {
      console.error('[store] state.json okunamadı, yedeği alınıp sıfırdan başlanıyor:', err);
      try {
        renameSync(stateFile, `${stateFile}.bozuk-${Date.now()}`);
      } catch {
        // yok say
      }
    }
  }
  const migrated = migrateLegacyState();
  return migrated ?? defaultState();
}

function mergeWithDefaults(parsed: Partial<StoredState>): StoredState {
  const base = defaultState();
  const s = parsed.settings;
  return {
    version: 2,
    settings: {
      email: { ...base.settings.email, ...(s?.email ?? {}) },
      scan: { ...base.settings.scan, ...(s?.scan ?? {}) },
      summary: { ...base.settings.summary, ...(s?.summary ?? {}) },
    },
    channels: Array.isArray(parsed.channels) ? parsed.channels.filter((c) => c && isChannelId(c.id)) : [],
    digests: Array.isArray(parsed.digests) ? parsed.digests.filter((d) => d && isVideoId(d.id)) : [],
    logs: Array.isArray(parsed.logs) ? parsed.logs : [],
    stats: { ...base.stats, ...(parsed.stats ?? {}) },
    secrets: parsed.secrets?.cronKey ? parsed.secrets : base.secrets,
    savedAt: parsed.savedAt ?? base.savedAt,
  };
}

/** Eski sürümün automation-state.json dosyasındaki kanalları yeni biçime taşır. */
function migrateLegacyState(): StoredState | null {
  if (!existsSync(legacyStateFile)) return null;
  try {
    const legacy = JSON.parse(readFileSync(legacyStateFile, 'utf-8')) as {
      autoPilotEnabled?: boolean;
      totalScans?: number;
      totalAutoEmailsSent?: number;
      channels?: {
        id?: string;
        name?: string;
        handle?: string;
        avatar?: string;
        subscriberCount?: string;
        lastVideoId?: string;
        lastVideoTitle?: string;
      }[];
    };
    const state = defaultState();
    const now = new Date().toISOString();
    for (const c of legacy.channels ?? []) {
      if (!c.id || !isChannelId(c.id) || state.channels.some((x) => x.id === c.id)) continue;
      const lastId = c.lastVideoId && isVideoId(c.lastVideoId) ? c.lastVideoId : null;
      state.channels.push({
        id: c.id,
        name: c.name || 'YouTube kanalı',
        handle: c.handle || '',
        avatar: c.avatar || '',
        subscribers: c.subscriberCount && c.subscriberCount.length < 30 ? c.subscriberCount : null,
        addedAt: now,
        paused: false,
        lastVideo: lastId ? { id: lastId, title: c.lastVideoTitle || '', publishedAt: now } : null,
        lastCheckedAt: null,
        lastError: null,
        // İlk taramada mevcut videolar "görüldü" sayılacak (addedAt kuralı), tekrar mail gitmez.
        seenIds: lastId ? [lastId] : [],
      });
    }
    state.settings.scan.enabled = legacy.autoPilotEnabled ?? true;
    state.stats.totalScans = legacy.totalScans ?? 0;
    state.stats.totalEmails = legacy.totalAutoEmailsSent ?? 0;
    state.logs.unshift({
      id: newId(),
      at: now,
      level: 'info',
      message: `Eski sürümden ${state.channels.length} kanal aktarıldı.`,
    });
    console.log(`[store] automation-state.json'dan ${state.channels.length} kanal taşındı.`);
    return state;
  } catch (err) {
    console.error('[store] Eski durum dosyası taşınamadı:', err);
    return null;
  }
}

/** Görülen video listesi iç ayrıntı; arayüze gönderilmez. */
export function toPublicChannel(channel: StoredChannel): Channel {
  const copy: Partial<StoredChannel> = { ...channel };
  delete copy.seenIds;
  return copy as Channel;
}

export function newId(): string {
  return `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
}

class Store {
  private state: StoredState = loadFromDisk();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.flush();
  }

  // ---- kalıcılık -------------------------------------------------------

  save(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, 250);
  }

  flush(): void {
    try {
      mkdirSync(dirname(stateFile), { recursive: true });
      this.state.savedAt = new Date().toISOString();
      const tmp = `${stateFile}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.state, null, 2), { encoding: 'utf-8', mode: 0o600 });
      renameSync(tmp, stateFile);
    } catch (err) {
      console.error('[store] Durum kaydedilemedi:', err);
    }
  }

  // ---- ayarlar ---------------------------------------------------------

  /** Arayüzden kaydedilen değer öncelikli, yoksa ortam değişkeni kullanılır. */
  get email() {
    const e = this.state.settings.email;
    const envReceivers = normalizeEmails(env('RECEIVER_EMAIL'));
    return {
      senderEmail: e.senderEmail || env('SENDER_EMAIL'),
      receiverEmails: e.receiverEmails.length > 0 ? e.receiverEmails : envReceivers,
      smtpHost: e.smtpHost || env('SMTP_HOST') || env('SMTP_SERVER') || 'smtp.gmail.com',
      smtpPort: e.smtpPort || Number(env('SMTP_PORT')) || 587,
      appPassword: e.appPassword || env('EMAIL_APP_PASSWORD'),
    };
  }

  get scan() {
    return this.state.settings.scan;
  }

  get summarySettings() {
    return this.state.settings.summary;
  }

  get cronKey(): string {
    return env('CRON_SECRET') || this.state.secrets.cronKey;
  }

  publicSettings(): PublicSettings {
    const e = this.email;
    return {
      email: {
        senderEmail: e.senderEmail,
        receiverEmails: e.receiverEmails,
        smtpHost: e.smtpHost,
        smtpPort: e.smtpPort,
        hasAppPassword: Boolean(e.appPassword),
      },
      scan: { ...this.state.settings.scan },
      summary: { ...this.state.settings.summary },
    };
  }

  updateSettings(update: SettingsUpdate): void {
    const s = this.state.settings;
    if (update.email) {
      const u = update.email;
      if (typeof u.senderEmail === 'string') {
        const v = u.senderEmail.trim().toLowerCase();
        if (v && !isValidEmail(v)) throw new Error('Gönderen e-posta adresi geçersiz.');
        s.email.senderEmail = v;
      }
      if (u.receiverEmails !== undefined) s.email.receiverEmails = normalizeEmails(u.receiverEmails);
      if (typeof u.smtpHost === 'string') {
        const host = u.smtpHost.trim();
        if (host && !/^[a-z0-9.-]+$/i.test(host)) throw new Error('SMTP sunucusu geçersiz.');
        s.email.smtpHost = host;
      }
      if (u.smtpPort !== undefined) {
        const port = Number(u.smtpPort);
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SMTP portu geçersiz.');
        s.email.smtpPort = port;
      }
      if (typeof u.appPassword === 'string' && u.appPassword.trim()) {
        s.email.appPassword = u.appPassword.replace(/\s+/g, '');
      }
    }
    if (update.scan) {
      const u = update.scan;
      if (typeof u.enabled === 'boolean') s.scan.enabled = u.enabled;
      if (u.intervalMinutes !== undefined) s.scan.intervalMinutes = clampInterval(Number(u.intervalMinutes));
      if (typeof u.skipShorts === 'boolean') s.scan.skipShorts = u.skipShorts;
    }
    if (update.summary) {
      const u = update.summary;
      if (u.language && (['tr', 'en'] as SummaryLanguage[]).includes(u.language)) s.summary.language = u.language;
      if (u.length && (['short', 'medium', 'long'] as SummaryLength[]).includes(u.length)) s.summary.length = u.length;
      if (typeof u.watchVideo === 'boolean') s.summary.watchVideo = u.watchVideo;
    }
    this.save();
  }

  // ---- kanallar --------------------------------------------------------

  get channels(): StoredChannel[] {
    return this.state.channels;
  }

  findChannel(id: string): StoredChannel | undefined {
    return this.state.channels.find((c) => c.id === id);
  }

  addChannel(channel: StoredChannel): void {
    this.state.channels.push(channel);
    this.save();
  }

  removeChannel(id: string): boolean {
    const before = this.state.channels.length;
    this.state.channels = this.state.channels.filter((c) => c.id !== id);
    this.save();
    return this.state.channels.length !== before;
  }

  markSeen(channel: StoredChannel, videoIds: string[]): void {
    const merged = [...videoIds.filter((id) => !channel.seenIds.includes(id)), ...channel.seenIds];
    channel.seenIds = merged.slice(0, MAX_SEEN_IDS);
  }

  publicChannels(): Channel[] {
    return this.state.channels.map(toPublicChannel);
  }

  // ---- özetler ---------------------------------------------------------

  get digests(): Digest[] {
    return this.state.digests;
  }

  findDigest(id: string): Digest | undefined {
    return this.state.digests.find((d) => d.id === id);
  }

  addDigest(digest: Digest): void {
    this.state.digests.unshift(digest);
    this.state.digests.sort(
      (a, b) => b.detectedAt.localeCompare(a.detectedAt) || b.publishedAt.localeCompare(a.publishedAt),
    );
    if (this.state.digests.length > MAX_DIGESTS) {
      // Bekleyen işleri silme, yalnızca eski tamamlanmışları at
      const keep = this.state.digests.filter(
        (d, i) => i < MAX_DIGESTS || d.status === 'queued' || d.status === 'waiting' || d.status === 'processing',
      );
      this.state.digests = keep;
    }
    this.save();
  }

  removeDigest(id: string): boolean {
    const before = this.state.digests.length;
    this.state.digests = this.state.digests.filter((d) => d.id !== id);
    this.save();
    return before !== this.state.digests.length;
  }

  // ---- günlük & istatistik --------------------------------------------

  log(level: LogLevel, message: string): void {
    this.state.logs.unshift({ id: newId(), at: new Date().toISOString(), level, message });
    if (this.state.logs.length > MAX_LOGS) this.state.logs.length = MAX_LOGS;
    if (level === 'error') console.error(`[ozetci] ${message}`);
    else console.log(`[ozetci] ${message}`);
    this.save();
  }

  get logs(): LogEntry[] {
    return this.state.logs;
  }

  get stats() {
    return this.state.stats;
  }
}

let instance: Store | null = null;

/** Durum ilk kullanıldığında yüklenir; derleme sırasında dosya sistemine dokunulmaz. */
export function getStore(): Store {
  if (!instance) instance = new Store();
  return instance;
}

export type { Store };
