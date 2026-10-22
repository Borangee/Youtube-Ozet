import { ChangeDetectionStrategy, Component, computed, input, model, output, signal } from '@angular/core';
import { Icon } from './icon';
import { ToastService } from '../core/ui-services';
import { inject } from '@angular/core';

/** Açma/kapama anahtarı. */
@Component({
  selector: 'app-switch',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      role="switch"
      [attr.aria-checked]="checked()"
      [attr.aria-label]="label()"
      [disabled]="disabled()"
      (click)="toggle()"
      class="relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors duration-150 disabled:opacity-50"
      [class]="checked() ? 'bg-ink border-ink' : 'bg-surface-3 border-line-strong'"
    >
      <span
        class="inline-block h-[18px] w-[18px] rounded-full shadow-sm transition-transform duration-150"
        [class]="checked() ? 'translate-x-[18px] bg-ink-fg' : 'translate-x-[2px] bg-surface'"
      ></span>
    </button>
  `,
})
export class Switch {
  readonly checked = model(false);
  readonly disabled = input(false);
  readonly label = input('');
  readonly changed = output<boolean>();

  toggle(): void {
    this.checked.set(!this.checked());
    this.changed.emit(this.checked());
  }
}

export interface SegmentOption<T extends string | number> {
  value: T;
  label: string;
}

/** Bölümlü seçim kontrolü (radyo grubu). */
@Component({
  selector: 'app-segmented',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div role="radiogroup" [attr.aria-label]="label()" class="inline-flex shrink-0 gap-0.5 rounded-[11px] border border-line bg-surface-2 p-0.5">
      @for (opt of options(); track opt.value) {
        <button
          type="button"
          role="radio"
          [attr.aria-checked]="opt.value === value()"
          (click)="select(opt.value)"
          class="h-8 whitespace-nowrap rounded-[9px] px-2.5 text-[13px] font-medium transition-colors sm:px-3"
          [class]="opt.value === value() ? 'bg-surface text-fg shadow-card' : 'text-fg-muted hover:text-fg'"
        >
          {{ opt.label }}
        </button>
      }
    </div>
  `,
})
export class Segmented<T extends string | number> {
  readonly options = input.required<SegmentOption<T>[]>();
  readonly value = model.required<T>();
  readonly label = input('');
  readonly changed = output<T>();

  select(v: T): void {
    if (v === this.value()) return;
    this.value.set(v);
    this.changed.emit(v);
  }
}

/** Kanal avatarı; görsel yüklenemezse baş harfi gösterir. */
@Component({
  selector: 'app-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (src() && !failed()) {
      <img
        [src]="src()"
        [alt]="''"
        [width]="size()"
        [height]="size()"
        loading="lazy"
        referrerpolicy="no-referrer"
        (error)="failed.set(true)"
        class="rounded-full object-cover bg-surface-3"
        [style.width.px]="size()"
        [style.height.px]="size()"
      />
    } @else {
      <span
        class="inline-flex items-center justify-center rounded-full bg-surface-3 font-semibold text-fg-muted"
        [style.width.px]="size()"
        [style.height.px]="size()"
        [style.font-size.px]="size() * 0.42"
        >{{ initial() }}</span
      >
    }
  `,
  host: { class: 'inline-flex shrink-0' },
})
export class Avatar {
  readonly src = input<string | null | undefined>('');
  readonly name = input('');
  readonly size = input(32);
  protected readonly failed = signal(false);
  protected readonly initial = computed(() => (this.name().trim()[0] ?? '?').toLocaleUpperCase('tr'));
}

/** Kopyalanabilir tek satırlık değer. */
@Component({
  selector: 'app-copy-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <div class="flex items-stretch gap-2">
      <input class="input kbd-mono text-[13px] truncate" [value]="value()" readonly [attr.aria-label]="label()" (focus)="select($event)" />
      <button type="button" class="btn btn-secondary shrink-0" (click)="copy()">
        <app-icon [name]="copied() ? 'check' : 'copy'" />
        <span>{{ copied() ? 'Kopyalandı' : 'Kopyala' }}</span>
      </button>
    </div>
  `,
})
export class CopyField {
  private readonly toast = inject(ToastService);
  readonly value = input.required<string>();
  readonly label = input('');
  protected readonly copied = signal(false);

  select(e: Event): void {
    (e.target as HTMLInputElement).select();
  }

  async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.value());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1800);
    } catch {
      this.toast.error('Kopyalanamadı, metni elle seçip kopyala.');
    }
  }
}
