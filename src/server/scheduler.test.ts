import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Tarama → kuyruk → işleme akışının uçtan uca testi. YouTube ağ çağrıları
 * sahte fetch ile taklit edilir; Gemini anahtarı ve e-posta ayarı yoktur.
 */

const CH = 'UCsBjURrPoezykLs9EqgamOA';

interface FakeEntry {
  id: string;
  title: string;
  published: string;
  short?: boolean;
}

let entries: FakeEntry[] = [];

function feedXml(): string {
  const items = entries
    .map(
      (e) => `<entry><yt:videoId>${e.id}</yt:videoId><title>${e.title}</title>
      <link rel="alternate" href="https://www.youtube.com/${e.short ? 'shorts/' : 'watch?v='}${e.id}"/>
      <published>${e.published}</published><media:group><media:description>Açıklama ${e.id}</media:description></media:group></entry>`,
    )
    .join('');
  return `<feed><yt:channelId>${CH}</yt:channelId><title>Fireship</title><author><name>Fireship</name></author>
    <published>2015-01-01T00:00:00+00:00</published>${items}</feed>`;
}

const fakeFetch = vi.fn(async (input: string | URL) => {
  const url = String(input);
  if (url.includes('/feeds/videos.xml')) return new Response(feedXml(), { status: 200 });
  if (url.includes('/channel/') || url.includes('/@')) {
    return new Response(
      `<link rel="canonical" href="https://www.youtube.com/channel/${CH}"><meta property="og:title" content="Fireship"><meta property="og:image" content="https://yt3.example/a.jpg">`,
    );
  }
  if (url.includes('/shorts/')) return new Response(null, { status: 303 });
  if (url.includes('maxresdefault')) return new Response(null, { status: 200 });
  return new Response('not found', { status: 404 });
});

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

type Scheduler = typeof import('./scheduler');
type StoreModule = typeof import('./store');
let scheduler: Scheduler;
let storeModule: StoreModule;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ozetci-test-'));
  // Proje klasöründeki eski automation-state.json taşınmasın diye boş bir klasörde çalış
  process.chdir(dir);
  process.env['DATA_DIR'] = join(dir, 'data');
  delete process.env['GEMINI_API_KEY'];
  delete process.env['SENDER_EMAIL'];
  delete process.env['EMAIL_APP_PASSWORD'];
  delete process.env['RECEIVER_EMAIL'];
  vi.stubGlobal('fetch', fakeFetch);
  scheduler = await import('./scheduler');
  storeModule = await import('./store');
});

afterAll(() => {
  vi.unstubAllGlobals();
});

async function scanAndDrain(): Promise<void> {
  await scheduler.runScan('manual');
  await vi.waitFor(async () => {
    await scheduler.drainQueue();
    const busy = storeModule.getStore().digests.some((d) => d.status === 'processing' || (d.status === 'queued' && !d.nextAttemptAt));
    expect(busy).toBe(false);
  });
}

describe('zamanlayıcı', () => {
  it('kanal eklerken mevcut videoları görüldü sayar, e-posta üretmez', async () => {
    entries = [
      { id: 'vid00000002', title: 'İkinci', published: minutesAgo(60) },
      { id: 'vid00000001', title: 'Birinci', published: minutesAgo(600) },
    ];
    const ch = await scheduler.addChannel({ id: CH }, false);
    expect(ch.name).toBe('Fireship');
    expect(ch.lastVideo?.id).toBe('vid00000002');

    await scanAndDrain();
    expect(storeModule.getStore().digests).toHaveLength(0);
  });

  it('aynı kanalı iki kez eklemez', async () => {
    await expect(scheduler.addChannel({ input: '@Fireship' }, false)).rejects.toThrow(/zaten/);
  });

  it('yeni videoyu kuyruğa alır ve özetsiz de olsa işler', async () => {
    entries.unshift({ id: 'vid00000003', title: 'Yeni video', published: minutesAgo(2) });
    await scanAndDrain();

    const d = storeModule.getStore().findDigest('vid00000003');
    expect(d).toBeDefined();
    expect(d!.status).toBe('ready');
    expect(d!.statusNote).toMatch(/E-posta ayarları eksik/);
    expect(d!.summary?.basis).toBe('none');
    expect(d!.summary?.paragraphs).toEqual(['Açıklama vid00000003']);
    expect(d!.thumbnail).toContain('maxresdefault');
  });

  it('son video silinince eski videoyu yeni sanmaz', async () => {
    entries.shift();
    await scanAndDrain();
    expect(storeModule.getStore().digests).toHaveLength(1);
  });

  it('kanal eklenmeden önce yayınlanmış ama listede ilk kez görünen videoyu bildirmez', async () => {
    entries.push({ id: 'vid00000000', title: 'Eski', published: minutesAgo(60 * 24 * 30) });
    await scanAndDrain();
    expect(storeModule.getStore().findDigest('vid00000000')).toBeUndefined();
  });

  it('Shorts videolarını ayara göre atlar', async () => {
    entries.unshift({ id: 'short000001', title: 'Kısa', published: minutesAgo(1), short: true });
    await scanAndDrain();
    expect(storeModule.getStore().findDigest('short000001')?.status).toBe('skipped');
  });

  it('e-posta gönderilemezse tekrar denemek üzere kuyruğa geri koyar', async () => {
    storeModule.getStore().updateSettings({
      email: { senderEmail: 'ben@example.com', appPassword: 'abcdabcdabcdabcd', receiverEmails: ['ben@example.com'], smtpHost: '127.0.0.1', smtpPort: 1 },
    });
    entries.unshift({ id: 'vid00000004', title: 'Dördüncü', published: minutesAgo(1) });
    await scanAndDrain();

    const d = storeModule.getStore().findDigest('vid00000004')!;
    expect(d.status).toBe('queued');
    expect(d.attempts).toBe(1);
    expect(d.nextAttemptAt).not.toBeNull();
    expect(d.statusNote).toMatch(/tekrar denenecek/);
    // Özet bir kez üretildi, tekrar denemede yeniden üretilmeyecek
    expect(d.summary).not.toBeNull();
  });

  it('ayarlar uygulama şifresini dışarı vermez', () => {
    const pub = storeModule.getStore().publicSettings();
    expect(JSON.stringify(pub)).not.toContain('abcdabcdabcdabcd');
    expect(pub.email.hasAppPassword).toBe(true);
  });

  it('geçersiz e-posta adreslerini reddeder', () => {
    expect(() => storeModule.getStore().updateSettings({ email: { senderEmail: 'a@b.com\nBcc: x@y.com' } })).toThrow();
    storeModule.getStore().updateSettings({ email: { receiverEmails: ['ok@example.com', 'bozuk', 'x@y.com\r\nBcc: z@z.com'] } });
    expect(storeModule.getStore().email.receiverEmails).toEqual(['ok@example.com']);
  });
});
