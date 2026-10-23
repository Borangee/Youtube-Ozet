import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import type { Digest, DigestStatus, SummaryBasis } from '../../../shared/types';
import { Api, apiError } from '../../core/api';
import { absoluteTime, duration, relativeTime } from '../../core/format';
import { AppStore } from '../../core/store';
import { ToastService } from '../../core/ui-services';
import { Avatar } from '../../ui/controls';
import { Icon, type IconName } from '../../ui/icon';

const STATUS: Record<DigestStatus, { label: string; cls: string; icon: IconName }> = {
  queued: { label: 'Sırada', cls: 'badge', icon: 'clock' },
  processing: { label: 'Özetleniyor', cls: 'badge badge-info', icon: 'spinner' },
  waiting: { label: 'Yayın bekleniyor', cls: 'badge badge-warning', icon: 'clock' },
  sent: { label: 'Gönderildi', cls: 'badge badge-success', icon: 'check' },
  ready: { label: 'Özet hazır', cls: 'badge', icon: 'file' },
  failed: { label: 'Başarısız', cls: 'badge badge-danger', icon: 'alert-circle' },
  skipped: { label: 'Atlandı', cls: 'badge', icon: 'x' },
};

const BASIS: Record<SummaryBasis, string> = {
  video: 'Video izlenerek özetlendi',
  transcript: 'Altyazıdan özetlendi',
  description: 'Yalnızca video açıklamasından özetlendi',
  none: 'Yapay zekâ özeti oluşturulamadı',
};

@Component({
  selector: 'app-digest-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Avatar],
  host: { class: 'block' },
  template: `
    @let d = digest();
    <article class="card overflow-hidden transition-shadow" [class.shadow-pop]="expanded()">
      <button
        type="button"
        class="flex w-full gap-3 p-3 text-left sm:gap-4"
        [attr.aria-expanded]="expanded()"
        (click)="toggled.emit()"
      >
        <div class="relative aspect-video w-[112px] shrink-0 self-start overflow-hidden rounded-lg bg-surface-3 sm:w-[176px]">
          <img [src]="d.thumbnail" alt="" loading="lazy" class="h-full w-full object-cover" referrerpolicy="no-referrer" />
          @if (d.durationSeconds) {
            <span class="kbd-mono absolute bottom-1.5 right-1.5 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white">
              {{ length() }}
            </span>
          }
        </div>

        <div class="min-w-0 flex-1 sm:py-0.5">
          <div class="flex items-center gap-2 text-[12.5px] text-fg-muted sm:text-[13px]">
            <app-avatar class="hidden sm:inline-flex" [src]="d.channelAvatar" [name]="d.channelName" [size]="18" />
            <span class="truncate font-medium text-fg">{{ d.channelName }}</span>
            <span class="hidden shrink-0 text-fg-subtle sm:inline" [title]="published()">· {{ when() }}</span>
            <span class="ml-auto shrink-0 max-sm:!w-[22px] max-sm:!justify-center max-sm:!px-0" [class]="status().cls" [title]="statusLabel()">
              <app-icon [name]="status().icon" [size]="12" [stroke]="2.2" />
              <span class="hidden sm:inline">{{ statusLabel() }}</span>
            </span>
          </div>
          <h3 class="mt-1 line-clamp-2 text-[14px] font-semibold leading-snug tracking-[-0.005em] text-fg sm:mt-1.5 sm:text-[15px]">{{ d.title }}</h3>
          <p class="mt-1 text-xs text-fg-subtle sm:hidden" [title]="published()">{{ when() }}</p>
          @if (d.status === 'processing' && !d.summary) {
            <div class="mt-2.5 hidden space-y-2 sm:block" aria-label="Özet hazırlanıyor">
              <div class="skeleton h-3 w-11/12"></div>
              <div class="skeleton h-3 w-8/12"></div>
            </div>
          } @else if (!expanded()) {
            @if (preview()) {
              <p class="mt-1.5 line-clamp-2 hidden text-sm leading-relaxed text-fg-muted sm:block">{{ preview() }}</p>
            }
          }
        </div>
      </button>

      @if (expanded()) {
        <div class="animate-fade-up border-t border-line px-4 pb-4 pt-4 sm:px-5">
          @if (d.statusNote) {
            <div
              class="mb-4 flex items-start gap-2 rounded-lg px-3 py-2.5 text-[13px] leading-snug"
              [class]="d.status === 'failed' ? 'bg-accent-soft text-accent-text' : d.status === 'waiting' || d.nextAttemptAt ? 'bg-warning-soft text-warning-text' : 'bg-surface-2 text-fg-muted'"
            >
              <app-icon [name]="d.status === 'failed' ? 'alert-circle' : 'info'" [size]="15" class="mt-px" />
              <span>{{ d.statusNote }}</span>
            </div>
          }

          @if (d.summary; as s) {
            @if (s.tldr) {
              <p class="text-[15px] font-medium leading-relaxed text-fg">{{ s.tldr }}</p>
            }
            @for (p of s.paragraphs; track $index) {
              <p class="mt-3 text-[15px] leading-[1.7] text-fg-muted">{{ p }}</p>
            }
            @if (s.keyPoints.length > 0) {
              <h4 class="mt-5 text-[13px] font-semibold text-fg">Öne çıkanlar</h4>
              <ul class="mt-2 space-y-1.5">
                @for (k of s.keyPoints; track $index) {
                  <li class="flex gap-2.5 text-[14px] leading-relaxed text-fg-muted">
                    <span class="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-accent"></span>
                    <span>{{ k }}</span>
                  </li>
                }
              </ul>
            }
            @if (s.chapters.length > 0) {
              <h4 class="mt-5 text-[13px] font-semibold text-fg">Bölümler</h4>
              <div class="mt-2 flex flex-wrap gap-1.5">
                @for (c of visibleChapters(); track c.seconds) {
                  <a
                    [href]="d.url + '&t=' + c.seconds + 's'"
                    target="_blank"
                    rel="noopener"
                    class="inline-flex max-w-full items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2 py-1 text-[12.5px] text-fg-muted transition-colors hover:border-line-strong hover:text-fg"
                  >
                    <span class="kbd-mono text-accent-text">{{ c.time }}</span>
                    <span class="truncate">{{ c.label }}</span>
                  </a>
                }
                @if (s.chapters.length > chapterLimit && !showAllChapters()) {
                  <button
                    type="button"
                    class="rounded-md px-2 py-1 text-[12.5px] font-medium text-fg-muted hover:bg-surface-2 hover:text-fg"
                    (click)="showAllChapters.set(true)"
                  >
                    +{{ s.chapters.length - chapterLimit }} bölüm daha
                  </button>
                }
              </div>
            }
            <p class="mt-5 flex items-center gap-1.5 text-xs text-fg-subtle">
              <app-icon name="sparkles" [size]="13" />
              {{ basis() }}@if (s.model) {
                <span>· {{ s.model }}</span>
              }
            </p>
          } @else if (d.status === 'processing' || (d.status === 'queued' && !d.nextAttemptAt)) {
            <div class="flex items-center gap-2 text-sm text-fg-muted">
              <app-icon name="spinner" [size]="15" />
              {{ d.status === 'processing' ? 'Gemini videoyu izleyip özetliyor. Bu bir dakika kadar sürebilir…' : 'Sırada, birazdan özetlenecek…' }}
            </div>
            <div class="mt-4 space-y-2.5" aria-hidden="true">
              <div class="skeleton h-3.5 w-11/12"></div>
              <div class="skeleton h-3.5 w-full"></div>
              <div class="skeleton h-3.5 w-9/12"></div>
              <div class="skeleton h-3.5 w-10/12"></div>
            </div>
          } @else {
            <p class="text-sm text-fg-muted">Bu video için henüz özet yok.</p>
          }

          <div class="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <a [href]="d.url" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">
              <app-icon name="play" [size]="13" /> YouTube'da aç
            </a>
            @if (d.summary) {
              <button type="button" class="btn btn-secondary btn-sm" (click)="previewEmail.emit(d)">
                <app-icon name="eye" [size]="14" /> E-posta önizlemesi
              </button>
            }
            @if (d.status !== 'processing' && d.status !== 'queued') {
              <button type="button" class="btn btn-secondary btn-sm" [disabled]="busy()" (click)="act('resend')">
                <app-icon name="send" [size]="14" /> {{ d.emailedAt ? 'Tekrar gönder' : 'E-postayla gönder' }}
              </button>
              <button type="button" class="btn btn-ghost btn-sm" [disabled]="busy()" (click)="act('regenerate')">
                <app-icon name="refresh" [size]="14" /> Yeniden özetle
              </button>
            }
            <button
              type="button"
              class="btn btn-sm ml-auto"
              [class]="confirmDelete() ? 'btn-danger' : 'btn-ghost'"
              [disabled]="busy() || d.status === 'processing'"
              (click)="remove()"
            >
              <app-icon name="trash" [size]="14" /> {{ confirmDelete() ? 'Silinsin mi?' : 'Sil' }}
            </button>
          </div>
          @if (d.emailedAt) {
            <p class="mt-3 text-xs text-fg-subtle">E-posta {{ emailedAt() }} tarihinde gönderildi.</p>
          }
        </div>
      }
    </article>
  `,
})
export class DigestCard {
  private readonly api = inject(Api);
  private readonly store = inject(AppStore);
  private readonly toast = inject(ToastService);

  readonly digest = input.required<Digest>();
  readonly expanded = input(false);
  readonly toggled = output<void>();
  readonly previewEmail = output<Digest>();

  protected readonly busy = signal(false);
  protected readonly confirmDelete = signal(false);
  protected readonly showAllChapters = signal(false);
  protected readonly chapterLimit = 8;

  protected readonly status = computed(() => STATUS[this.digest().status]);
  protected readonly statusLabel = computed(() => {
    const d = this.digest();
    if (d.status === 'queued' && d.nextAttemptAt) return 'Tekrar denenecek';
    if (d.status === 'ready' && d.statusNote) return 'Gönderilmedi';
    return STATUS[d.status].label;
  });
  protected readonly when = computed(() => relativeTime(this.digest().publishedAt, this.store.now()));
  protected readonly published = computed(() => absoluteTime(this.digest().publishedAt));
  protected readonly emailedAt = computed(() => absoluteTime(this.digest().emailedAt));
  protected readonly length = computed(() => duration(this.digest().durationSeconds));
  protected readonly basis = computed(() => BASIS[this.digest().summary?.basis ?? 'none']);
  protected readonly preview = computed(() => {
    const d = this.digest();
    return d.summary?.tldr || d.summary?.paragraphs[0] || d.statusNote || '';
  });

  protected readonly visibleChapters = computed(() => {
    const chapters = this.digest().summary?.chapters ?? [];
    return this.showAllChapters() ? chapters : chapters.slice(0, this.chapterLimit);
  });

  async act(action: 'resend' | 'regenerate'): Promise<void> {
    this.busy.set(true);
    try {
      this.store.apply(await this.api.digestAction(this.digest().id, action));
      this.toast.show(action === 'resend' ? 'E-posta gönderiliyor…' : 'Özet yeniden hazırlanıyor…');
    } catch (err) {
      this.toast.error(apiError(err));
    } finally {
      this.busy.set(false);
    }
  }

  async remove(): Promise<void> {
    if (!this.confirmDelete()) {
      this.confirmDelete.set(true);
      setTimeout(() => this.confirmDelete.set(false), 3000);
      return;
    }
    this.busy.set(true);
    try {
      this.store.apply(await this.api.removeDigest(this.digest().id));
    } catch (err) {
      this.toast.error(apiError(err));
    } finally {
      this.busy.set(false);
    }
  }
}
