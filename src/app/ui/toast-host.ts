import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService } from '../core/ui-services';
import { Icon } from './icon';

@Component({
  selector: 'app-toast-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <div
      class="pointer-events-none fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6 lg:items-end lg:px-6"
      aria-live="polite"
    >
      @for (t of toasts.toasts(); track t.id) {
        <div
          class="animate-fade-up pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-line bg-surface px-3.5 py-3 text-sm shadow-pop"
          role="status"
        >
          <span
            class="mt-px"
            [class.text-success]="t.kind === 'success'"
            [class.text-accent]="t.kind === 'error'"
            [class.text-fg-muted]="t.kind === 'info'"
          >
            <app-icon [name]="t.kind === 'success' ? 'check' : t.kind === 'error' ? 'alert-circle' : 'info'" />
          </span>
          <p class="min-w-0 flex-1 leading-snug text-fg">{{ t.message }}</p>
          @if (t.action) {
            <button type="button" class="-my-1 shrink-0 rounded-md px-2 py-1 text-[13px] font-medium text-fg hover:bg-surface-2" (click)="run(t.id, t.action.run)">
              {{ t.action.label }}
            </button>
          }
          <button type="button" class="-m-1 shrink-0 rounded-md p-1 text-fg-subtle hover:bg-surface-2 hover:text-fg" aria-label="Kapat" (click)="toasts.dismiss(t.id)">
            <app-icon name="x" [size]="14" />
          </button>
        </div>
      }
    </div>
  `,
})
export class ToastHost {
  protected readonly toasts = inject(ToastService);

  run(id: number, fn: () => void): void {
    this.toasts.dismiss(id);
    fn();
  }
}
