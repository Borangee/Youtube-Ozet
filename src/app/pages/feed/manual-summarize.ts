import { ChangeDetectionStrategy, Component, computed, effect, inject, output, signal } from '@angular/core';
import type { ChannelVideo, Digest, DigestStatus } from '../../../shared/types';
import { Api, apiError } from '../../core/api';
import { relativeTime } from '../../core/format';
import { AppStore } from '../../core/store';
import { ToastService } from '../../core/ui-services';
import { Avatar, Segmented, type SegmentOption } from '../../ui/controls';
import { Icon } from '../../ui/icon';

const OPEN_KEY = 'ozetci.manualOpen';
const CHANNEL_KEY = 'ozetci.manualChannel';

const STATUS_LABEL: Partial<Record<DigestStatus, string>> = {
  queued: 'Sırada',
  processing: 'Özetleniyor',
  waiting: 'Yayın bekleniyor',
  sent: 'Gönderildi',
  ready: 'Özet hazır',
  failed: 'Başarısız',
  skipped: 'Atlandı',
};

/**
 * Akış sayfasındaki "Elle özetle" paneli: kanal seç, son 10 videosundan birini
 * seç, hemen özetle. Otomatik taramayı beklemeden denemek için.
 */
@Component({
  selector: 'app-manual-summarize',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Avatar, Segmented],
  host: { class: 'block' },
  template: `
    <section class="card overflow-hidden" aria-labelledby="manual-title">
      <button
        type="button"
        class="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2/60 sm:px-5"
        [attr.aria-expanded]="open()"
        aria-controls="manual-body"
        (click)="toggle()"
      >
        <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-text">
          <app-icon name="sparkles" [size]="16" />
        </span>
        <span class="min-w-0 flex-1">
          <span id="manual-title" class="block text-[15px] font-semibold">Elle özetle</span>
          <span class="block truncate text-[13px] text-fg-muted">Bir kanal seç, son videolarından birini hemen özetle.</span>
        </span>
        <app-icon [name]="open() ? 'chevron-down' : 'chevron-right'" [size]="16" class="text-fg-subtle" />
      </button>

      @if (open()) {
        <div id="manual-body" class="animate-fade-up border-t border-line px-4 pb-4 pt-4 sm:px-5">
          @if (channels().length === 0) {
            <p class="text-sm text-fg-muted">Önce Kanallar sayfasından bir kanal ekle.</p>
          } @else {
            <label class="field-label" for="manual-channel">Kanal</label>
            <div class="flex items-center gap-2.5">
              @if (selectedChannel(); as ch) {
                <app-avatar [src]="ch.avatar" [name]="ch.name" [size]="36" />
              }
              <select
                id="manual-channel"
                class="input min-w-0 flex-1"
                [value]="channelId()"
                (change)="selectChannel($any($event.target).value)"
              >
                @for (ch of channels(); track ch.id) {
                  <option [value]="ch.id">{{ ch.name }}</option>
                }
              </select>
              <button
                type="button"
                class="btn btn-ghost btn-icon shrink-0"
                aria-label="Videoları yenile"
                title="Videoları yenile"
                [disabled]="loading()"
                (click)="load()"
              >
                <app-icon [name]="loading() ? 'spinner' : 'refresh'" [size]="16" />
              </button>
            </div>

            <div class="mt-5 flex flex-wrap items-center justify-between gap-2">
              <p class="field-label !mb-0">Son videolar</p>
              @if (shortCount() > 0 && shortCount() < videos().length) {
                <app-segmented [options]="kindOptions()" [(value)]="kind" label="Video türü" />
              }
            </div>
            <div class="mb-1.5"></div>
            @if (loading() && videos().length === 0) {
              <div class="space-y-2" aria-label="Videolar yükleniyor">
                @for (i of [1, 2, 3, 4]; track i) {
                  <div class="flex items-center gap-3 rounded-lg border border-line p-2">
                    <div class="skeleton aspect-video w-[96px] shrink-0"></div>
                    <div class="flex-1 space-y-2">
                      <div class="skeleton h-3 w-10/12"></div>
                      <div class="skeleton h-3 w-4/12"></div>
                    </div>
                  </div>
                }
              </div>
            } @else if (error()) {
              <div class="flex items-start gap-2 rounded-lg bg-accent-soft px-3 py-2.5 text-[13px] text-accent-text" role="alert">
                <app-icon name="alert-circle" [size]="15" class="mt-px" />
                <span>{{ error() }}</span>
              </div>
            } @else if (videos().length === 0) {
              <p class="text-sm text-fg-muted">Bu kanalda video bulunamadı.</p>
            } @else if (visibleVideos().length === 0) {
              <p class="text-sm text-fg-muted">Bu türde video yok.</p>
            } @else {
              <ul class="max-h-[440px] space-y-1.5 overflow-y-auto pr-0.5" role="listbox" aria-label="Özetlenecek video">
                @for (v of visibleVideos(); track v.id) {
                  @let d = digestOf(v.id);
                  <li>
                    <button
                      type="button"
                      role="option"
                      [attr.aria-selected]="selectedId() === v.id"
                      class="flex w-full items-center gap-3 rounded-lg border p-2 text-left transition-colors"
                      [class]="selectedId() === v.id ? 'border-ink bg-surface-2' : 'border-line hover:border-line-strong hover:bg-surface-2/60'"
                      (click)="selectedId.set(v.id)"
                    >
                      @if (v.isShort) {
                        <!-- Shorts dikey: dar, dik bir kare ve kırmızı etiketle ayrışır -->
                        <span class="flex w-[96px] shrink-0 justify-center">
                          <span class="relative aspect-[9/16] w-[38px] overflow-hidden rounded-md bg-surface-3 ring-2 ring-accent/60">
                            <img [src]="v.thumbnail" alt="" loading="lazy" referrerpolicy="no-referrer" class="h-full w-full object-cover" />
                          </span>
                        </span>
                      } @else {
                        <span class="relative aspect-video w-[96px] shrink-0 overflow-hidden rounded-md bg-surface-3">
                          <img [src]="v.thumbnail" alt="" loading="lazy" referrerpolicy="no-referrer" class="h-full w-full object-cover" />
                        </span>
                      }
                      <span class="min-w-0 flex-1">
                        <span class="line-clamp-2 text-[13.5px] font-medium leading-snug">{{ v.title }}</span>
                        <span class="mt-0.5 flex items-center gap-1.5 text-xs text-fg-subtle">
                          @if (v.isShort) {
                            <span class="inline-flex items-center gap-1 rounded-full bg-accent-soft px-1.5 py-px text-[11px] font-semibold text-accent-text">
                              <app-icon name="phone" [size]="10" [stroke]="2.2" /> Shorts
                            </span>
                          }
                          {{ ago(v.publishedAt) }}
                        </span>
                      </span>
                      @if (d) {
                        <span class="badge shrink-0" [class.badge-success]="d.status === 'sent' || d.status === 'ready'">
                          {{ statusLabel(d.status) }}
                        </span>
                      } @else {
                        <span
                          class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border"
                          [class]="selectedId() === v.id ? 'border-ink bg-ink' : 'border-line-strong'"
                        >
                          @if (selectedId() === v.id) {
                            <span class="h-1.5 w-1.5 rounded-full bg-ink-fg"></span>
                          }
                        </span>
                      }
                    </button>
                  </li>
                }
              </ul>

              <div class="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
                @if (selectedDigest(); as sd) {
                  @if (sd.summary && sd.status !== 'failed' && sd.status !== 'skipped') {
                    <button type="button" class="btn btn-primary" (click)="show.emit(sd.id)">
                      <app-icon name="eye" /> Özeti göster
                    </button>
                    <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="summarize(true)">
                      <app-icon name="send" /> E-postayla gönder
                    </button>
                  } @else if (sd.status === 'processing' || sd.status === 'queued') {
                    <button type="button" class="btn btn-primary" (click)="show.emit(sd.id)">
                      <app-icon name="spinner" /> Özetleniyor, göster
                    </button>
                  } @else {
                    <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="summarize(false)">
                      <app-icon [name]="busy() ? 'spinner' : 'sparkles'" /> Tekrar özetle
                    </button>
                  }
                } @else {
                  <button type="button" class="btn btn-primary" [disabled]="!selectedId() || busy()" (click)="summarize(false)">
                    <app-icon [name]="busy() ? 'spinner' : 'sparkles'" /> Özetle
                  </button>
                  <button type="button" class="btn btn-secondary" [disabled]="!selectedId() || busy()" (click)="summarize(true)">
                    <app-icon name="mail" /> Özetle ve e-postala
                  </button>
                }
                @if (!selectedId()) {
                  <span class="text-xs text-fg-subtle">Listeden bir video seç.</span>
                }
              </div>
            }
          }
        </div>
      }
    </section>
  `,
})
export class ManualSummarize {
  private readonly api = inject(Api);
  private readonly store = inject(AppStore);
  private readonly toast = inject(ToastService);

  /** Özet oluşturulunca ya da "göster"e basılınca akıştaki kartın açılması için. */
  readonly show = output<string>();

  protected readonly open = signal(this.readOpen());
  protected readonly channelId = signal<string>('');
  protected readonly videos = signal<ChannelVideo[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly kind = signal<'all' | 'videos' | 'shorts'>('all');
  private loadSeq = 0;

  protected readonly shortCount = computed(() => this.videos().filter((v) => v.isShort).length);
  protected readonly kindOptions = computed<SegmentOption<'all' | 'videos' | 'shorts'>[]>(() => [
    { value: 'all', label: 'Tümü' },
    { value: 'videos', label: `Videolar ${this.videos().length - this.shortCount()}` },
    { value: 'shorts', label: `Shorts ${this.shortCount()}` },
  ]);
  protected readonly visibleVideos = computed(() => {
    const k = this.kind();
    return k === 'all' ? this.videos() : this.videos().filter((v) => (k === 'shorts' ? v.isShort : !v.isShort));
  });

  protected readonly channels = computed(() =>
    [...this.store.channels()].sort((a, b) => a.name.localeCompare(b.name, 'tr')),
  );
  protected readonly selectedChannel = computed(() => this.channels().find((c) => c.id === this.channelId()) ?? null);
  private readonly digestMap = computed(() => new Map(this.store.digests().map((d) => [d.id, d])));
  protected readonly selectedDigest = computed(() => {
    const id = this.selectedId();
    return id ? (this.digestMap().get(id) ?? null) : null;
  });

  constructor() {
    // Panel açıkken ilk uygun kanalı seç ve videolarını getir
    effect(() => {
      if (!this.open() || this.channelId()) return;
      const list = this.channels();
      if (list.length === 0) return;
      const remembered = this.readChannel();
      const first = list.find((c) => c.id === remembered) ?? list[0];
      queueMicrotask(() => this.selectChannel(first.id));
    });
  }

  toggle(): void {
    this.open.set(!this.open());
    try {
      localStorage.setItem(OPEN_KEY, this.open() ? '1' : '0');
    } catch {
      // yok say
    }
  }

  /** Dışarıdan (ör. boş akıştaki düğmeden) paneli açmak için. */
  expand(): void {
    if (!this.open()) this.toggle();
  }

  selectChannel(id: string): void {
    this.channelId.set(id);
    this.selectedId.set(null);
    this.kind.set('all');
    this.videos.set([]);
    try {
      localStorage.setItem(CHANNEL_KEY, id);
    } catch {
      // yok say
    }
    void this.load();
  }

  async load(): Promise<void> {
    const id = this.channelId();
    if (!id) return;
    const seq = ++this.loadSeq;
    this.loading.set(true);
    this.error.set(null);
    try {
      const list = await this.api.channelVideos(id);
      if (seq !== this.loadSeq) return;
      this.videos.set(list);
    } catch (err) {
      if (seq !== this.loadSeq) return;
      this.error.set(apiError(err));
    } finally {
      if (seq === this.loadSeq) this.loading.set(false);
    }
  }

  async summarize(sendEmail: boolean): Promise<void> {
    const videoId = this.selectedId();
    if (!videoId) return;
    this.busy.set(true);
    try {
      const { digest, state } = await this.api.summarizeVideo(this.channelId(), videoId, sendEmail);
      this.store.apply(state);
      this.toast.success(sendEmail ? 'Özetleniyor; bitince e-postayla gönderilecek.' : 'Özetleniyor, akışın en üstünde görünecek.');
      this.show.emit(digest.id);
    } catch (err) {
      this.toast.error(apiError(err));
    } finally {
      this.busy.set(false);
    }
  }

  digestOf(id: string): Digest | null {
    return this.digestMap().get(id) ?? null;
  }

  statusLabel(status: DigestStatus): string {
    return STATUS_LABEL[status] ?? '';
  }

  ago(iso: string): string {
    return relativeTime(iso, this.store.now());
  }

  private readOpen(): boolean {
    try {
      return localStorage.getItem(OPEN_KEY) !== '0';
    } catch {
      return true;
    }
  }

  private readChannel(): string | null {
    try {
      return localStorage.getItem(CHANNEL_KEY);
    } catch {
      return null;
    }
  }
}
