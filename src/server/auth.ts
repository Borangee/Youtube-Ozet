import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Basit şifre koruması. APP_PASSWORD ortam değişkeni tanımlıysa arayüz ve
 * API'ye erişmek için şifre gerekir. Giriş başarılı olunca imzalı bir jeton
 * verilir; tarayıcı bunu Authorization başlığıyla gönderir. Çerez yerine
 * başlık kullanılmasının nedeni uygulamanın AI Studio'da iframe içinde de
 * çalışması (üçüncü taraf çerezleri orada engellenebiliyor).
 */

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 8;

function appPassword(): string {
  return (process.env['APP_PASSWORD'] ?? '').trim();
}

export function isAuthEnabled(): boolean {
  return appPassword().length > 0;
}

function signingKey(): Buffer {
  // Şifre değişince eski oturumlar da geçersiz olur.
  return createHash('sha256').update(`ozetci-oturum:${appPassword()}`).digest();
}

function sign(payload: string): string {
  return createHmac('sha256', signingKey()).update(payload).digest('base64url');
}

export function issueToken(): string {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + TOKEN_TTL_MS })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token: string): boolean {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as { exp?: number };
    return typeof exp === 'number' && exp > Date.now();
  } catch {
    return false;
  }
}

export function checkPassword(candidate: string): boolean {
  const a = createHash('sha256').update(candidate).digest();
  const b = createHash('sha256').update(appPassword()).digest();
  return timingSafeEqual(a, b);
}

const failures = new Map<string, { count: number; since: number }>();

export function loginBlocked(ip: string): boolean {
  const entry = failures.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.since > LOGIN_WINDOW_MS) {
    failures.delete(ip);
    return false;
  }
  return entry.count >= LOGIN_MAX_FAILURES;
}

export function recordLoginFailure(ip: string): void {
  const entry = failures.get(ip);
  if (!entry || Date.now() - entry.since > LOGIN_WINDOW_MS) failures.set(ip, { count: 1, since: Date.now() });
  else entry.count += 1;
}

export function clearLoginFailures(ip: string): void {
  failures.delete(ip);
}

export function isAuthenticated(req: Request): boolean {
  if (!isAuthEnabled()) return true;
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  return token.length > 0 && verifyToken(token);
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (isAuthenticated(req)) {
    next();
    return;
  }
  res.status(401).json({ error: 'Oturum gerekli.' });
}

/** Belirli bir eylem için basit, bellek içi hız sınırı. */
export function throttle(windowMs: number) {
  const last = new Map<string, number>();
  return (key: string): boolean => {
    const now = Date.now();
    const prev = last.get(key) ?? 0;
    if (now - prev < windowMs) return false;
    last.set(key, now);
    return true;
  };
}
