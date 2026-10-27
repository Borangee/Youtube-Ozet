# Özetçi

Takip ettiğin YouTube kanalları yeni video yüklediğinde videoyu Gemini ile özetler ve e-postana gönderir.

- Sunucu, seçtiğin aralıkta (varsayılan 5 dakika) kanalların RSS beslemesini kontrol eder. YouTube API anahtarı gerekmez.
- Yeni video bulunca Gemini videoyu doğrudan YouTube linkinden izleyerek özetler. Olmazsa altyazıya, o da yoksa açıklamaya düşer.
- Özet; kısa bir "Kısaca" cümlesi, paragraflar, öne çıkanlar ve (açıklamada varsa) tıklanabilir bölüm listesiyle e-postana gelir.
- Shorts videoları, henüz başlamamış prömiyerler ve süren canlı yayınlar ayrı ele alınır.
- E-posta ya da Gemini hata verirse video kaybolmaz; 10 dakika arayla 3 kez yeniden denenir.
- Akış sayfasındaki **Elle özetle** paneliyle bir kanalın son 10 videosundan birini seçip beklemeden özetleyebilirsin.
- Kanallar; arayarak, link/@kullanıcıadı yapıştırarak, Google hesabından ya da Google Takeout dosyasından aktarılarak eklenir.

## AI Studio'da çalıştırma

1. Projeyi AI Studio'ya yükle. `GEMINI_API_KEY` otomatik eklenir.
2. **Ayarlar → Secrets** bölümüne `APP_PASSWORD` ekle. Bu, uygulamanın giriş şifresi olur. Eklemezsen linki bilen herkes ayarlarına erişebilir.
3. Uygulamayı aç, **Ayarlar → E-posta** bölümüne Gmail adresini ve
   [16 haneli uygulama şifreni](https://myaccount.google.com/apppasswords) gir, "Test e-postası gönder"e bas.
4. **Kanallar** sayfasından kanalları ekle.

### Tarayıcı kapalıyken de çalışması için

Cloud Run bir süre istek gelmezse sunucuyu uyutur. **Ayarlar → 7/24 çalışma** bölümündeki adresi
[cron-job.org](https://cron-job.org) gibi bir servise ver ve 5 dakikada bir çağırmasını iste.

Cloud Run'ın dosya sistemi kalıcı değildir: sunucu yeniden başlarsa kanal listesi ve geçmiş, son yayınlanan
sürüme döner. Kalıcı kullanım için uygulamayı kendi bilgisayarında, bir VPS'te ya da kalıcı diskli bir ortamda
çalıştır.

## Kendi bilgisayarında çalıştırma (localhost:3500)

[Node.js 22](https://nodejs.org) gerekir.

```bash
git clone https://github.com/Borangee/youtube-ozet.git
cd youtube-ozet
cp .env.example .env      # en azından GEMINI_API_KEY'i doldur
npm install
npm run dev
```

Sonra tarayıcıda **http://localhost:3500** adresini aç. Gemini anahtarını `.env` yerine **Ayarlar → Gemini** bölümüne de
yapıştırabilirsin. `.env`'de `APP_PASSWORD` tanımladıysan giriş ekranı o şifreyi sorar;
boş bıraktıysan doğrudan açılır (yalnızca kendi bilgisayarında kullanıyorsan sorun değil).

`npm run dev` geliştirme modudur; kodu değiştirdikçe sayfa kendini yeniler. Sürekli açık kalacak bir kurulum için:

```bash
npm run build
npm run start:prod        # yine http://localhost:3500
```

Veriler `data/state.json` dosyasında tutulur (`DATA_DIR` ile değiştirilebilir). Eski sürümün `automation-state.json`
dosyası varsa, ilk açılışta içindeki kanallar otomatik taşınır.

### Ortam değişkenleri

| Değişken | Açıklama |
| --- | --- |
| `GEMINI_API_KEY` | Gemini API anahtarı (zorunlu) |
| `APP_PASSWORD` | Uygulama giriş şifresi (şiddetle önerilir) |
| `SENDER_EMAIL`, `EMAIL_APP_PASSWORD`, `RECEIVER_EMAIL` | E-posta ayarları; arayüzden de girilebilir, arayüzdeki değer önceliklidir |
| `SMTP_HOST`, `SMTP_PORT` | Gmail dışı SMTP sunucusu için (varsayılan `smtp.gmail.com:587`) |
| `CRON_SECRET` | Dış tetikleyici ve bot.py eşitleme anahtarı; boşsa rastgele üretilir |
| `GEMINI_MODEL` | Kullanılacak model(ler), virgülle; boşsa `gemini-flash-latest` ve yedekleri |
| `DATA_DIR` | Veri klasörü (varsayılan `./data`) |
| `TZ` | E-postadaki saatlerin dilimi (varsayılan `Europe/Istanbul`) |

## Yerel Python botu (`bot.py`)

Web uygulamasını açık tutmak istemiyorsan aynı işi arka planda sessizce yapan bir Python botu var. Yalnızca Python 3.8+
gerekir, `pip` ile hiçbir şey kurulmaz. Windows ve Linux'ta çalışır. Adımların aynısı uygulamada **Ayarlar → Yerel bot**
bölümünde, kopyalanabilir komutlarla da var.

### Kurulum

1. **Python'u kur.**
   - Windows: [python.org](https://www.python.org/downloads/) adresinden indir; kurulumun ilk ekranında
     **"Add python.exe to PATH"** kutusunu işaretle.
   - Linux: çoğu dağıtımda kurulu. Değilse `sudo pacman -S python` (Arch/CachyOS) ya da `sudo apt install python3`.
2. **Bir klasör aç** (ör. `C:\YouTubeOzet` ya da `~/youtube-ozet-bot`) ve `bot.py`'yi içine koy
   (uygulamadaki "bot.py indir" düğmesiyle ya da bu depodan).
3. **Aynı klasörde `.env` dosyası oluştur:**

   ```
   GEMINI_API_KEY=buraya-gemini-anahtarin
   SENDER_EMAIL=ornek@gmail.com
   EMAIL_APP_PASSWORD=abcd efgh ijkl mnop
   RECEIVER_EMAIL=ornek@gmail.com
   CHECK_INTERVAL_MINUTES=5
   ```

   Windows'ta Not Defteri ile kaydederken **Kayıt türü: Tüm dosyalar** seç; yoksa dosya `.env.txt` olur ve okunmaz.
4. **Kanalları al, dene, başlat.** Windows'ta `py`, Linux'ta `python3` yaz:

   ```bash
   cd C:\YouTubeOzet                       # Linux: cd ~/youtube-ozet-bot
   py bot.py sync "http://localhost:3500/api/bot/channels?key=..."   # adres Ayarlar > Yerel bot'ta
   py bot.py test                          # Gemini anahtarını dener, test e-postası atar
   py bot.py start                         # arka planda başlatır
   ```

5. **Bilgisayar açılınca otomatik başlasın:**

   ```bash
   py bot.py autostart on
   ```

   - Windows: Başlangıç klasörüne bir kısayol eklenir; Windows'a her girişte bot pencere açmadan başlar. Yönetici izni gerekmez.
   - Linux: bir systemd kullanıcı servisi kurulur ve bot hemen başlar. Oturum açmayı beklemeden, bilgisayar açılır açılmaz
     başlaması için bir kez `sudo loginctl enable-linger $USER` çalıştır.
   - Kapatmak için `py bot.py autostart off`.

### Komutlar

| Komut | Ne yapar |
| --- | --- |
| `bot.py start` / `stop` / `restart` | Arka planda başlatır / durdurur / yeniden başlatır |
| `bot.py status` | Çalışıyor mu, otomatik başlatma açık mı, sonraki tarama ne zaman |
| `bot.py logs` | Günlüğü canlı izler (Ctrl+C ile çık) |
| `bot.py run` | Ön planda çalıştırır; bir sorun olursa hatayı görmek için |
| `bot.py test` | Gemini anahtarını dener ve test e-postası gönderir |
| `bot.py scan` | Beklemeden bir tarama yapar (bot arka planda çalışmıyorken) |
| `bot.py list` | Takip edilen kanalları listeler |
| `bot.py add @kanal` / `remove @kanal` | Kanal ekler / çıkarır |
| `bot.py sync "<adres>"` | Kanal listesini web uygulamasından alır |
| `bot.py autostart on` / `off` / `status` | Bilgisayar açılınca otomatik başlatmayı yönetir |

Bot ile web uygulamasındaki **Otomatik tarama**'yı aynı anda açık tutarsan her video için iki e-posta gelir; birini kapat.

## Testler

```bash
npm run test:server   # tarama, kuyruk, e-posta şablonu ve ayrıştırıcı testleri
npm test              # arayüz testleri
npm run lint
```

Yapılan değişikliklerin ve düzeltilen hataların listesi için [DEGISIKLIKLER.md](DEGISIKLIKLER.md).
