import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Api, apiError } from '../core/api';
import { countdown, relativeTime } from '../core/format';
import { AppStore } from '../core/store';
import { ToastService } from '../core/ui-services';
import { Switch } from '../ui/controls';
import { Icon } from '../ui/icon';

/** Otomatik taramanın durumu: açık/kapalı, geri sayım, "Şimdi tara". */
@Component({
  selector: 'app-monitor-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Switch],
  template: `
    @if (status(); as s) {
      <div class="rounded-xl border border-line bg-surface p-3.5 shadow-card">
        <div class="flex items-center justify-between gap-3">
          <div class="flex min-w-0 items-center gap-2">
            <span
              class="h-2 w-2 shrink-0 rounded-full"
              [class]="s.enabled ? 'bg-success live-dot' : 'bg-fg-subtle'"
            ></span>
            <span class="truncate text-[13px] font-medium text-fg">{{ headline() }}</span>
          </div>
          <app-switch [checked]="s.enabled" [label]="'Otomatik tarama'" [disabled]="toggling()" (changed)="toggle($event)" />
        </div>

        @if (s.enabled) {
          <div class="mt-3 flex items-baseline justify-between text-[12px] text-fg-muted">
            <span>{{ s.scanning ? 'Kanallar kontrol ediliyor' : 'Sonraki tarama' }}</span>
            @if (!s.scanning) {
              <span class="kbd-mono text-[13px] text-fg">{{ remaining() }}</span>
            }
          </div>
          <div class="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-3">
            <div
              class="h-full rounded-full transition-[width] duration-1000 ease-linear"
              [class]="s.scanning ? 'w-full animate-pulse bg-accent' : 'bg-ink/70'"
              [style.width.%]="s.scanning ? 100 : progress()"
            ></div>
          </div>
        } @else {
          <p class="mt-2 text-[12px] leading-snug text-fg-muted">Yeni videolar kontrol edilmiyor.</p>
        }

        <p class="mt-2 text-[12px] text-fg-subtle">Son tarama {{ lastScan() }}</p>
        <button type="button" class="btn btn-secondary btn-sm mt-3 w-full" [disabled]="s.scanning || scanning()" (click)="scan()">
          <app-icon [name]="s.scanning || scanning() ? 'spinner' : 'refresh'" [size]="14" />
          Şimdi tara
        </button>
      </div>
    }
  `,
})
export class MonitorCard {
  private readonly api = inject(Api);
  private readonly store = inject(AppStore);
  private readonly toast = inject(ToastService);

  protected readonly status = this.store.status;
  protected readonly toggling = signal(false);
  protected readonly scanning = signal(false);

  protected readonly headline = computed(() => {
    const s = this.status();
    if (!s) return '';
    if (!s.enabled) return 'Durduruldu';
    if (s.scanning) return 'Taranıyor…';
    if (s.processing) return 'Özetleniyor…';
    return 'İzleniyor';
  });

  protected readonly remaining = computed(() => {
    const ms = this.store.nextScanIn();
    return ms === null ? '—' : countdown(ms);
  });

  protected readonly progress = computed(() => {
    const s = this.status();
    const ms = this.store.nextScanIn();
    if (!s || ms === null) return 0;
    const total = s.intervalMinutes * 60_000;
    return Math.min(100, Math.max(0, ((total - ms) / total) * 100));
  });

  protected readonly lastScan = computed(() => relativeTime(this.status()?.lastScanAt, this.store.now()));

  async toggle(enabled: boolean): Promise<void> {
    this.toggling.set(true);
    try {
      this.store.apply(await this.api.setAutomation(enabled));
    } catch (err) {
      this.toast.error(apiError(err));
      void this.store.refresh();
    } finally {
      this.toggling.set(false);
    }
  }

  async scan(): Promise<void> {
    this.scanning.set(true);
    try {
      this.store.apply(await this.api.scanNow());
      this.toast.show('Kanallar kontrol ediliyor…');
    } catch (err) {
      this.toast.error(apiError(err));
    } finally {
      this.scanning.set(false);
    }
  }
}
