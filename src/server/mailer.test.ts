import { describe, expect, it } from 'vitest';
import type { Digest, Summary } from '../shared/types';
import { describeSmtpError, escapeHtml, renderDigestEmail } from './mailer';

function digest(patch: Partial<Digest> = {}): Digest {
  return {
    id: 'idz35UHLc20',
    channelId: 'UCWpk9PSGHoJW1hZT4egxTNQ',
    channelName: 'Ruhi Cenet',
    channelAvatar: '',
    title: 'SİZE "ÇOK ÖNEMLİ" BİR MESAJIM VAR!',
    url: 'https://www.youtube.com/watch?v=idz35UHLc20',
    thumbnail: 'https://i.ytimg.com/vi/idz35UHLc20/hqdefault.jpg',
    publishedAt: '2026-10-20T15:00:00.000Z',
    detectedAt: '2026-10-20T15:03:00.000Z',
    durationSeconds: 754,
    source: 'auto',
    status: 'queued',
    statusNote: null,
    attempts: 0,
    nextAttemptAt: null,
    summary: null,
    emailedAt: null,
    wantsEmail: true,
    ...patch,
  };
}

const summary: Summary = {
  tldr: 'Kısa <b>öz</b>',
  paragraphs: ['Birinci paragraf <script>alert(1)</script>'],
  keyPoints: ['Madde & detay'],
  chapters: [{ seconds: 54, time: '00:54', label: 'Bölüm "iki"' }],
  basis: 'video',
  model: 'gemini-flash-latest',
  generatedAt: '2026-10-20T15:04:00.000Z',
};

describe('renderDigestEmail', () => {
  it('tırnak içeren başlıklar HTML niteliklerini bozmaz', () => {
    const { html } = renderDigestEmail(digest(), summary);
    expect(html).toContain('alt="SİZE &quot;ÇOK ÖNEMLİ&quot; BİR MESAJIM VAR!"');
    expect(html).not.toContain('alt="SİZE "ÇOK');
  });

  it('özet içeriğini kaçışlar', () => {
    const { html } = renderDigestEmail(digest(), summary);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('Kısa &lt;b&gt;öz&lt;/b&gt;');
    expect(html).toContain('Madde &amp; detay');
  });

  it('bölümleri zaman damgalı linke çevirir', () => {
    const { html, text } = renderDigestEmail(digest(), summary);
    expect(html).toContain('watch?v=idz35UHLc20&amp;t=54s');
    expect(text).toContain('00:54 Bölüm "iki"');
  });

  it('özet yoksa sahte içerik üretmez', () => {
    const { html } = renderDigestEmail(digest(), null);
    expect(html).toContain('özet oluşturulamadı');
    expect(html).not.toContain('Öne çıkanlar');
  });

  it('konu satırına satır sonu sızmaz', () => {
    const { subject } = renderDigestEmail(digest({ title: 'Satır\r\nBcc: kurban@example.com' }), summary);
    expect(subject).not.toMatch(/[\r\n]/);
  });
});

describe('escapeHtml', () => {
  it('beş özel karakteri kaçışlar', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});

describe('describeSmtpError', () => {
  it('Gmail kimlik hatasını açıklar', () => {
    expect(describeSmtpError({ code: 'EAUTH', message: '535-5.7.8 Username and Password not accepted' })).toMatch(/Uygulama şifresi/);
  });
});
