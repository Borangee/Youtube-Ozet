import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex shrink-0' },
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--accent)" />
      <path d="M8.5 10.6v10.8c0 .8.9 1.3 1.6.9l7.6-5.4c.6-.4.6-1.3 0-1.7l-7.6-5.4c-.7-.5-1.6 0-1.6.8z" fill="#fff" />
      <rect x="19.5" y="10.75" width="5" height="2.5" rx="1.25" fill="#fff" />
      <rect x="19.5" y="14.75" width="5" height="2.5" rx="1.25" fill="#fff" opacity=".85" />
      <rect x="19.5" y="18.75" width="3.2" height="2.5" rx="1.25" fill="#fff" opacity=".7" />
    </svg>
  `,
})
export class Logo {
  readonly size = input(28);
}
