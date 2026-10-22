import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Digest, DigestStatus, LogLevel } from '../../../shared/types';
import { relativeTime } from '../../core/format';
import { AppStore } from '../../core/store';
import { Icon } from '../../ui/icon';
import { DigestCard } from './digest-card';
import { EmailPreview } from './email-preview';

type Filter = 'all' | 'sent' | 'pending' | 'failed' | 'skipped';

const FILTER_STATUSES: Record<Exclude<Filter, 'all'>, DigestStatus[]> = {
  sent: ['sent', 'ready'],
  pending: ['queued', 'processing', 'waiting'],
  failed: ['failed'],
  skipped: ['skipped'],
};

const DISMISS_KEY = 'ozetci.setupDismissed';

@Component({
  selector: 'app-feed',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, RouterLink, DigestCard, EmailPreview],
  template: `
    <header class="mb-6">
      <h1 class="text-2xl font-semibold tracking-tight">Akış</h1>
      <p class="mt-1 text-sm text-fg-muted">Takip ettiğin kanalların yeni videoları ve özetleri.</p>
    </header>

    @if (showSetup()) {
      <section class="card mb-6 p-4 sm:p-5" aria-labelledby="setup-title">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 id="setup-title" class="text-[15px] font-semibold">Kurulumu tamamla</h2>
            <p class="mt-0.5 text-[13px] text-fg-muted">{{ setupDone() }}/4 adım tamam</p>
          </div>
          @if (requiredDone()) {
            <button type="button" class="btn btn-ghost btn-sm -mr-2 -mt-1" (click)="dismissSetup()">Gizle</button>
          }
        </div>
        <div class="mt-3 h-1 overflow-hidden rounded-full bg-surface-3">
          <div class="h-full rounded-full bg-success transition-[width] duration-500" [style.width.%]="setupDone() * 25"></div>
        </div>
        <ul class="mt-4 divide-y divide-line">
          @for (step of setupSteps(); track step.key) {
            <li class="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <span
                class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border"
                [class]="step.done ? 'border-success bg-success text-white' : 'border-line-strong text-transparent'"
              >
                <app-icon name="check" [size]="12" [stroke]="2.6" />
              </span>
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium" [class.text-fg-muted]="step.done" [class.line-through]="step.done">{{ step.title }}</p>
                @if (!step.done) {
                  <p class="mt-0.5 text-[13px] leading-snug text-fg-muted">{{ step.hint }}</p>
                }
              </div>
              @if (!step.done && step.link) {
                <a [routerLink]="step.link" [fragment]="step.fragment" class="btn btn-secondary btn-sm shrink-0">{{ step.cta }}</a>
              }
            </li>
          }
        </ul>
      </section>
    }

    <section class="mb-6 grid grid-cols-3 divide-x divide-line overflow-hidden rounded-[14px] border border-line bg-surface shadow-card">
      @for (stat of stats(); track stat.label) {
        <div class="px-3 py-3.5 sm:px-5 sm:py-4">
          <p class="text-xl font-semibold tabular-nums tracking-tight sm:text-2xl">{{ stat.value }}</p>
          <p class="mt-0.5 text-[12px] leading-tight text-fg-muted sm:text-[13px]">{{ stat.label }}</p>
        </div>
      }
    </section>

    @if (store.digests().length > 0) {
      <div class="-mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" role="tablist" aria-label="Filtre">
        @for (f of filters(); track f.key) {
          <button
            type="button"
            role="tab"
            [attr.aria-selected]="filter() === f.key"
            (click)="filter.set(f.key)"
            class="flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors"
            [class]="filter() === f.key ? 'border-ink bg-ink text-ink-fg' : 'border-line bg-surface text-fg-muted hover:text-fg'"
          >
            {{ f.label }}
            <span class="kbd-mono text-[11px] opacity-70">{{ f.count }}</span>
          </button>
        }
      </div>

      <div class="flex flex-col gap-3">
        @for (d of visible(); track d.id) {
          <app-digest-card [digest]="d" [expanded]="openId() === d.id" (toggled)="toggle(d.id)" (previewEmail)="previewing.set($event)" />
        } @empty {
          <p class="card px-4 py-10 text-center text-sm text-fg-muted">Bu filtrede video yok.</p>
        }
      </div>
    } @else {
      <section class="card flex flex-col items-center px-6 py-14 text-center">
        <span class="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2 text-fg-muted">
          <app-icon name="inbox" [size]="22" />
        </span>
        <h2 class="mt-4 text-base font-semibold">Henüz özet yok</h2>
        <p class="mt-1.5 max-w-sm text-sm leading-relaxed text-fg-muted">
          @if (store.channels().length === 0) {
            Önce takip etmek istediğin kanalları ekle. Yeni video yüklediklerinde özetleri burada ve e-posta kutunda göreceksin.
          } @else {
            {{ store.channels().length }} kanal izleniyor. Yeni video geldiğinde özeti burada görünecek. Beklemek istemiyorsan
            bir kanalın son videosunu hemen özetleyebilirsin.
          }
        </p>
        <a routerLink="/kanallar" class="btn btn-primary mt-5">
          @if (store.channels().length === 0) {
            <app-icon name="plus" /> Kanal ekle
          } @else {
            <app-icon name="sparkles" /> Son videoyu özetle
          }
        </a>
      </section>
    }

    @if (store.logs().length > 0) {
      <section class="mt-10" aria-labelledby="log-title">
        <div class="mb-2 flex items-center justify-between">
          <h2 id="log-title" class="text-[13px] font-semibold text-fg-muted">Etkinlik</h2>
          @if (store.logs().length > 6) {
            <button type="button" class="text-[13px] font-medium text-fg-muted hover:text-fg" (click)="showAllLogs.set(!showAllLogs())">
              {{ showAllLogs() ? 'Daha az' : 'Tümünü göster' }}
            </button>
          }
        </div>
        <ol class="card divide-y divide-line">
          @for (log of logs(); track log.id) {
            <li class="flex items-start gap-3 px-4 py-2.5">
              <span class="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" [class]="logDot(log.level)"></span>
              <p class="min-w-0 flex-1 text-[13px] leading-relaxed text-fg">{{ log.message }}</p>
              <time class="shrink-0 pt-px text-xs text-fg-subtle" [attr.datetime]="log.at">{{ ago(log.at) }}</time>
            </li>
          }
        </ol>
      </section>
    }

    @if (previewing(); as p) {
      <app-email-preview [digest]="p" (closed)="previewing.set(null)" />
    }
  `,
})
export class Feed {
  protected readonly store = inject(AppStore);

  protected readonly filter = signal<Filter>('all');
  protected readonly openId = signal<string | null>(null);
  protected readonly previewing = signal<Digest | null>(null);
  protected readonly showAllLogs = signal(false);
  protected readonly setupDismissed = signal(this.readDismissed());

  protected readonly setupSteps = computed(() => {
    const s = this.store.status()?.setup;
    return [
      {
        key: 'channels',
        done: Boolean(s?.channels),
        title: 'Takip edilecek kanalları ekle',
        hint: 'Arayarak, link yapıştırarak ya da YouTube aboneliklerinden aktararak ekleyebilirsin.',
        link: '/kanallar',
        fragment: undefined,
        cta: 'Kanal ekle',
      },
      {
        key: 'email',
        done: Boolean(s?.email),
        title: 'E-posta gönderimini ayarla',
        hint: 'Gmail adresin ve 16 haneli uygulama şifren gerekiyor.',
        link: '/ayarlar',
        fragment: 'e-posta',
        cta: 'Ayarla',
      },
      {
        key: 'gemini',
        done: Boolean(s?.gemini),
        title: 'Gemini API anahtarı',
        hint: 'Sunucuda GEMINI_API_KEY tanımlı değil. AI Studio bunu otomatik ekler; kendi sunucunda .env dosyasına yaz.',
        link: null,
        fragment: undefined,
        cta: '',
      },
      {
        key: 'auth',
        done: Boolean(s?.auth),
        title: 'Uygulamayı şifreyle koru',
        hint: 'Şu an linki bilen herkes ayarlarını görebilir ve değiştirebilir. APP_PASSWORD ortam değişkenini tanımla.',
        link: '/ayarlar',
        fragment: 'guvenlik',
        cta: 'Nasıl?',
      },
    ];
  });

  protected readonly setupDone = computed(() => this.setupSteps().filter((s) => s.done).length);
  protected readonly requiredDone = computed(() => this.setupSteps().slice(0, 3).every((s) => s.done));
  protected readonly showSetup = computed(() => this.setupDone() < 4 && !(this.requiredDone() && this.setupDismissed()));

  protected readonly stats = computed(() => {
    const weekAgo = this.store.now() - 7 * 86_400_000;
    const recent = this.store.digests().filter((d) => Date.parse(d.detectedAt) >= weekAgo && d.source === 'auto').length;
    return [
      { label: 'Takip edilen kanal', value: this.store.channels().length },
      { label: 'Bu hafta yeni video', value: recent },
      { label: 'Gönderilen özet', value: this.store.status()?.totalEmails ?? 0 },
    ];
  });

  protected readonly filters = computed(() => {
    const all = this.store.digests();
    const count = (k: Exclude<Filter, 'all'>) => all.filter((d) => FILTER_STATUSES[k].includes(d.status)).length;
    const list: { key: Filter; label: string; count: number }[] = [
      { key: 'all', label: 'Tümü', count: all.length },
      { key: 'sent', label: 'Özetler', count: count('sent') },
      { key: 'pending', label: 'İşleniyor', count: count('pending') },
      { key: 'failed', label: 'Sorunlu', count: count('failed') },
      { key: 'skipped', label: 'Atlananlar', count: count('skipped') },
    ];
    return list.filter((f) => f.key === 'all' || f.count > 0 || f.key === this.filter());
  });

  protected readonly visible = computed(() => {
    const f = this.filter();
    const all = this.store.digests();
    return f === 'all' ? all : all.filter((d) => FILTER_STATUSES[f].includes(d.status));
  });

  protected readonly logs = computed(() => this.store.logs().slice(0, this.showAllLogs() ? 60 : 6));

  toggle(id: string): void {
    this.openId.set(this.openId() === id ? null : id);
  }

  ago(iso: string): string {
    return relativeTime(iso, this.store.now());
  }

  logDot(level: LogLevel): string {
    return { info: 'bg-fg-subtle', success: 'bg-success', warn: 'bg-warning', error: 'bg-accent' }[level];
  }

  dismissSetup(): void {
    this.setupDismissed.set(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // yok say
    }
  }

  private readDismissed(): boolean {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  }
}
