/**
 * Sunucu ve arayüz arasında paylaşılan veri tipleri.
 * Bu dosya hem Angular tarafında hem de Express sunucusunda import edilir,
 * bu yüzden içinde yalnızca tip tanımları bulunmalı.
 */

export interface VideoRef {
  id: string;
  title: string;
  publishedAt: string; // ISO
}

export interface Channel {
  id: string; // UC... kanal kimliği
  name: string;
  handle: string; // @kullaniciadi
  avatar: string;
  subscribers: string | null; // YouTube'un gösterdiği metin, ör. "4,29 Mn abone"
  addedAt: string; // ISO
  paused: boolean;
  lastVideo: VideoRef | null;
  lastCheckedAt: string | null;
  lastError: string | null;
}

export type DigestStatus =
  | 'queued' // sırada, işlenecek
  | 'processing' // özetleniyor / gönderiliyor
  | 'waiting' // canlı yayın ya da prömiyer bitince işlenecek
  | 'sent' // özet e-postayla gönderildi
  | 'ready' // özet hazır, e-posta gönderilmedi (manuel ya da e-posta ayarlı değil)
  | 'failed' // denemeler tükendi
  | 'skipped'; // Shorts vb. nedeniyle atlandı

export type SummaryBasis = 'video' | 'transcript' | 'description' | 'none';

export interface Chapter {
  seconds: number;
  time: string; // "12:34"
  label: string;
}

export interface Summary {
  tldr: string;
  paragraphs: string[];
  keyPoints: string[];
  chapters: Chapter[];
  basis: SummaryBasis;
  model: string | null;
  generatedAt: string;
}

export interface Digest {
  id: string; // video kimliği
  channelId: string;
  channelName: string;
  channelAvatar: string;
  title: string;
  url: string;
  thumbnail: string;
  publishedAt: string;
  detectedAt: string;
  durationSeconds: number | null;
  source: 'auto' | 'manual';
  status: DigestStatus;
  statusNote: string | null;
  attempts: number;
  nextAttemptAt: string | null;
  summary: Summary | null;
  emailedAt: string | null;
  wantsEmail: boolean;
}

export type LogLevel = 'info' | 'success' | 'warn' | 'error';

export interface LogEntry {
  id: string;
  at: string;
  level: LogLevel;
  message: string;
}

export type SummaryLength = 'short' | 'medium' | 'long';
export type SummaryLanguage = 'tr' | 'en';

export interface PublicSettings {
  email: {
    senderEmail: string;
    receiverEmails: string[];
    smtpHost: string;
    smtpPort: number;
    hasAppPassword: boolean;
  };
  scan: {
    enabled: boolean;
    intervalMinutes: number;
    skipShorts: boolean;
  };
  summary: {
    language: SummaryLanguage;
    length: SummaryLength;
    watchVideo: boolean;
  };
}

export interface SettingsUpdate {
  email?: {
    senderEmail?: string;
    receiverEmails?: string[];
    smtpHost?: string;
    smtpPort?: number;
    appPassword?: string; // yalnızca yazılır, asla geri okunmaz
  };
  scan?: Partial<PublicSettings['scan']>;
  summary?: Partial<PublicSettings['summary']>;
}

export interface SetupStatus {
  gemini: boolean;
  email: boolean;
  channels: boolean;
  auth: boolean;
}

export interface AutomationStatus {
  enabled: boolean;
  intervalMinutes: number;
  scanning: boolean;
  processing: boolean;
  lastScanAt: string | null;
  nextScanAt: string | null;
  totalScans: number;
  totalEmails: number;
  serverTime: string;
  setup: SetupStatus;
  cronPath: string;
  appUrl: string | null;
}

export interface AppState {
  status: AutomationStatus;
  settings: PublicSettings;
  channels: Channel[];
  digests: Digest[];
  logs: LogEntry[];
}

export interface ChannelSearchResult {
  id: string;
  name: string;
  handle: string;
  avatar: string;
  subscribers: string | null;
}

export interface ChannelCandidate {
  id?: string;
  input?: string;
  name?: string;
  handle?: string;
  avatar?: string;
  subscribers?: string | null;
}

export interface BulkAddResult {
  added: Channel[];
  skipped: { input: string; reason: string }[];
}

export interface SessionInfo {
  authRequired: boolean;
  authenticated: boolean;
}
