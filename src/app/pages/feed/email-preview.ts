import { ChangeDetectionStrategy, Component, HostListener, OnInit, inject, input, output, signal } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import type { Digest } from '../../../shared/types';
import { Api, apiError } from '../../core/api';
import { Segmented, type SegmentOption } from '../../ui/controls';
import { Icon } from '../../ui/icon';

/**
 * E-postanın gelen kutusunda nasıl görüneceğini gösterir. HTML sunucuda
 * kaçışlanarak üretiliyor ve iframe betik çalıştıramayacak şekilde kum
 * havuzunda açılıyor; eski sürümdeki bypassSecurityTrustHtml + innerHTML
 * kullanımının aksine sayfaya enjekte edilmiyor.
 */
@Component({
  selector: 'app-email-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Segmented],
  template: `
    <div class="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <button type="button" class="absolute inset-0 cursor-default bg-black/40 backdrop-blur-[2px]" aria-label="Önizlemeyi kapat" tabindex="-1" (click)="closed.emit()"></button>
      <div
        class="animate-fade-up relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-dialog sm:max-w-[720px] sm:rounded-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preview-title"
      >
        <div class="flex items-center gap-3 border-b border-line px-4 py-3">
          <div class="min-w-0 flex-1">
            <h2 id="preview-title" class="text-sm font-semibold">E-posta önizlemesi</h2>
            <p class="truncate text-xs text-fg-muted">{{ digest().channelName }}: {{ digest().title }}</p>
          </div>
          <app-segmented [options]="widths" [(value)]="width" label="Önizleme genişliği" />
          <button type="button" class="btn btn-ghost btn-icon btn-sm" aria-label="Kapat" (click)="closed.emit()">
            <app-icon name="x" [size]="18" />
          </button>
        </div>
        <div class="flex-1 overflow-auto bg-surface-2 p-3 sm:p-5">
          @if (html(); as h) {
            <iframe
              title="E-posta önizlemesi"
              sandbox="allow-popups allow-popups-to-escape-sandbox"
              [srcdoc]="h"
              class="mx-auto block h-[70dvh] rounded-lg border border-line bg-white transition-[width] duration-200"
              [style.width]="width() === 'mobile' ? '390px' : '100%'"
              [style.max-width.%]="100"
            ></iframe>
          } @else if (error()) {
            <p class="py-16 text-center text-sm text-accent-text">{{ error() }}</p>
          } @else {
            <div class="flex justify-center py-16 text-fg-subtle"><app-icon name="spinner" [size]="20" /></div>
          }
        </div>
      </div>
    </div>
  `,
})
export class EmailPreview implements OnInit {
  private readonly api = inject(Api);
  private readonly sanitizer = inject(DomSanitizer);

  readonly digest = input.required<Digest>();
  readonly closed = output<void>();

  protected readonly html = signal<SafeHtml | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly width = signal<'desktop' | 'mobile'>('desktop');
  protected readonly widths: SegmentOption<'desktop' | 'mobile'>[] = [
    { value: 'desktop', label: 'Masaüstü' },
    { value: 'mobile', label: 'Telefon' },
  ];

  async ngOnInit(): Promise<void> {
    try {
      const raw = await this.api.digestPreview(this.digest().id);
      this.html.set(this.sanitizer.bypassSecurityTrustHtml(raw));
    } catch (err) {
      this.error.set(apiError(err));
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closed.emit();
  }
}
