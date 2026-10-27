import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import type { SettingsUpdate, SummaryLanguage, SummaryLength } from '../../../shared/types';
import { Api, AuthSession, apiError } from '../../core/api';
import { AppStore } from '../../core/store';
import { ThemeService, ToastService, type ThemePreference } from '../../core/ui-services';
import { CodeBlock, CopyField, Segmented, Switch, type SegmentOption } from '../../ui/controls';
import { Icon, type IconName } from '../../ui/icon';

interface Section {
  id: string;
  title: string;
  icon: IconName;
}

@Component({
  selector: 'app-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Switch, Segmented, CopyField, CodeBlock],
  templateUrl: './settings.html',
})
export class Settings {
  private readonly api = inject(Api);
  private readonly toast = inject(ToastService);
  private readonly session = inject(AuthSession);
  protected readonly store = inject(AppStore);
  protected readonly theme = inject(ThemeService);

  protected readonly sections: Section[] = [
    { id: 'gemini', title: 'Gemini', icon: 'sparkles' },
    { id: 'e-posta', title: 'E-posta', icon: 'mail' },
    { id: 'tarama', title: 'Tarama', icon: 'refresh' },
    { id: 'ozet', title: 'Özet', icon: 'sparkles' },
    { id: 'gorunum', title: 'Görünüm', icon: 'sun' },
    { id: 'kesintisiz', title: '7/24 çalışma', icon: 'cloud' },
    { id: 'guvenlik', title: 'Güvenlik', icon: 'shield' },
    { id: 'yerel-bot', title: 'Yerel bot', icon: 'terminal' },
  ];

  // ---- gemini ---------------------------------------------------------
  protected readonly geminiKey = signal('');
  protected readonly showGeminiKey = signal(false);
  protected readonly savingGemini = signal(false);
  protected readonly testingGemini = signal(false);
  protected readonly geminiResult = signal<{ ok: boolean; text: string } | null>(null);

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

  // ---- yerel bot kurulum rehberi ---------------------------------------
  protected readonly botOs = signal<'windows' | 'linux'>(/windows/i.test(navigator.userAgent) ? 'windows' : 'linux');
  protected readonly osOptions: SegmentOption<'windows' | 'linux'>[] = [
    { value: 'windows', label: 'Windows' },
    { value: 'linux', label: 'Linux' },
  ];
  protected readonly py = computed(() => (this.botOs() === 'windows' ? 'py' : 'python3'));
  protected readonly botDir = computed(() => (this.botOs() === 'windows' ? 'C:\\YouTubeOzet' : '~/youtube-ozet-bot'));
  protected readonly botEnvTemplate = computed(() => {
    const e = this.store.settings()?.email;
    return [
      'GEMINI_API_KEY=buraya-gemini-anahtarin',
      `SENDER_EMAIL=${e?.senderEmail || 'ornek@gmail.com'}`,
      'EMAIL_APP_PASSWORD=abcd efgh ijkl mnop',
      `RECEIVER_EMAIL=${e?.receiverEmails.join(',') || 'ornek@gmail.com'}`,
      'CHECK_INTERVAL_MINUTES=5',
    ].join('\n');
  });
  protected readonly botSetupCommands = computed(() => {
    const py = this.py();
    return [`cd ${this.botDir()}`, `${py} bot.py sync "${this.botSyncUrl()}"`, `${py} bot.py test`, `${py} bot.py start`].join('\n');
  });
  protected readonly botCommands = computed(() => {
    const py = this.py();
    return [
      { cmd: `${py} bot.py start`, desc: 'Arka planda başlatır' },
      { cmd: `${py} bot.py stop`, desc: 'Durdurur' },
      { cmd: `${py} bot.py restart`, desc: 'Yeniden başlatır' },
      { cmd: `${py} bot.py status`, desc: 'Çalışıyor mu, sonraki tarama ne zaman' },
      { cmd: `${py} bot.py logs`, desc: 'Günlüğü canlı izler (Ctrl+C ile çık)' },
      { cmd: `${py} bot.py run`, desc: 'Ön planda çalıştırır, hataları görmek için' },
      { cmd: `${py} bot.py test`, desc: 'Gemini anahtarını ve e-postayı dener' },
      { cmd: `${py} bot.py scan`, desc: 'Beklemeden bir tarama yapar (bot kapalıyken)' },
      { cmd: `${py} bot.py list`, desc: 'Takip edilen kanalları listeler' },
      { cmd: `${py} bot.py add @kanal`, desc: 'Kanal ekler' },
      { cmd: `${py} bot.py remove @kanal`, desc: 'Kanalı çıkarır' },
      { cmd: `${py} bot.py sync "<adres>"`, desc: 'Kanal listesini bu uygulamadan alır' },
      { cmd: `${py} bot.py autostart on`, desc: 'Bilgisayar açılınca otomatik başlat' },
      { cmd: `${py} bot.py autostart off`, desc: 'Otomatik başlatmayı kapat' },
    ];
  });

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

  async saveGemini(event?: Event): Promise<void> {
    event?.preventDefault();
    if (!this.geminiKey().trim()) return;
    this.savingGemini.set(true);
    this.geminiResult.set(null);
    try {
      this.store.apply(await this.api.saveSettings({ gemini: { apiKey: this.geminiKey() } }));
      this.geminiKey.set('');
      this.toast.success('Gemini anahtarı kaydedildi.');
      await this.testGemini();
    } catch (err) {
      this.toast.error(apiError(err));
    } finally {
      this.savingGemini.set(false);
    }
  }

  /** Kutuya anahtar yazıldıysa onu, yazılmadıysa kayıtlı anahtarı dener. */
  async testGemini(): Promise<void> {
    const typed = this.geminiKey().trim();
    if (!typed && !this.store.settings()?.gemini.hasApiKey) {
      this.geminiResult.set({ ok: false, text: 'Önce bir Gemini API anahtarı gir.' });
      return;
    }
    this.testingGemini.set(true);
    this.geminiResult.set(null);
    try {
      const { model } = await this.api.testGemini(typed || undefined);
      this.geminiResult.set({ ok: true, text: `Bağlantı çalışıyor (${model}).` });
    } catch (err) {
      this.geminiResult.set({ ok: false, text: apiError(err) });
    } finally {
      this.testingGemini.set(false);
    }
  }

  async clearGemini(): Promise<void> {
    this.geminiResult.set(null);
    await this.save({ gemini: { clear: true } }, 'Arayüzde kayıtlı Gemini anahtarı silindi.');
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
