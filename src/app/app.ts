import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Api, AuthSession, apiError } from './core/api';
import { countdown } from './core/format';
import { AppStore } from './core/store';
import { ToastService } from './core/ui-services';
import { Login } from './pages/login';
import { MonitorCard } from './shell/monitor-card';
import { Icon, type IconName } from './ui/icon';
import { Logo } from './ui/logo';
import { ToastHost } from './ui/toast-host';

interface NavItem {
  path: string;
  label: string;
  icon: IconName;
  exact: boolean;
}

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, Logo, MonitorCard, ToastHost, Login],
  templateUrl: './app.html',
})
export class App implements OnInit {
  private readonly api = inject(Api);
  private readonly session = inject(AuthSession);
  private readonly toast = inject(ToastService);
  protected readonly store = inject(AppStore);

  protected readonly sessionError = signal<string | null>(null);
  protected readonly scanning = signal(false);

  protected readonly nav: NavItem[] = [
    { path: '/', label: 'Akış', icon: 'inbox', exact: true },
    { path: '/kanallar', label: 'Kanallar', icon: 'tv', exact: false },
    { path: '/ayarlar', label: 'Ayarlar', icon: 'sliders', exact: false },
  ];

  protected readonly phase = computed<'loading' | 'login' | 'app' | 'error'>(() => {
    if (this.sessionError()) return 'error';
    const authed = this.session.authenticated();
    if (authed === null) return 'loading';
    if (!authed) return 'login';
    return this.store.state() ? 'app' : this.store.loadError() ? 'error' : 'loading';
  });

  protected readonly errorText = computed(() => this.sessionError() ?? this.store.loadError() ?? '');

  protected readonly pendingCount = computed(
    () => this.store.digests().filter((d) => d.status === 'queued' || d.status === 'processing').length,
  );
  protected readonly failedCount = computed(() => this.store.digests().filter((d) => d.status === 'failed').length);
  protected readonly settingsNeedsAttention = computed(() => {
    const setup = this.store.status()?.setup;
    return Boolean(setup && !setup.email);
  });

  protected readonly mobileStatus = computed(() => {
    const s = this.store.status();
    if (!s) return '';
    if (!s.enabled) return 'Durduruldu';
    if (s.scanning) return 'Taranıyor…';
    const ms = this.store.nextScanIn();
    return ms === null ? 'İzleniyor' : countdown(ms);
  });

  ngOnInit(): void {
    void this.checkSession();
  }

  async checkSession(): Promise<void> {
    this.sessionError.set(null);
    try {
      const info = await this.api.session();
      this.session.authRequired.set(info.authRequired);
      this.session.authenticated.set(info.authenticated);
      if (info.authenticated) this.store.start();
    } catch (err) {
      this.sessionError.set(apiError(err));
    }
  }

  onLoggedIn(): void {
    this.session.authenticated.set(true);
    this.store.start();
  }

  retry(): void {
    if (this.sessionError()) void this.checkSession();
    else void this.store.refresh();
  }

  async scanNow(): Promise<void> {
    this.scanning.set(true);
    try {
      this.store.apply(await this.api.scanNow());
      this.toast.show('Kanallar kontrol ediliyor…');
    } catch (err) {
      this.toast.error(apiError(err));
    } finally {
      this.scanning.set(false);
    }
  }
}
