import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import type { BulkAddResult, ChannelSearchResult } from '../../../shared/types';
import { Api, apiError } from '../../core/api';
import { AppStore } from '../../core/store';
import { ToastService } from '../../core/ui-services';
import { Avatar } from '../../ui/controls';
import { Icon } from '../../ui/icon';
import { YoutubeImport } from './youtube-import';

type Panel = 'none' | 'bulk' | 'import';

function looksDirect(text: string): boolean {
  const t = text.trim();
  return t.startsWith('@') || /youtube\.com\//i.test(t) || /^UC[\w-]{22}$/.test(t);
}

/** Tek kutudan kanal ekleme: arama, link/@kullanıcıadı, toplu ekleme, YouTube'dan aktarma. */
@Component({
  selector: 'app-channel-add',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Avatar, YoutubeImport],
  template: `
    <section class="card p-3 sm:p-4" aria-label="Kanal ekle">
      <form class="relative" (submit)="submitDirect($event)">
        <span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-fg-subtle">
          <app-icon [name]="searching() ? 'spinner' : 'search'" [size]="17" />
        </span>
        <input
          class="input h-11 pl-10 pr-10 text-[15px]"
          type="text"
          placeholder="Kanal ara ya da link, @kullanıcıadı yapıştır"
          autocomplete="off"
          spellcheck="false"
          aria-label="Kanal ara"
          [value]="query()"
          (input)="onInput($any($event.target).value)"
          (keydown.escape)="clear()"
        />
        @if (query()) {
          <button type="button" class="absolute inset-y-0 right-1.5 my-auto flex h-8 w-8 items-center justify-center rounded-md text-fg-subtle hover:bg-surface-2 hover:text-fg" aria-label="Temizle" (click)="clear()">
            <app-icon name="x" [size]="16" />
          </button>
        }
      </form>

      @if (query().trim().length > 0) {
        <div class="mt-2">
          @if (direct()) {
            <div class="flex items-center gap-3 rounded-lg px-2 py-2">
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-fg-muted">
                <app-icon name="plus" [size]="17" />
              </span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">{{ query().trim() }}</p>
                <p class="text-xs text-fg-muted">Link ya da kullanıcı adıyla doğrudan ekle</p>
              </div>
              <button type="button" class="btn btn-primary btn-sm" [disabled]="adding().has('direct')" (click)="addDirect()">
                @if (adding().has('direct')) {
                  <app-icon name="spinner" [size]="14" />
                }
                Ekle
              </button>
            </div>
          }

          @if (error()) {
            <p class="px-2 py-3 text-sm text-fg-muted">{{ error() }}</p>
          }

          @if (results().length > 0) {
            <ul class="max-h-[360px] overflow-y-auto" [class.border-t]="direct()" [class.border-line]="direct()" [class.mt-1]="direct()" [class.pt-1]="direct()">
              @for (r of results(); track r.id) {
                <li class="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-2">
                  <app-avatar [src]="r.avatar" [name]="r.name" [size]="36" />
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-medium">{{ r.name }}</p>
                    <p class="truncate text-xs text-fg-muted">{{ subtitle(r) }}</p>
                  </div>
                  @if (isAdded(r.id)) {
                    <span class="flex h-8 items-center gap-1.5 px-2 text-[13px] font-medium text-success-text">
                      <app-icon name="check" [size]="14" /> Takipte
                    </span>
                  } @else {
                    <button type="button" class="btn btn-secondary btn-sm" [disabled]="adding().has(r.id)" (click)="addResult(r)">
                      @if (adding().has(r.id)) {
                        <app-icon name="spinner" [size]="14" />
                      } @else {
                        <app-icon name="plus" [size]="14" />
                      }
                      Ekle
                    </button>
                  }
                </li>
              }
            </ul>
          } @else if (!searching() && searched() && !direct() && !error()) {
            <p class="px-2 py-3 text-sm text-fg-muted">"{{ query().trim() }}" için kanal bulunamadı.</p>
          }
        </div>
      }

      <div class="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
        <button type="button" class="btn btn-ghost btn-sm" [class.!bg-surface-2]="panel() === 'bulk'" [class.!text-fg]="panel() === 'bulk'" (click)="togglePanel('bulk')">
          <app-icon name="list-plus" [size]="15" /> Toplu ekle
        </button>
        <button type="button" class="btn btn-ghost btn-sm" [class.!bg-surface-2]="panel() === 'import'" [class.!text-fg]="panel() === 'import'" (click)="togglePanel('import')">
          <app-icon name="users" [size]="15" /> YouTube aboneliklerimden aktar
        </button>
      </div>

      @if (panel() === 'bulk') {
        <div class="animate-fade-up mt-3">
          <label class="field-label" for="bulk">Her satıra bir kanal</label>
          <textarea
            id="bulk"
            class="input kbd-mono text-[13px]"
            rows="5"
            spellcheck="false"
            placeholder="@Fireship&#10;https://www.youtube.com/@Elraenn&#10;UCsBjURrPoezykLs9EqgamOA"
            [value]="bulkText()"
            (input)="bulkText.set($any($event.target).value)"
          ></textarea>
          <p class="field-hint">Link, @kullanıcıadı, kanal kimliği ya da kanal adı olabilir. Eski sürümün channels.json içeriğini de yapıştırabilirsin.</p>
          <div class="mt-3 flex items-center gap-3">
            <button type="button" class="btn btn-primary btn-sm" [disabled]="bulkBusy() || bulkInputs().length === 0" (click)="addBulk()">
              @if (bulkBusy()) {
                <app-icon name="spinner" [size]="14" />
              }
              {{ bulkInputs().length > 0 ? bulkInputs().length + ' kanalı ekle' : 'Ekle' }}
            </button>
            @if (bulkBusy()) {
              <span class="text-xs text-fg-muted">Kanallar tek tek doğrulanıyor, biraz sürebilir…</span>
            }
          </div>
          @if (bulkResult(); as r) {
            <div class="mt-3 rounded-lg bg-surface-2 px-3 py-2.5 text-[13px]">
              <p class="font-medium">{{ r.added.length }} kanal eklendi{{ r.skipped.length > 0 ? ', ' + r.skipped.length + ' atlandı' : '' }}.</p>
              @if (r.skipped.length > 0) {
                <ul class="mt-1.5 space-y-0.5 text-fg-muted">
                  @for (s of r.skipped; track s.input) {
                    <li><span class="kbd-mono text-fg">{{ s.input }}</span> — {{ s.reason }}</li>
                  }
                </ul>
              }
            </div>
          }
        </div>
      }

      @if (panel() === 'import') {
        <app-youtube-import class="animate-fade-up mt-3 block" />
      }
    </section>
  `,
})
export class ChannelAdd implements OnDestroy {
  private readonly api = inject(Api);
  private readonly store = inject(AppStore);
  private readonly toast = inject(ToastService);

  protected readonly query = signal('');
  protected readonly results = signal<ChannelSearchResult[]>([]);
  protected readonly searching = signal(false);
  protected readonly searched = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly adding = signal(new Set<string>());
  protected readonly panel = signal<Panel>('none');
  protected readonly bulkText = signal('');
  protected readonly bulkBusy = signal(false);
  protected readonly bulkResult = signal<BulkAddResult | null>(null);

  protected readonly direct = computed(() => looksDirect(this.query()));
  private readonly addedIds = computed(() => new Set(this.store.channels().map((c) => c.id)));

  protected readonly bulkInputs = computed(() => {
    const text = this.bulkText().trim();
    if (!text) return [];
    if (text.startsWith('[')) {
      try {
        const parsed = JSON.parse(text) as { id?: string; handle?: string }[];
        return parsed.map((c) => c.id || c.handle || '').filter(Boolean);
      } catch {
        // JSON değilse satır satır oku
      }
    }
    return text
      .split(/\r?\n|,/)
      .map((l) => l.trim())
      .filter(Boolean);
  });

  private debounce: ReturnType<typeof setTimeout> | null = null;
  private searchSeq = 0;

  ngOnDestroy(): void {
    if (this.debounce) clearTimeout(this.debounce);
  }

  isAdded(id: string): boolean {
    return this.addedIds().has(id);
  }

  subtitle(r: ChannelSearchResult): string {
    return [r.handle, r.subscribers].filter(Boolean).join(' · ');
  }

  onInput(value: string): void {
    this.query.set(value);
    this.error.set(null);
    if (this.debounce) clearTimeout(this.debounce);
    const q = value.trim();
    if (q.length < 2 || /youtube\.com\//i.test(q) || /^UC[\w-]{22}$/.test(q)) {
      this.results.set([]);
      this.searched.set(false);
      this.searching.set(false);
      return;
    }
    this.debounce = setTimeout(() => void this.search(q.replace(/^@/, '')), 350);
  }

  private async search(q: string): Promise<void> {
    const seq = ++this.searchSeq;
    this.searching.set(true);
    try {
      const results = await this.api.searchChannels(q);
      if (seq !== this.searchSeq) return;
      this.results.set(results);
      this.searched.set(true);
    } catch (err) {
      if (seq !== this.searchSeq) return;
      this.results.set([]);
      this.error.set(apiError(err));
    } finally {
      if (seq === this.searchSeq) this.searching.set(false);
    }
  }

  clear(): void {
    this.searchSeq++;
    this.query.set('');
    this.results.set([]);
    this.searched.set(false);
    this.searching.set(false);
    this.error.set(null);
  }

  togglePanel(p: Panel): void {
    this.panel.set(this.panel() === p ? 'none' : p);
  }

  submitDirect(event: Event): void {
    event.preventDefault();
    if (this.direct()) void this.addDirect();
    else if (this.results().length > 0 && !this.isAdded(this.results()[0].id)) void this.addResult(this.results()[0]);
  }

  async addDirect(): Promise<void> {
    await this.withAdding('direct', async () => {
      const { channel, state } = await this.api.addChannel({ input: this.query().trim() });
      this.store.apply(state);
      this.toast.success(`${channel.name} takibe alındı.`);
      this.clear();
    });
  }

  async addResult(r: ChannelSearchResult): Promise<void> {
    await this.withAdding(r.id, async () => {
      const { channel, state } = await this.api.addChannel({
        id: r.id,
        name: r.name,
        handle: r.handle,
        avatar: r.avatar,
        subscribers: r.subscribers,
      });
      this.store.apply(state);
      this.toast.success(`${channel.name} takibe alındı.`);
    });
  }

  async addBulk(): Promise<void> {
    this.bulkBusy.set(true);
    this.bulkResult.set(null);
    try {
      const { result, state } = await this.api.addChannelsBulk(this.bulkInputs());
      this.store.apply(state);
      this.bulkResult.set(result);
      if (result.skipped.length === 0) this.bulkText.set('');
    } catch (err) {
      this.toast.error(apiError(err));
    } finally {
      this.bulkBusy.set(false);
    }
  }

  private async withAdding(key: string, fn: () => Promise<void>): Promise<void> {
    this.adding.update((s) => new Set(s).add(key));
    try {
      await fn();
    } catch (err) {
      this.toast.error(apiError(err));
    } finally {
      this.adding.update((s) => {
        const next = new Set(s);
        next.delete(key);
        return next;
      });
    }
  }
}
