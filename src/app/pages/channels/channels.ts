import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { Channel } from '../../../shared/types';
import { Api, apiError } from '../../core/api';
import { absoluteTime, relativeTime } from '../../core/format';
import { AppStore } from '../../core/store';
import { ToastService } from '../../core/ui-services';
import { Avatar } from '../../ui/controls';
import { Icon } from '../../ui/icon';
import { ChannelAdd } from './channel-add';

type Sort = 'recent' | 'name' | 'added';

@Component({
  selector: 'app-channels',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Avatar, ChannelAdd, NgTemplateOutlet],
  template: `
    <header class="mb-6">
      <h1 class="text-2xl font-semibold tracking-tight">Kanallar</h1>
      <p class="mt-1 text-sm text-fg-muted">Yeni video yüklediklerinde özet e-postası alacağın kanallar.</p>
    </header>

    <app-channel-add />

    <section class="mt-8" aria-labelledby="list-title">
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <h2 id="list-title" class="mr-auto text-[15px] font-semibold">
          Takip edilenler <span class="kbd-mono ml-1 text-sm font-normal text-fg-subtle">{{ store.channels().length }}</span>
        </h2>
        @if (store.channels().length > 6) {
          <div class="relative w-full sm:w-56">
            <span class="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-fg-subtle"><app-icon name="search" [size]="14" /></span>
            <input
              class="input h-8 pl-8 text-[13px]"
              type="search"
              placeholder="Listede ara"
              aria-label="Takip edilen kanallarda ara"
              [value]="filter()"
              (input)="filter.set($any($event.target).value)"
            />
          </div>
        }
        @if (store.channels().length > 1) {
          <select
            class="input h-8 w-auto pr-8 text-[13px]"
            aria-label="Sıralama"
            [value]="sort()"
            (change)="sort.set($any($event.target).value)"
          >
            <option value="recent">Son yüklemeye göre</option>
            <option value="name">İsme göre</option>
            <option value="added">Eklenme sırasına göre</option>
          </select>
        }
      </div>

      @if (store.channels().length === 0) {
        <div class="card flex flex-col items-center px-6 py-12 text-center">
          <span class="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-2 text-fg-muted"><app-icon name="tv" [size]="20" /></span>
          <p class="mt-3 text-sm font-medium">Henüz kanal yok</p>
          <p class="mt-1 max-w-xs text-[13px] text-fg-muted">Yukarıdaki kutuya bir kanal adı yazarak ya da linkini yapıştırarak başla.</p>
        </div>
      } @else {
        <ul class="card divide-y divide-line">
          @for (ch of list(); track ch.id) {
            <li class="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-3 sm:flex-nowrap sm:px-4" [class.opacity-60]="ch.paused">
              <a [href]="channelUrl(ch)" target="_blank" rel="noopener" class="shrink-0" [attr.aria-label]="ch.name + ' YouTube kanalı'">
                <app-avatar [src]="ch.avatar" [name]="ch.name" [size]="40" />
              </a>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <a [href]="channelUrl(ch)" target="_blank" rel="noopener" class="truncate text-sm font-semibold hover:underline">{{ ch.name }}</a>
                  @if (ch.paused) {
                    <span class="badge shrink-0">Duraklatıldı</span>
                  }
                  @if (ch.lastError) {
                    <span class="shrink-0 text-warning" [title]="'Son kontrolde hata: ' + ch.lastError">
                      <app-icon name="alert" [size]="14" />
                    </span>
                  }
                </div>
                <p class="truncate text-xs text-fg-muted">
                  {{ subtitle(ch) }}
                </p>
                @if (ch.lastVideo; as v) {
                  <ng-container *ngTemplateOutlet="lastVideo; context: { $implicit: v, cls: 'mt-1 hidden sm:flex' }" />
                }
              </div>
              <div class="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  class="btn btn-ghost btn-icon btn-sm"
                  title="Son videoyu şimdi özetle"
                  aria-label="Son videoyu şimdi özetle"
                  [disabled]="busy().has(ch.id)"
                  (click)="summarize(ch)"
                >
                  <app-icon [name]="busy().has(ch.id) ? 'spinner' : 'sparkles'" [size]="16" />
                </button>
                <button
                  type="button"
                  class="btn btn-ghost btn-icon btn-sm"
                  [title]="ch.paused ? 'Takibi sürdür' : 'Takibi duraklat'"
                  [attr.aria-label]="ch.paused ? 'Takibi sürdür' : 'Takibi duraklat'"
                  (click)="togglePause(ch)"
                >
                  <app-icon [name]="ch.paused ? 'play' : 'pause'" [size]="15" />
                </button>
                <button
                  type="button"
                  class="btn btn-sm"
                  [class]="confirming() === ch.id ? 'btn-danger' : 'btn-ghost btn-icon'"
                  [title]="confirming() === ch.id ? '' : 'Takipten çıkar'"
                  aria-label="Takipten çıkar"
                  (click)="remove(ch)"
                >
                  <app-icon name="trash" [size]="15" />
                  @if (confirming() === ch.id) {
                    <span>Çıkar</span>
                  }
                </button>
              </div>
              @if (ch.lastVideo; as v) {
                <ng-container *ngTemplateOutlet="lastVideo; context: { $implicit: v, cls: 'flex basis-full pl-[52px] sm:hidden' }" />
              }
            </li>
          } @empty {
            <li class="px-4 py-8 text-center text-sm text-fg-muted">"{{ filter() }}" ile eşleşen kanal yok.</li>
          }
        </ul>
        <p class="mt-3 text-xs leading-relaxed text-fg-subtle">
          Bir kanal eklendiğinde mevcut videoları için e-posta gönderilmez; yalnızca sonrasında yüklenenler özetlenir.
          <app-icon name="sparkles" [size]="11" class="mx-0.5 align-[-1px]" /> ile son videoyu beklemeden özetleyebilirsin.
        </p>
      }
    </section>

    <ng-template #lastVideo let-v let-cls="cls">
      <p class="min-w-0 items-center gap-1.5 text-[12.5px] text-fg-subtle" [class]="cls">
        <app-icon name="play" [size]="11" class="shrink-0" />
        <a [href]="'https://www.youtube.com/watch?v=' + v.id" target="_blank" rel="noopener" class="truncate hover:text-fg" [title]="v.title">{{ v.title }}</a>
        <span class="shrink-0" [title]="exact(v.publishedAt)">· {{ ago(v.publishedAt) }}</span>
      </p>
    </ng-template>
  `,
})
export class Channels {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly store = inject(AppStore);

  protected readonly filter = signal('');
  protected readonly sort = signal<Sort>('recent');
  protected readonly busy = signal(new Set<string>());
  protected readonly confirming = signal<string | null>(null);
  private confirmTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly list = computed(() => {
    const q = this.filter().trim().toLocaleLowerCase('tr');
    const items = this.store
      .channels()
      .filter((c) => !q || c.name.toLocaleLowerCase('tr').includes(q) || c.handle.toLowerCase().includes(q));
    const sort = this.sort();
    return [...items].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name, 'tr');
      if (sort === 'added') return b.addedAt.localeCompare(a.addedAt);
      return (b.lastVideo?.publishedAt ?? '').localeCompare(a.lastVideo?.publishedAt ?? '');
    });
  });

  channelUrl(ch: Channel): string {
    return ch.handle ? `https://www.youtube.com/${ch.handle}` : `https://www.youtube.com/channel/${ch.id}`;
  }

  subtitle(ch: Channel): string {
    return [ch.handle, ch.subscribers].filter(Boolean).join(' · ') || ch.id;
  }

  ago(iso: string): string {
    return relativeTime(iso, this.store.now());
  }

  exact(iso: string): string {
    return absoluteTime(iso);
  }

  async summarize(ch: Channel): Promise<void> {
    this.busy.update((s) => new Set(s).add(ch.id));
    try {
      const { state } = await this.api.summarizeVideo(ch.id, null, false);
      this.store.apply(state);
      this.toast.success(`${ch.name} kanalının son videosu özetleniyor.`, {
        label: 'Akışta gör',
        run: () => void this.router.navigateByUrl('/'),
      });
    } catch (err) {
      this.toast.error(apiError(err));
    } finally {
      this.busy.update((s) => {
        const next = new Set(s);
        next.delete(ch.id);
        return next;
      });
    }
  }

  async togglePause(ch: Channel): Promise<void> {
    try {
      this.store.apply(await this.api.setChannelPaused(ch.id, !ch.paused));
    } catch (err) {
      this.toast.error(apiError(err));
    }
  }

  async remove(ch: Channel): Promise<void> {
    if (this.confirming() !== ch.id) {
      this.confirming.set(ch.id);
      if (this.confirmTimer) clearTimeout(this.confirmTimer);
      this.confirmTimer = setTimeout(() => this.confirming.set(null), 3000);
      return;
    }
    this.confirming.set(null);
    try {
      this.store.apply(await this.api.removeChannel(ch.id));
      this.toast.show(`${ch.name} takipten çıkarıldı.`);
    } catch (err) {
      this.toast.error(apiError(err));
    }
  }
}
