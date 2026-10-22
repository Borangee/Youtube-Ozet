import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import type { SettingsUpdate, SummaryLanguage, SummaryLength } from '../../../shared/types';
import { Api, AuthSession, apiError } from '../../core/api';
import { AppStore } from '../../core/store';
import { ThemeService, ToastService, type ThemePreference } from '../../core/ui-services';
import { CopyField, Segmented, Switch, type SegmentOption } from '../../ui/controls';
import { Icon, type IconName } from '../../ui/icon';

interface Section {
  id: string;
  title: string;
  icon: IconName;
}

@Component({
  selector: 'app-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Switch, Segmented, CopyField],
  templateUrl: './settings.html',
})
export class Settings {
  private readonly api = inject(Api);
  private readonly toast = inject(ToastService);
  private readonly session = inject(AuthSession);
  protected readonly store = inject(AppStore);
  protected readonly theme = inject(ThemeService);

  protected readonly sections: Section[] = [
    { id: 'e-posta', title: 'E-posta', icon: 'mail' },
    { id: 'tarama', title: 'Tarama', icon: 'refresh' },
    { id: 'ozet', title: 'Özet', icon: 'sparkles' },
    { id: 'gorunum', title: 'Görünüm', icon: 'sun' },
    { id: 'kesintisiz', title: '7/24 çalışma', icon: 'cloud' },
    { id: 'guvenlik', title: 'Güvenlik', icon: 'shield' },
    { id: 'yerel-bot', title: 'Yerel bot', icon: 'terminal' },
  ];

  // ---- e-posta formu -------------------------------------------------
  protected readonly sender = signal('');
  protected readonly password = signal('');
  protected readonly receivers = signal('');
  protected readonly smtpHost = signal('');
  protected readonly smtpPort = signal('');
  protected readonly showPassword = signal(false);
  protected readonly showAdvanced = signal(false);
  protected readonly savingEmail = signal(false);
  protected readonly testing = signal(false);
  private formLoaded = false;

  private readonly emailSettings = computed(() => this.store.settings()?.email ?? null);

  protected readonly emailDirty = computed(() => {
    const e = this.emailSettings();
    if (!e) return false;
    return (
      this.sender().trim().toLowerCase() !== e.senderEmail ||
      this.password().trim().length > 0 ||
      this.normalizedReceivers().join(',') !== e.receiverEmails.join(',') ||
      this.smtpHost().trim() !== e.smtpHost ||
      Number(this.smtpPort()) !== e.smtpPort
    );
  });

  protected readonly emailReady = computed(() => this.store.status()?.setup.email ?? false);

  // ---- seçenekler ----------------------------------------------------
  protected readonly intervalOptions: SegmentOption<number>[] = [5, 10, 15, 30, 60].map((m) => ({ value: m, label: `${m} dk` }));
  protected readonly languageOptions: SegmentOption<SummaryLanguage>[] = [
    { value: 'tr', label: 'Türkçe' },
    { value: 'en', label: 'English' },
  ];
  protected readonly lengthOptions: SegmentOption<SummaryLength>[] = [
    { value: 'short', label: 'Kısa' },
    { value: 'medium', label: 'Orta' },
    { value: 'long', label: 'Ayrıntılı' },
  ];
  protected readonly themeOptions: SegmentOption<ThemePreference>[] = [
    { value: 'system', label: 'Sistem' },
    { value: 'light', label: 'Açık' },
    { value: 'dark', label: 'Koyu' },
  ];

  protected readonly baseUrl = computed(() => {
    const appUrl = this.store.status()?.appUrl;
    return (appUrl || window.location.origin).replace(/\/$/, '');
  });
  protected readonly cronUrl = computed(() => this.baseUrl() + (this.store.status()?.cronPath ?? ''));
  protected readonly botSyncUrl = computed(() => {
    const key = (this.store.status()?.cronPath ?? '').split('key=')[1] ?? '';
    return `${this.baseUrl()}/api/bot/channels?key=${key}`;
  });
  protected readonly authEnabled = computed(() => this.store.status()?.setup.auth ?? false);

  constructor() {
    // Form alanlarını sunucudan gelen değerlerle bir kez doldur
    effect(() => {
      const e = this.emailSettings();
      if (!e || this.formLoaded) return;
      this.formLoaded = true;
      this.resetEmailForm();
    });
  }

  private normalizedReceivers(): string[] {
    return this.receivers()
      .split(/[,;\s]+/)
      .map((r) => r.trim().toLowerCase())
      .filter(Boolean);
  }

  resetEmailForm(): void {
    const e = this.emailSettings();
    if (!e) return;
    this.sender.set(e.senderEmail);
    this.password.set('');
    this.receivers.set(e.receiverEmails.join(', '));
    this.smtpHost.set(e.smtpHost);
    this.smtpPort.set(String(e.smtpPort));
  }

  async saveEmail(event?: Event): Promise<boolean> {
    event?.preventDefault();
    this.savingEmail.set(true);
    try {
      const state = await this.api.saveSettings({
        email: {
          senderEmail: this.sender(),
          receiverEmails: this.normalizedReceivers(),
          smtpHost: this.smtpHost(),
          smtpPort: Number(this.smtpPort()) || 587,
          ...(this.password().trim() ? { appPassword: this.password() } : {}),
        },
      });
      this.store.apply(state);
      this.password.set('');
      this.toast.success('E-posta ayarları kaydedildi.');
      return true;
    } catch (err) {
      this.toast.error(apiError(err));
      return false;
    } finally {
      this.savingEmail.set(false);
    }
  }

  async sendTest(): Promise<void> {
    if (this.emailDirty() && !(await this.saveEmail())) return;
    this.testing.set(true);
    try {
      await this.api.sendTestEmail();
      this.toast.success(`Test e-postası gönderildi. Gelen kutunu kontrol et.`);
    } catch (err) {
      this.toast.error(apiError(err));
    } finally {
      this.testing.set(false);
    }
  }

  async save(update: SettingsUpdate, message = 'Kaydedildi.'): Promise<void> {
    try {
      this.store.apply(await this.api.saveSettings(update));
      this.toast.success(message);
    } catch (err) {
      this.toast.error(apiError(err));
      void this.store.refresh();
    }
  }

  async setAutomation(enabled: boolean): Promise<void> {
    try {
      this.store.apply(await this.api.setAutomation(enabled));
    } catch (err) {
      this.toast.error(apiError(err));
    }
  }

  async downloadBot(): Promise<void> {
    try {
      const blob = await this.api.downloadBotScript();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'bot.py';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      this.toast.error(apiError(err));
    }
  }

  exportChannels(): void {
    const data = this.store.channels().map((c) => ({ id: c.id, name: c.name, handle: c.handle }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'channels.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  logout(): void {
    this.session.setToken(null);
    this.store.stop();
    this.session.authenticated.set(false);
  }

  scrollTo(id: string): void {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
