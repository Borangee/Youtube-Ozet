import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createApiRouter } from './server/api';
import { startScheduler } from './server/scheduler';

// Yerelde çalıştırırken .env dosyasını oku (AI Studio / Cloud Run ortam değişkenlerini kendisi verir)
const envFile = join(process.cwd(), '.env');
if (existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch (err) {
    console.warn('.env okunamadı:', err);
  }
}

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();

app.disable('x-powered-by');
// Cloud Run / AI Studio tek bir vekil sunucunun arkasında çalışır; gerçek istemci IP'si için
app.set('trust proxy', 1);

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Geliştirme sunucusunda (ng serve) bu dosya ara katman olarak yüklenir ve
// isMainModule false olur; zamanlayıcıyı ilk istekte başlat.
let schedulerStarted = false;
function ensureScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  startScheduler();
}

app.use('/api', (_req, _res, next) => {
  ensureScheduler();
  next();
});
app.use('/api', express.json({ limit: '64kb' }), createApiRouter());

app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

// Tüm sayfalar istemci tarafında çiziliyor (RenderMode.Client). Derlenmiş sürümde
// doğrudan index.csr.html verilir; geliştirme sunucusunda (ng serve) bu dosya
// bellekte olduğundan Angular motoruna bırakılır.
const csrIndex = join(browserDistFolder, 'index.csr.html');
let angularApp: AngularNodeAppEngine | null = null;

app.get('/{*path}', (req, res, next) => {
  if (existsSync(csrIndex)) {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(csrIndex);
    return;
  }
  // Sunucu render sırasında dışarı istek atılmadığı için Host kısıtlaması gerekmiyor
  angularApp ??= new AngularNodeAppEngine({ allowedHosts: ['*'] });
  angularApp
    .handle(req)
    .then((response) => (response ? writeResponseToNodeResponse(response, res) : next()))
    .catch(next);
});

if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 3000;
  app.listen(port, (error) => {
    if (error) throw error;
    console.log(`Özetçi http://localhost:${port} adresinde çalışıyor`);
    ensureScheduler();
  });
}

export const reqHandler = createNodeRequestHandler(app);
