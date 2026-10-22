import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import type { AppState, Digest } from '../../shared/types';
import { Api, apiError } from './api';

const IDLE_POLL_MS = 15_000;
const BUSY_POLL_MS = 2_500;

/**
 * Uygulamanın tek veri kaynağı. Sunucudan durumu çeker, gerektiğinde sık,
 * boştayken seyrek yoklar; sekme arka plandayken yoklamayı durdurur.
 */
@Injectable({ providedIn: 'root' })
export class AppStore {
  private readonly api = inject(Api);

  readonly state = signal<AppState | null>(null);
  readonly loadError = signal<string | null>(null);
  /** Geri sayımlar için saniyede bir güncellenen saat (sunucu saatine göre düzeltilmiş). */
  readonly now = signal(Date.now());

  private clockOffset = 0;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  readonly status = computed(() => this.state()?.status ?? null);
  readonly settings = computed(() => this.state()?.settings ?? null);
  readonly channels = computed(() => this.state()?.channels ?? []);
  readonly digests = computed(() => this.state()?.digests ?? []);
  readonly logs = computed(() => this.state()?.logs ?? []);

  readonly busy = computed(() => {
    const s = this.state();
    if (!s) return false;
    return s.status.scanning || s.status.processing || s.digests.some((d) => d.status === 'processing');
  });

  readonly nextScanIn = computed(() => {
    const next = this.status()?.nextScanAt;
    return next ? Math.max(0, Date.parse(next) - this.now()) : null;
  });

  readonly setupComplete = computed(() => {
    const setup = this.status()?.setup;
    return Boolean(setup && setup.gemini && setup.email && setup.channels);
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.tickTimer = setInterval(() => this.now.set(Date.now() + this.clockOffset), 1000);
    document.addEventListener('visibilitychange', this.onVisibility);
    void this.refresh();
  }

  stop(): void {
    this.started = false;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.tickTimer) clearInterval(this.tickTimer);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  private readonly onVisibility = () => {
    if (document.visibilityState === 'visible') void this.refresh();
  };

  async refresh(): Promise<void> {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    try {
      this.apply(await this.api.state());
      this.loadError.set(null);
    } catch (err) {
      this.loadError.set(apiError(err));
    } finally {
      this.schedule();
    }
  }

  /** Mutasyon uç noktaları güncel durumu döndürür; burada uygulanır. */
  apply(state: AppState): void {
    this.clockOffset = Date.parse(state.status.serverTime) - Date.now();
    this.now.set(Date.now() + this.clockOffset);
    this.state.set(state);
    this.schedule();
  }

  patchDigest(digest: Digest): void {
    const s = this.state();
    if (!s) return;
    const rest = s.digests.filter((d) => d.id !== digest.id);
    this.state.set({ ...s, digests: [digest, ...rest] });
  }

  private schedule(): void {
    if (!this.started) return;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (document.visibilityState === 'hidden') return;
    const busy = this.busy() || this.digests().some((d) => d.status === 'queued' && !d.nextAttemptAt);
    this.pollTimer = setTimeout(() => void this.refresh(), busy ? BUSY_POLL_MS : IDLE_POLL_MS);
  }
}
