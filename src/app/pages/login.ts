import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject, output, signal, viewChild } from '@angular/core';
import { Api, AuthSession, apiError } from '../core/api';
import { Icon } from '../ui/icon';
import { Logo } from '../ui/logo';

@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Logo],
  template: `
    <div class="flex min-h-dvh items-center justify-center px-4 py-10">
      <div class="w-full max-w-[360px]">
        <div class="mb-8 flex flex-col items-center text-center">
          <app-logo [size]="44" />
          <h1 class="mt-5 text-xl font-semibold tracking-tight">Özetçi'ye giriş yap</h1>
          <p class="mt-1.5 text-sm text-fg-muted">Devam etmek için uygulama şifreni gir.</p>
        </div>

        <form class="card p-5" (submit)="submit($event)">
          <label class="field-label" for="password">Şifre</label>
          <div class="relative">
            <input
              id="password"
              class="input pr-10"
              [type]="reveal() ? 'text' : 'password'"
              autocomplete="current-password"
              #passwordInput
              [value]="password()"
              (input)="password.set($any($event.target).value)"
            />
            <button
              type="button"
              class="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-fg-subtle hover:text-fg"
              [attr.aria-label]="reveal() ? 'Şifreyi gizle' : 'Şifreyi göster'"
              (click)="reveal.set(!reveal())"
            >
              <app-icon [name]="reveal() ? 'eye-off' : 'eye'" />
            </button>
          </div>
          @if (error()) {
            <p class="mt-2.5 flex items-center gap-1.5 text-[13px] text-accent-text" role="alert">
              <app-icon name="alert-circle" [size]="14" /> {{ error() }}
            </p>
          }
          <button type="submit" class="btn btn-primary mt-4 w-full" [disabled]="busy() || !password()">
            @if (busy()) {
              <app-icon name="spinner" />
            }
            Giriş yap
          </button>
        </form>
        <p class="mt-5 text-center text-xs leading-relaxed text-fg-subtle">
          Şifre, sunucudaki <code class="kbd-mono">APP_PASSWORD</code> ortam değişkeninde tanımlı.
        </p>
      </div>
    </div>
  `,
})
export class Login {
  private readonly api = inject(Api);
  private readonly session = inject(AuthSession);
  readonly loggedIn = output<void>();

  protected readonly password = signal('');
  protected readonly reveal = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly passwordInput = viewChild<ElementRef<HTMLInputElement>>('passwordInput');

  constructor() {
    // Tek alanlı giriş ekranı: imleç doğrudan şifre kutusunda olsun
    afterNextRender(() => this.passwordInput()?.nativeElement.focus());
  }

  async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.password() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const { token } = await this.api.login(this.password());
      this.session.setToken(token);
      this.loggedIn.emit();
    } catch (err) {
      this.error.set(apiError(err));
    } finally {
      this.busy.set(false);
    }
  }
}
