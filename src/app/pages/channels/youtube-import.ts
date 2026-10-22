import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { BulkAddResult } from '../../../shared/types';
import { Api, apiError } from '../../core/api';
import { AppStore } from '../../core/store';
import { ToastService } from '../../core/ui-services';
import { Avatar } from '../../ui/controls';
import { Icon } from '../../ui/icon';
import type { SubscriptionChannel } from '../../youtube-oauth';

type Step = 'idle' | 'auth' | 'list' | 'adding' | 'done';

/** Google hesabıyla giriş yapıp aboneliklerden seçerek kanal ekleme. */
@Component({
  selector: 'app-youtube-import',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Avatar],
  template: `
    <div class="rounded-xl border border-line bg-surface-2/60 p-3.5">
      @switch (step()) {
        @case ('idle') {
          <p class="text-[13px] leading-relaxed text-fg-muted">
            Google hesabınla giriş yap; abone olduğun kanallar listelenir, istediklerini seçip eklersin. Erişim yalnızca okuma
            izniyle ve bu tarayıcıda kalır.
          </p>
          @if (error()) {
            <div class="mt-3 rounded-lg bg-accent-soft px-3 py-2.5 text-[13px] text-accent-text">
              {{ error() }}
              @if (enableUrl()) {
                <a [href]="enableUrl()" target="_blank" rel="noopener" class="mt-1 block font-medium underline underline-offset-2">
                  API'yi etkinleştir →
                </a>
              }
            </div>
          }
          <button type="button" class="btn btn-secondary btn-sm mt-3" (click)="start()">
            <svg width="15" height="15" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
              <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/>
            </svg>
            Google ile bağlan
          </button>
        }
        @case ('auth') {
          <p class="flex items-center gap-2 text-[13px] text-fg-muted"><app-icon name="spinner" [size]="14" /> Abonelikler getiriliyor…</p>
        }
        @case ('list') {
          <div class="flex flex-wrap items-center gap-2">
            <input
              class="input h-9 flex-1 text-sm"
              type="search"
              placeholder="Aboneliklerde ara"
              aria-label="Aboneliklerde ara"
              [value]="filter()"
              (input)="filter.set($any($event.target).value)"
            />
            <button type="button" class="btn btn-ghost btn-sm" (click)="toggleAll()">
              {{ allVisibleSelected() ? 'Seçimi kaldır' : 'Tümünü seç' }}
            </button>
          </div>
          <p class="mt-2 text-xs text-fg-subtle">{{ subs().length }} abonelik · {{ available().length }} tanesi henüz takipte değil</p>
          <ul class="mt-2 max-h-[320px] overflow-y-auto rounded-lg border border-line bg-surface">
            @for (c of visible(); track c.id) {
              <li>
                <label class="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-surface-2" [class.opacity-50]="isFollowing(c.id)">
                  <input
                    type="checkbox"
                    class="h-4 w-4 accent-[var(--ink)]"
                    [checked]="selected().has(c.id) || isFollowing(c.id)"
                    [disabled]="isFollowing(c.id)"
                    (change)="toggle(c.id)"
                  />
                  <app-avatar [src]="c.avatar" [name]="c.name" [size]="28" />
                  <span class="min-w-0 flex-1 truncate text-sm">{{ c.name }}</span>
                  @if (isFollowing(c.id)) {
                    <span class="text-xs text-fg-subtle">Takipte</span>
                  }
                </label>
              </li>
            } @empty {
              <li class="px-3 py-6 text-center text-sm text-fg-muted">Eşleşen abonelik yok.</li>
            }
          </ul>
          <div class="mt-3 flex items-center gap-2">
            <button type="button" class="btn btn-primary btn-sm" [disabled]="selected().size === 0" (click)="addSelected()">
              {{ selected().size > 0 ? selected().size + ' kanalı ekle' : 'Kanal seç' }}
            </button>
            <button type="button" class="btn btn-ghost btn-sm" (click)="reset()">Vazgeç</button>
          </div>
        }
        @case ('adding') {
          <p class="flex items-center gap-2 text-[13px] text-fg-muted">
            <app-icon name="spinner" [size]="14" /> {{ selected().size }} kanal ekleniyor, her biri doğrulanıyor…
          </p>
        }
        @case ('done') {
          @if (result(); as r) {
            <p class="text-[13px] font-medium">{{ r.added.length }} kanal eklendi{{ r.skipped.length ? ', ' + r.skipped.length + ' atlandı' : '' }}.</p>
            @if (r.skipped.length > 0) {
              <ul class="mt-1.5 space-y-0.5 text-[13px] text-fg-muted">
                @for (s of r.skipped; track s.input) {
                  <li>{{ nameOf(s.input) }} — {{ s.reason }}</li>
                }
              </ul>
            }
          }
          <button type="button" class="btn btn-ghost btn-sm mt-2" (click)="step.set('list')">Listeye dön</button>
        }
      }
    </div>
  `,
})
export class YoutubeImport {
  private readonly api = inject(Api);
  private readonly store = inject(AppStore);
  private readonly toast = inject(ToastService);

  protected readonly step = signal<Step>('idle');
  protected readonly error = signal<string | null>(null);
  protected readonly enableUrl = signal<string | null>(null);
  protected readonly subs = signal<SubscriptionChannel[]>([]);
  protected readonly selected = signal(new Set<string>());
  protected readonly filter = signal('');
  protected readonly result = signal<BulkAddResult | null>(null);

  private readonly following = computed(() => new Set(this.store.channels().map((c) => c.id)));
  protected readonly available = computed(() => this.subs().filter((c) => !this.following().has(c.id)));
  protected readonly visible = computed(() => {
    const q = this.filter().trim().toLocaleLowerCase('tr');
    return q ? this.subs().filter((c) => c.name.toLocaleLowerCase('tr').includes(q)) : this.subs();
  });
  protected readonly allVisibleSelected = computed(() => {
    const candidates = this.visible().filter((c) => !this.following().has(c.id));
    return candidates.length > 0 && candidates.every((c) => this.selected().has(c.id));
  });

  isFollowing(id: string): boolean {
    return this.following().has(id);
  }

  nameOf(id: string): string {
    return this.subs().find((s) => s.id === id)?.name ?? id;
  }

  async start(): Promise<void> {
    this.error.set(null);
    this.enableUrl.set(null);
    this.step.set('auth');
    try {
      const oauth = await import('../../youtube-oauth');
      try {
        const token = await oauth.signInForYoutube();
        this.subs.set(await oauth.fetchSubscriptions(token));
        this.step.set('list');
      } catch (err) {
        if (err instanceof oauth.YoutubeApiDisabledError) this.enableUrl.set(oauth.enableYoutubeApiUrl());
        throw err;
      } finally {
        void oauth.signOutGoogle();
      }
    } catch (err) {
      const code = (err as { code?: string })?.code ?? '';
      this.error.set(
        code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request'
          ? 'Giriş penceresi kapatıldı.'
          : code === 'auth/popup-blocked'
            ? 'Tarayıcı açılır pencereyi engelledi. İzin verip tekrar dene.'
            : code === 'auth/unauthorized-domain'
              ? 'Bu alan adı Firebase yetkili alan adları listesinde değil.'
              : apiError(err),
      );
      this.step.set('idle');
    }
  }

  toggle(id: string): void {
    this.selected.update((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  toggleAll(): void {
    const candidates = this.visible().filter((c) => !this.following().has(c.id));
    const all = this.allVisibleSelected();
    this.selected.update((s) => {
      const next = new Set(s);
      for (const c of candidates) {
        if (all) next.delete(c.id);
        else next.add(c.id);
      }
      return next;
    });
  }

  async addSelected(): Promise<void> {
    this.step.set('adding');
    try {
      const { result, state } = await this.api.addChannelsBulk([...this.selected()]);
      this.store.apply(state);
      this.result.set(result);
      this.selected.set(new Set());
      this.step.set('done');
      if (result.added.length > 0) this.toast.success(`${result.added.length} kanal takibe alındı.`);
    } catch (err) {
      this.toast.error(apiError(err));
      this.step.set('list');
    }
  }

  reset(): void {
    this.subs.set([]);
    this.selected.set(new Set());
    this.step.set('idle');
  }
}
