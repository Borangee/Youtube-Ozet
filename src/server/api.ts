import express, { type Request, type Response, type Router } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AppState, ChannelCandidate, ChannelSearchResult, SessionInfo, SettingsUpdate } from '../shared/types';
import {
  checkPassword,
  clearLoginFailures,
  isAuthEnabled,
  isAuthenticated,
  issueToken,
  loginBlocked,
  recordLoginFailure,
  requireAuth,
  throttle,
} from './auth';
import { renderDigestEmail, sendTestEmail } from './mailer';
import { getStore } from './store';
import {
  addChannel,
  addChannelsBulk,
  getAutomationStatus,
  requeueDigest,
  rescheduleAfterSettingsChange,
  runScan,
  setAutomationEnabled,
  summarizeLatest,
} from './scheduler';
import { isChannelId, isVideoId, searchChannels } from './youtube';

/**
 * /api altındaki tüm uç noktalar. Giriş, sağlık kontrolü ve anahtarlı cron
 * dışındaki her şey şifre korumasının arkasında.
 */

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'Beklenmeyen bir hata oluştu.';
}

function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'bilinmiyor';
}

function cronKeyValid(req: Request): boolean {
  const key = String(req.query['key'] ?? req.headers['x-cron-key'] ?? '');
  return key.length > 0 && key === getStore().cronKey;
}

const testEmailThrottle = throttle(20_000);
const manualScanThrottle = throttle(15_000);
const summarizeThrottle = throttle(5_000);

const searchCache = new Map<string, { at: number; results: ChannelSearchResult[] }>();

function buildState(): AppState {
  const store = getStore();
  return {
    status: getAutomationStatus(isAuthEnabled()),
    settings: store.publicSettings(),
    channels: store.publicChannels(),
    digests: store.digests.slice(0, 100),
    logs: store.logs.slice(0, 60),
  };
}

export function createApiRouter(): Router {
  const api = express.Router();

  // ---- herkese açık ----------------------------------------------------

  api.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  api.get('/auth/session', (req, res) => {
    const info: SessionInfo = { authRequired: isAuthEnabled(), authenticated: isAuthenticated(req) };
    res.json(info);
  });

  api.post('/auth/login', (req, res) => {
    if (!isAuthEnabled()) {
      res.json({ token: null });
      return;
    }
    const ip = clientIp(req);
    if (loginBlocked(ip)) {
      res.status(429).json({ error: 'Çok fazla hatalı deneme. 15 dakika sonra tekrar dene.' });
      return;
    }
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!password || !checkPassword(password)) {
      recordLoginFailure(ip);
      res.status(401).json({ error: 'Şifre yanlış.' });
      return;
    }
    clearLoginFailures(ip);
    res.json({ token: issueToken() });
  });

  // Dış zamanlayıcılar (cron-job.org vb.) için. Anahtar, Ayarlar sayfasında görünür.
  api.all('/cron/scan', async (req, res) => {
    if (!cronKeyValid(req)) {
      res.status(403).json({ error: 'Geçersiz anahtar.' });
      return;
    }
    try {
      const result = await runScan('cron');
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ error: errorText(err) });
    }
  });

  // bot.py'nin kanal listesini eşitlemesi için (aynı cron anahtarıyla)
  api.get('/bot/channels', (req, res) => {
    if (!cronKeyValid(req)) {
      res.status(403).json({ error: 'Geçersiz anahtar.' });
      return;
    }
    res.json(getStore().channels.map((c) => ({ id: c.id, name: c.name, handle: c.handle })));
  });

  // ---- oturum gerekli --------------------------------------------------

  api.use(requireAuth);

  api.get('/state', (_req, res) => {
    res.json(buildState());
  });

  api.post('/scan', (req, res) => {
    if (!manualScanThrottle('scan')) {
      res.status(429).json({ error: 'Az önce tarandı, birkaç saniye bekle.' });
      return;
    }
    void runScan('manual');
    res.json(buildState());
  });

  api.post('/automation', (req, res) => {
    setAutomationEnabled(Boolean(req.body?.enabled));
    res.json(buildState());
  });

  api.put('/settings', (req, res) => {
    try {
      const body = (req.body ?? {}) as SettingsUpdate;
      const prevInterval = getStore().scan.intervalMinutes;
      getStore().updateSettings(body);
      if (getStore().scan.intervalMinutes !== prevInterval) rescheduleAfterSettingsChange();
      res.json(buildState());
    } catch (err) {
      res.status(400).json({ error: errorText(err) });
    }
  });

  api.post('/settings/test-email', async (_req, res) => {
    if (!testEmailThrottle('test')) {
      res.status(429).json({ error: 'Test e-postası az önce gönderildi, 20 saniye bekle.' });
      return;
    }
    try {
      await sendTestEmail();
      getStore().log('success', 'Test e-postası gönderildi.');
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: errorText(err) });
    }
  });

  api.get('/channels/search', async (req, res) => {
    const q = String(req.query['q'] ?? '').trim().slice(0, 100);
    if (q.length < 2) {
      res.json([]);
      return;
    }
    const cached = searchCache.get(q.toLowerCase());
    if (cached && Date.now() - cached.at < 10 * 60_000) {
      res.json(cached.results);
      return;
    }
    try {
      const results = await searchChannels(q);
      searchCache.set(q.toLowerCase(), { at: Date.now(), results });
      if (searchCache.size > 100) searchCache.delete(searchCache.keys().next().value!);
      res.json(results);
    } catch (err) {
      res.status(502).json({ error: `YouTube araması başarısız: ${errorText(err)}` });
    }
  });

  api.post('/channels', async (req, res) => {
    const body = (req.body ?? {}) as ChannelCandidate;
    const candidate: ChannelCandidate = {
      id: typeof body.id === 'string' ? body.id : undefined,
      input: typeof body.input === 'string' ? body.input.slice(0, 300) : undefined,
      name: typeof body.name === 'string' ? body.name.slice(0, 120) : undefined,
      handle: typeof body.handle === 'string' && /^@[\p{L}\p{N}._-]{1,100}$/u.test(body.handle) ? body.handle : undefined,
      avatar: typeof body.avatar === 'string' && /^https:\/\//.test(body.avatar) ? body.avatar.slice(0, 500) : undefined,
      subscribers: typeof body.subscribers === 'string' ? body.subscribers.slice(0, 40) : undefined,
    };
    try {
      const channel = await addChannel(candidate, false);
      res.json({ channel, state: buildState() });
    } catch (err) {
      res.status(400).json({ error: errorText(err) });
    }
  });

  api.post('/channels/bulk', async (req, res) => {
    const inputs = Array.isArray(req.body?.inputs) ? (req.body.inputs as unknown[]).map((x) => String(x).slice(0, 300)) : [];
    if (inputs.length === 0) {
      res.status(400).json({ error: 'Eklenecek kanal yok.' });
      return;
    }
    const result = await addChannelsBulk(inputs);
    res.json({ result, state: buildState() });
  });

  api.patch('/channels/:id', (req, res) => {
    const ch = getStore().findChannel(req.params['id']);
    if (!ch) {
      res.status(404).json({ error: 'Kanal bulunamadı.' });
      return;
    }
    if (typeof req.body?.paused === 'boolean') ch.paused = req.body.paused;
    getStore().save();
    res.json(buildState());
  });

  api.delete('/channels/:id', (req, res) => {
    const ch = getStore().findChannel(req.params['id']);
    if (!ch || !getStore().removeChannel(ch.id)) {
      res.status(404).json({ error: 'Kanal bulunamadı.' });
      return;
    }
    getStore().log('info', `${ch.name} takipten çıkarıldı.`);
    res.json(buildState());
  });

  api.post('/channels/:id/summarize-latest', async (req, res) => {
    const id = req.params['id'];
    if (!isChannelId(id)) {
      res.status(400).json({ error: 'Geçersiz kanal.' });
      return;
    }
    if (!summarizeThrottle(id)) {
      res.status(429).json({ error: 'Biraz bekle.' });
      return;
    }
    try {
      const digest = await summarizeLatest(id, Boolean(req.body?.sendEmail));
      res.json({ digest, state: buildState() });
    } catch (err) {
      res.status(400).json({ error: errorText(err) });
    }
  });

  api.post('/digests/:id/:action', (req, res) => {
    const { id, action } = req.params;
    if (!isVideoId(id) || (action !== 'resend' && action !== 'regenerate')) {
      res.status(400).json({ error: 'Geçersiz istek.' });
      return;
    }
    try {
      requeueDigest(id, action);
      res.json(buildState());
    } catch (err) {
      res.status(400).json({ error: errorText(err) });
    }
  });

  api.delete('/digests/:id', (req, res) => {
    if (!getStore().removeDigest(req.params['id'])) {
      res.status(404).json({ error: 'Özet bulunamadı.' });
      return;
    }
    res.json(buildState());
  });

  api.get('/digests/:id/preview', (req, res) => {
    const digest = getStore().findDigest(req.params['id']);
    if (!digest) {
      res.status(404).send('Bulunamadı');
      return;
    }
    const { html } = renderDigestEmail(digest, digest.summary);
    // Önizleme iframe içinde açılıyor; linkler yeni sekmede açılsın
    res.type('text/plain').send(html.replace('<head>', '<head><base target="_blank">'));
  });

  api.get('/bot/script', (_req, res) => {
    const file = join(process.cwd(), 'bot.py');
    if (!existsSync(file)) {
      res.status(404).json({ error: 'bot.py bulunamadı.' });
      return;
    }
    res.download(file, 'bot.py');
  });

  api.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Bulunamadı.' });
  });

  return api;
}
