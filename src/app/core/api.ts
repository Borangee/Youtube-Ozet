import { HttpClient, HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom, tap } from 'rxjs';
import type {
  AppState,
  BulkAddResult,
  Channel,
  ChannelCandidate,
  ChannelSearchResult,
  Digest,
  SessionInfo,
  SettingsUpdate,
} from '../../shared/types';

const TOKEN_KEY = 'ozetci.token';

/** Oturum jetonu. localStorage erişilemezse (gizli sekme vb.) bellekte tutulur. */
@Injectable({ providedIn: 'root' })
export class AuthSession {
  readonly authRequired = signal(false);
  readonly authenticated = signal<boolean | null>(null);
  private memoryToken: string | null = null;

  get token(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY) ?? this.memoryToken;
    } catch {
      return this.memoryToken;
    }
  }

  setToken(token: string | null): void {
    this.memoryToken = token;
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      // yok say
    }
  }

  expire(): void {
    this.setToken(null);
    if (this.authRequired()) this.authenticated.set(false);
  }
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const session = inject(AuthSession);
  const token = session.token;
  const authed = token && req.url.startsWith('/api/') ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
  return next(authed).pipe(
    tap({
      error: (err: unknown) => {
        if (err instanceof HttpErrorResponse && err.status === 401 && !req.url.includes('/auth/')) session.expire();
      },
    }),
  );
};

/** Sunucunun döndürdüğü hata mesajını kullanıcıya gösterilebilir metne çevirir. */
export function apiError(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as { error?: string } | string | null;
    if (body && typeof body === 'object' && body.error) return body.error;
    if (err.status === 0) return 'Sunucuya ulaşılamadı. Bağlantını kontrol et.';
    return `İstek başarısız oldu (HTTP ${err.status}).`;
  }
  return err instanceof Error ? err.message : 'Beklenmeyen bir hata oluştu.';
}

@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);

  session(): Promise<SessionInfo> {
    return firstValueFrom(this.http.get<SessionInfo>('/api/auth/session'));
  }

  login(password: string): Promise<{ token: string | null }> {
    return firstValueFrom(this.http.post<{ token: string | null }>('/api/auth/login', { password }));
  }

  state(): Promise<AppState> {
    return firstValueFrom(this.http.get<AppState>('/api/state'));
  }

  scanNow(): Promise<AppState> {
    return firstValueFrom(this.http.post<AppState>('/api/scan', {}));
  }

  setAutomation(enabled: boolean): Promise<AppState> {
    return firstValueFrom(this.http.post<AppState>('/api/automation', { enabled }));
  }

  saveSettings(update: SettingsUpdate): Promise<AppState> {
    return firstValueFrom(this.http.put<AppState>('/api/settings', update));
  }

  sendTestEmail(): Promise<void> {
    return firstValueFrom(this.http.post<void>('/api/settings/test-email', {}));
  }

  searchChannels(q: string): Promise<ChannelSearchResult[]> {
    return firstValueFrom(this.http.get<ChannelSearchResult[]>('/api/channels/search', { params: { q } }));
  }

  addChannel(candidate: ChannelCandidate): Promise<{ channel: Channel; state: AppState }> {
    return firstValueFrom(this.http.post<{ channel: Channel; state: AppState }>('/api/channels', candidate));
  }

  addChannelsBulk(inputs: string[]): Promise<{ result: BulkAddResult; state: AppState }> {
    return firstValueFrom(this.http.post<{ result: BulkAddResult; state: AppState }>('/api/channels/bulk', { inputs }));
  }

  setChannelPaused(id: string, paused: boolean): Promise<AppState> {
    return firstValueFrom(this.http.patch<AppState>(`/api/channels/${encodeURIComponent(id)}`, { paused }));
  }

  removeChannel(id: string): Promise<AppState> {
    return firstValueFrom(this.http.delete<AppState>(`/api/channels/${encodeURIComponent(id)}`));
  }

  summarizeLatest(id: string, sendEmail: boolean): Promise<{ digest: Digest; state: AppState }> {
    return firstValueFrom(
      this.http.post<{ digest: Digest; state: AppState }>(`/api/channels/${encodeURIComponent(id)}/summarize-latest`, {
        sendEmail,
      }),
    );
  }

  digestAction(id: string, action: 'resend' | 'regenerate'): Promise<AppState> {
    return firstValueFrom(this.http.post<AppState>(`/api/digests/${encodeURIComponent(id)}/${action}`, {}));
  }

  removeDigest(id: string): Promise<AppState> {
    return firstValueFrom(this.http.delete<AppState>(`/api/digests/${encodeURIComponent(id)}`));
  }

  digestPreview(id: string): Promise<string> {
    return firstValueFrom(this.http.get(`/api/digests/${encodeURIComponent(id)}/preview`, { responseType: 'text' }));
  }

  downloadBotScript(): Promise<Blob> {
    return firstValueFrom(this.http.get('/api/bot/script', { responseType: 'blob' }));
  }
}
