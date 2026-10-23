import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import type { BulkAddResult } from '../../../shared/types';
import { Api, apiError } from '../../core/api';
import { AppStore } from '../../core/store';
import { ToastService } from '../../core/ui-services';
import { Avatar } from '../../ui/controls';
import { Icon } from '../../ui/icon';
import {
  checkAuthorizedDomain,
  enableYoutubeApiUrl,
  firebaseAuthSettingsUrl,
  firebaseSignInMethodsUrl,
  parseTakeoutCsv,
  type SubscriptionChannel,
} from './import-helpers';

type Step = 'idle' | 'auth' | 'list' | 'adding' | 'done';
type OauthModule = typeof import('../../youtube-oauth');

const CHUNK = 20;

/**
 * YouTube aboneliklerinden kanal seçip ekleme. İki yol var:
 * 1) Google hesabıyla bağlanmak (Firebase girişi + YouTube Data API),
 * 2) Google Takeout'tan indirilen abonelik dosyasını yüklemek (kurulum gerektirmez).
 */
@Component({
  selector: 'app-youtube-import',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Avatar],
  template: `
    <div class="rounded-xl border border-line bg-surface-2/60 p-3.5">
      @switch (step()) {
        @case ('idle') {
          <!-- 1. yol: Google hesabı -->
          <p class="text-[13px] font-semibold text-fg">Google hesabınla bağlan</p>
          <p class="mt-1 text-[13px] leading-relaxed text-fg-muted">
            Abone olduğun kanallar listelenir, istediklerini seçip eklersin. Yalnızca okuma izni istenir; erişim bu tarayıcıda kalır.
          </p>

          @if (domainOk() === false) {
            <div class="mt-3 rounded-lg border border-warning/40 bg-warning-soft px-3 py-3 text-[13px] leading-relaxed text-warning-text">
              <p class="font-medium">Bu adreste Google ile giriş için bir kerelik ayar gerekiyor</p>
              <p class="mt-1">
                Giriş, AI Studio'nun senin hesabında açtığı Firebase projesi üzerinden yapılıyor ve
                <code class="kbd-mono">{{ hostname }}</code> adresi henüz izinli değil.
              </p>
              <ol class="mt-2 list-decimal space-y-1 pl-5">
                <li>
                  <a [href]="authSettingsUrl" target="_blank" rel="noopener" class="font-medium underline underline-offset-2">Firebase konsolunu aç</a>
                  → <b>Authorized domains</b> → <b>Add domain</b> → <code class="kbd-mono">{{ hostname }}</code> yaz → <b>Add</b>.
                </li>
                <li>
                  <a [href]="youtubeApiUrl" target="_blank" rel="noopener" class="font-medium underline underline-offset-2">YouTube Data API v3</a>
                  sayfasında <b>Enable / Etkinleştir</b>'e bas (zaten etkinse geç).
                </li>
                <li>Birkaç dakika bekleyip aşağıdaki "Tekrar kontrol et"e bas.</li>
              </ol>
              <button type="button" class="btn btn-secondary btn-sm mt-3" [disabled]="checking()" (click)="checkDomain()">
                <app-icon [name]="checking() ? 'spinner' : 'refresh'" [size]="14" /> Tekrar kontrol et
              </button>
            </div>
          }

          @if (error()) {
            <div class="mt-3 rounded-lg bg-accent-soft px-3 py-2.5 text-[13px] text-accent-text" role="alert">
              {{ error() }}
              @if (errorLink(); as l) {
                <a [href]="l.url" target="_blank" rel="noopener" class="mt-1 block font-medium underline underline-offset-2">{{ l.label }} →</a>
              }
            </div>
          }

          <button type="button" class="btn btn-secondary btn-sm mt-3" [disabled]="domainOk() === false || checking()" (click)="start()">
            <svg width="15" height="15" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
              <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/>
            </svg>
            Google ile bağlan
          </button>

          <!-- 2. yol: Takeout dosyası -->
          <div class="my-4 flex items-center gap-3 text-xs text-fg-subtle">
            <span class="h-px flex-1 bg-line"></span>ya da<span class="h-px flex-1 bg-line"></span>
          </div>
          <p class="text-[13px] font-semibold text-fg">Google Takeout dosyasını yükle</p>
          <p class="mt-1 text-[13px] leading-relaxed text-fg-muted">
            Hiçbir ayar gerektirmez. Google'dan abonelik listeni indirip buraya yüklersin.
          </p>
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <label class="btn btn-secondary btn-sm cursor-pointer">
              <app-icon name="file" [size]="14" /> abonelikler.csv seç
              <input type="file" accept=".csv,text/csv" class="sr-only" (change)="onFile($event)" />
            </label>
            <button type="button" class="btn btn-ghost btn-sm" [attr.aria-expanded]="showTakeoutHelp()" (click)="showTakeoutHelp.set(!showTakeoutHelp())">
              <app-icon [name]="showTakeoutHelp() ? 'chevron-down' : 'chevron-right'" [size]="14" /> Dosya nasıl indirilir?
            </button>
          </div>
          @if (showTakeoutHelp()) {
            <ol class="animate-fade-up mt-2 list-decimal space-y-1 pl-5 text-[13px] leading-relaxed text-fg-muted">
              <li>
                <a href="https://takeout.google.com/" target="_blank" rel="noopener" class="font-medium text-fg underline underline-offset-2">takeout.google.com</a>
                adresine gir, <b>Tümünün seçimini kaldır</b>'a bas.
              </li>
              <li>Listeden yalnızca <b>YouTube ve YouTube Music</b>'i işaretle.</li>
              <li><b>Tüm YouTube verileri dahil</b> düğmesine bas, sadece <b>abonelikler</b> kalsın.</li>
              <li><b>Sonraki adım → Dışa aktarma oluştur</b>. Birkaç dakika içinde e-postana bir indirme linki gelir.</li>
              <li>İnen zip'i aç: <code class="kbd-mono text-fg">YouTube ve YouTube Music/abonelikler/abonelikler.csv</code> dosyasını buraya yükle.</li>
            </ol>
          }
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
          <p class="mt-2 text-xs text-fg-subtle">
            {{ source() }} · {{ subs().length }} abonelik · {{ available().length }} tanesi henüz takipte değil
          </p>
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
            <app-icon name="spinner" [size]="14" /> Kanallar ekleniyor: {{ progress() }} / {{ selected().size }}
          </p>
          <div class="mt-2 h-1 overflow-hidden rounded-full bg-surface-3">
            <div class="h-full rounded-full bg-ink/70 transition-[width]" [style.width.%]="(progress() / (selected().size || 1)) * 100"></div>
          </div>
        }
        @case ('done') {
          @if (result(); as r) {
            <p class="text-[13px] font-medium">{{ r.added.length }} kanal eklendi{{ r.skipped.length ? ', ' + r.skipped.length + ' atlandı' : '' }}.</p>
            @if (r.skipped.length > 0) {
              <ul class="mt-1.5 max-h-40 space-y-0.5 overflow-y-auto text-[13px] text-fg-muted">
                @for (s of r.skipped; track s.input) {
                  <li>{{ nameOf(s.input) }} — {{ s.reason }}</li>
                }
              </ul>
            }
          }
          <div class="mt-2 flex gap-2">
            <button type="button" class="btn btn-ghost btn-sm" (click)="backToList()">Listeye dön</button>
            <button type="button" class="btn btn-ghost btn-sm" (click)="reset()">Kapat</button>
          </div>
        }
      }
    </div>
  `,
})
export class YoutubeImport implements OnInit {
  private readonly api = inject(Api);
  private readonly store = inject(AppStore);
  private readonly toast = inject(ToastService);

  protected readonly hostname = window.location.hostname;
  protected readonly authSettingsUrl = firebaseAuthSettingsUrl();
  protected readonly youtubeApiUrl = enableYoutubeApiUrl();

  protected readonly step = signal<Step>('idle');
  protected readonly error = signal<string | null>(null);
  protected readonly errorLink = signal<{ url: string; label: string } | null>(null);
  protected readonly domainOk = signal<boolean | null>(null);
  protected readonly checking = signal(false);
  protected readonly showTakeoutHelp = signal(false);
  protected readonly source = signal('');
  protected readonly subs = signal<SubscriptionChannel[]>([]);
  protected readonly selected = signal(new Set<string>());
  protected readonly filter = signal('');
  protected readonly progress = signal(0);
  protected readonly result = signal<BulkAddResult | null>(null);

  // Firebase modülü panel açılınca önceden yüklenir; böylece "Google ile bağlan"
  // tıklamasıyla giriş penceresi arasında gecikme olmaz ve tarayıcı pencereyi engellemez.
  private oauthModule: Promise<OauthModule> | null = null;

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

  ngOnInit(): void {
    this.oauthModule = import('../../youtube-oauth');
    this.oauthModule.catch(() => undefined);
    void this.checkDomain();
  }

  async checkDomain(): Promise<void> {
    this.checking.set(true);
    this.domainOk.set(await checkAuthorizedDomain(this.hostname));
    this.checking.set(false);
  }

  isFollowing(id: string): boolean {
    return this.following().has(id);
  }

  nameOf(id: string): string {
    return this.subs().find((s) => s.id === id)?.name ?? id;
  }

  private fail(message: string, link: { url: string; label: string } | null = null): void {
    this.error.set(message);
    this.errorLink.set(link);
    this.step.set('idle');
  }

  async start(): Promise<void> {
    this.error.set(null);
    this.errorLink.set(null);
    this.step.set('auth');
    let oauth: OauthModule;
    try {
      oauth = await (this.oauthModule ?? import('../../youtube-oauth'));
    } catch {
      this.fail('Google giriş modülü yüklenemedi. Sayfayı yenileyip tekrar dene.');
      return;
    }
    try {
      const token = await oauth.signInForYoutube();
      const list = await oauth.fetchSubscriptions(token);
      this.showList(list, 'Google hesabı');
    } catch (err) {
      const code = (err as { code?: string })?.code ?? '';
      if (err instanceof oauth.YoutubeApiDisabledError) {
        this.fail('YouTube Data API, AI Studio\'nun açtığı Google Cloud projesinde kapalı.', {
          url: this.youtubeApiUrl,
          label: 'YouTube Data API\'yi etkinleştir',
        });
      } else if (code === 'auth/unauthorized-domain') {
        this.domainOk.set(false);
        this.step.set('idle');
      } else if (code === 'auth/operation-not-allowed') {
        this.fail('Firebase projesinde Google ile giriş kapalı. Sign-in method sekmesinde Google\'ı etkinleştir.', {
          url: firebaseSignInMethodsUrl(),
          label: 'Firebase giriş yöntemlerini aç',
        });
      } else if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        this.fail('Giriş penceresi kapatıldı.');
      } else if (code === 'auth/popup-blocked') {
        this.fail('Tarayıcı açılır pencereyi engelledi. Adres çubuğundan bu siteye izin verip tekrar dene.');
      } else if (code === 'auth/network-request-failed') {
        this.fail('Google\'a bağlanılamadı. İnternet bağlantını kontrol et.');
      } else {
        this.fail(`${apiError(err)}${code ? ` (${code})` : ''}`);
      }
    } finally {
      void oauth.signOutGoogle();
    }
  }

  async onFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.error.set(null);
    this.errorLink.set(null);
    if (file.size > 5_000_000) {
      this.fail('Dosya çok büyük. Takeout zip\'inin içindeki abonelikler.csv dosyasını seç.');
      return;
    }
    const list = parseTakeoutCsv(await file.text());
    if (list.length === 0) {
      this.fail('Dosyada kanal bulunamadı. Takeout zip\'inin içindeki abonelikler.csv (subscriptions.csv) dosyasını seçtiğinden emin ol.');
      return;
    }
    this.showList(list, file.name);
  }

  private showList(list: SubscriptionChannel[], source: string): void {
    this.subs.set(list);
    this.source.set(source);
    this.selected.set(new Set());
    this.filter.set('');
    this.step.set('list');
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

  /** Sunucu her kanalı tek tek doğruladığı için küçük parçalar halinde gönderilir. */
  async addSelected(): Promise<void> {
    const ids = [...this.selected()];
    const total: BulkAddResult = { added: [], skipped: [] };
    this.progress.set(0);
    this.step.set('adding');
    try {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const { result, state } = await this.api.addChannelsBulk(ids.slice(i, i + CHUNK));
        this.store.apply(state);
        total.added.push(...result.added);
        total.skipped.push(...result.skipped);
        this.progress.set(Math.min(ids.length, i + CHUNK));
      }
      if (total.added.length > 0) this.toast.success(`${total.added.length} kanal takibe alındı.`);
    } catch (err) {
      this.toast.error(apiError(err));
    }
    this.result.set(total);
    this.selected.set(new Set());
    this.step.set('done');
  }

  backToList(): void {
    this.step.set('list');
  }

  reset(): void {
    this.subs.set([]);
    this.selected.set(new Set());
    this.error.set(null);
    this.errorLink.set(null);
    this.step.set('idle');
  }
}
