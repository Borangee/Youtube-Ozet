import nodemailer from 'nodemailer';
import type { Digest, Summary, SummaryBasis } from '../shared/types';
import { getStore } from './store';
import { videoUrl } from './youtube';

/**
 * E-posta şablonu ve gönderimi.
 *
 * Şablondaki her dinamik değer escapeHtml'den geçer. Eski sürümde video
 * başlığı doğrudan HTML'e yazılıyordu; başlığında tırnak işareti olan videolar
 * (ör. SİZE "ÇOK ÖNEMLİ" BİR MESAJIM VAR!) alt="..." niteliğini bozuyordu.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Satır sonlarını temizler; e-posta başlıklarına kullanıcı verisi girerken gerekli. */
function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
}

const BASIS_LABEL: Record<SummaryBasis, string> = {
  video: 'videonun kendisi izlenerek',
  transcript: 'videonun altyazısından',
  description: 'video açıklamasından',
  none: '',
};

function formatDuration(seconds: number | null): string {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('tr-TR', {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: process.env['TZ'] || 'Europe/Istanbul',
    });
  } catch {
    return '';
  }
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderDigestEmail(digest: Digest, summary: Summary | null): RenderedEmail {
  const url = digest.url || videoUrl(digest.id);
  const meta = [formatDate(digest.publishedAt), formatDuration(digest.durationSeconds)].filter(Boolean).join(' · ');
  const s = summary;
  const hasAi = Boolean(s && s.basis !== 'none');

  const font = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;
  const p = (text: string) =>
    `<p style="margin:0 0 14px;font:15px/1.65 ${font};color:#27272a;">${escapeHtml(text)}</p>`;

  const tldrBlock =
    s && s.tldr
      ? `<tr><td style="padding:0 28px 8px;">
          <div style="background:#fff5f5;border:1px solid #fde2e2;border-radius:12px;padding:14px 16px;">
            <div style="font:600 11px/1 ${font};letter-spacing:.08em;text-transform:uppercase;color:#b42318;margin-bottom:8px;">Kısaca</div>
            <div style="font:500 15px/1.55 ${font};color:#18181b;">${escapeHtml(s.tldr)}</div>
          </div>
        </td></tr>`
      : '';

  const bodyBlock =
    s && s.paragraphs.length > 0
      ? `<tr><td style="padding:16px 28px 2px;">${s.paragraphs.map(p).join('')}</td></tr>`
      : `<tr><td style="padding:16px 28px 2px;">${p('Bu video için özet oluşturulamadı. Videoyu YouTube\'da izleyebilirsin.')}</td></tr>`;

  const pointsBlock =
    s && s.keyPoints.length > 0
      ? `<tr><td style="padding:4px 28px 8px;">
          <div style="font:600 13px/1 ${font};color:#18181b;margin:0 0 10px;">Öne çıkanlar</div>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            ${s.keyPoints
              .map(
                (k) => `<tr>
                  <td valign="top" style="width:18px;padding:3px 0;font:15px/1.6 ${font};color:#e5484d;">•</td>
                  <td style="padding:3px 0;font:15px/1.6 ${font};color:#27272a;">${escapeHtml(k)}</td>
                </tr>`,
              )
              .join('')}
          </table>
        </td></tr>`
      : '';

  const chaptersBlock =
    s && s.chapters.length > 0
      ? `<tr><td style="padding:12px 28px 8px;">
          <div style="font:600 13px/1 ${font};color:#18181b;margin:0 0 10px;">Bölümler</div>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            ${s.chapters
              .map(
                (c) => `<tr>
                  <td valign="top" style="width:64px;padding:3px 0;font:500 13px/1.6 ui-monospace,Menlo,Consolas,monospace;">
                    <a href="${escapeHtml(videoUrl(digest.id, c.seconds))}" style="color:#b42318;text-decoration:none;">${escapeHtml(c.time)}</a>
                  </td>
                  <td style="padding:3px 0;font:14px/1.6 ${font};color:#3f3f46;">${escapeHtml(c.label)}</td>
                </tr>`,
              )
              .join('')}
          </table>
        </td></tr>`
      : '';

  const footerNote = hasAi
    ? `Bu özet ${BASIS_LABEL[s!.basis]} Gemini ile hazırlandı. Yapay zekâ hata yapabilir.`
    : 'Gemini özeti oluşturulamadığı için yalnızca video bilgisi gönderildi.';

  const html = `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<title>${escapeHtml(digest.title)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml((s?.tldr || digest.title).slice(0, 140))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5;">
<tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4e4e7;">
  <tr><td style="padding:20px 28px 16px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      ${
        digest.channelAvatar
          ? `<td style="padding-right:10px;"><img src="${escapeHtml(digest.channelAvatar)}" width="32" height="32" alt="" style="display:block;border-radius:50%;border:0;"></td>`
          : ''
      }
      <td style="font:600 14px/1.3 ${font};color:#18181b;">${escapeHtml(digest.channelName)}
        <div style="font:400 12px/1.4 ${font};color:#71717a;">yeni video yükledi</div>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:0 28px;">
    <a href="${escapeHtml(url)}" style="display:block;text-decoration:none;">
      <img src="${escapeHtml(digest.thumbnail)}" width="544" alt="${escapeHtml(digest.title)}" style="display:block;width:100%;max-width:544px;height:auto;border-radius:12px;border:0;font:14px/1.4 ${font};color:#71717a;">
    </a>
  </td></tr>
  <tr><td style="padding:18px 28px 6px;">
    <a href="${escapeHtml(url)}" style="font:700 20px/1.35 ${font};color:#09090b;text-decoration:none;">${escapeHtml(digest.title)}</a>
    ${meta ? `<div style="font:13px/1.5 ${font};color:#71717a;margin-top:6px;">${escapeHtml(meta)}</div>` : ''}
  </td></tr>
  <tr><td style="padding:12px 28px 18px;">
    <a href="${escapeHtml(url)}" style="display:inline-block;background:#e5484d;color:#ffffff;font:600 14px/1 ${font};padding:12px 18px;border-radius:10px;text-decoration:none;">YouTube'da izle</a>
  </td></tr>
  ${tldrBlock}
  ${bodyBlock}
  ${pointsBlock}
  ${chaptersBlock}
  <tr><td style="padding:16px 28px 22px;border-top:1px solid #f4f4f5;font:12px/1.5 ${font};color:#a1a1aa;">
    ${escapeHtml(footerNote)}
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const textParts = [`${digest.channelName} yeni video yükledi`, digest.title, url, ''];
  if (s?.tldr) textParts.push(`Kısaca: ${s.tldr}`, '');
  if (s) textParts.push(...s.paragraphs.flatMap((x) => [x, '']));
  if (s && s.keyPoints.length > 0) textParts.push('Öne çıkanlar:', ...s.keyPoints.map((k) => `• ${k}`), '');
  if (s && s.chapters.length > 0) textParts.push('Bölümler:', ...s.chapters.map((c) => `${c.time} ${c.label}`), '');
  textParts.push(footerNote);

  return {
    subject: headerSafe(`${digest.channelName}: ${digest.title}`),
    html,
    text: textParts.join('\n'),
  };
}

export function isEmailConfigured(): boolean {
  const e = getStore().email;
  return Boolean(e.senderEmail && e.appPassword && e.receiverEmails.length > 0);
}

function createTransport() {
  const e = getStore().email;
  const secure = e.smtpPort === 465;
  return nodemailer.createTransport({
    host: e.smtpHost,
    port: e.smtpPort,
    secure,
    requireTLS: !secure,
    auth: { user: e.senderEmail, pass: e.appPassword },
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });
}

export async function sendEmail(mail: RenderedEmail): Promise<void> {
  if (!isEmailConfigured()) throw new Error('E-posta ayarları eksik.');
  const e = getStore().email;
  const transport = createTransport();
  try {
    await transport.sendMail({
      from: { name: 'Özetçi', address: e.senderEmail },
      to: e.receiverEmails,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
  } catch (err) {
    throw new Error(describeSmtpError(err));
  } finally {
    transport.close();
  }
}

export async function sendTestEmail(): Promise<void> {
  const e = getStore().email;
  const font = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;
  await sendEmail({
    subject: 'Özetçi: e-posta ayarların çalışıyor',
    text: `E-posta ayarların doğru. Takip ettiğin kanallar yeni video yüklediğinde özetler ${e.receiverEmails.join(', ')} adresine gelecek.`,
    html: `<!doctype html><html lang="tr"><body style="margin:0;padding:28px 12px;background:#f4f4f5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#fff;border:1px solid #e4e4e7;border-radius:16px;">
<tr><td style="padding:28px;">
<div style="font:700 18px/1.4 ${font};color:#09090b;margin-bottom:8px;">E-posta ayarların çalışıyor</div>
<div style="font:15px/1.6 ${font};color:#3f3f46;">Takip ettiğin kanallar yeni video yüklediğinde özetler bu adrese gelecek.</div>
<div style="font:12px/1.6 ${font};color:#a1a1aa;margin-top:18px;">Gönderen: ${escapeHtml(e.senderEmail)}<br>Alıcı: ${escapeHtml(e.receiverEmails.join(', '))}</div>
</td></tr></table></td></tr></table></body></html>`,
  });
}

/** Sık görülen SMTP hatalarını anlaşılır Türkçe mesaja çevirir. */
export function describeSmtpError(err: unknown): string {
  const e = err as { code?: string; responseCode?: number; message?: string };
  const msg = e?.message ?? String(err);
  if (e?.code === 'EAUTH' || e?.responseCode === 535 || /Username and Password not accepted|BadCredentials/i.test(msg)) {
    return 'Gmail giriş bilgileri reddedildi. Normal şifre değil, 16 haneli "Uygulama şifresi" kullanmalısın.';
  }
  if (e?.code === 'ETIMEDOUT' || e?.code === 'ECONNECTION' || e?.code === 'ESOCKET') {
    return `SMTP sunucusuna bağlanılamadı (${e.code}). Sunucu ve port ayarlarını kontrol et.`;
  }
  if (e?.code === 'EENVELOPE') return 'Alıcı adresi geçersiz görünüyor.';
  return `E-posta gönderilemedi: ${msg.slice(0, 200)}`;
}
