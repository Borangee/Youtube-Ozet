# Özetçi

Takip ettiğin YouTube kanalları yeni video yüklediğinde videoyu Gemini ile özetler ve e-postana gönderir.

- Sunucu, seçtiğin aralıkta (varsayılan 5 dakika) kanalların RSS beslemesini kontrol eder. YouTube API anahtarı gerekmez.
- Yeni video bulunca Gemini videoyu doğrudan YouTube linkinden izleyerek özetler. Olmazsa altyazıya, o da yoksa açıklamaya düşer.
- Özet; kısa bir "Kısaca" cümlesi, paragraflar, öne çıkanlar ve (açıklamada varsa) tıklanabilir bölüm listesiyle e-postana gelir.
- Shorts videoları, henüz başlamamış prömiyerler ve süren canlı yayınlar ayrı ele alınır.
- E-posta ya da Gemini hata verirse video kaybolmaz; 10 dakika arayla 3 kez yeniden denenir.

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

## Kendi bilgisayarında çalıştırma (localhost:3000)

[Node.js 22](https://nodejs.org) gerekir.

```bash
git clone https://github.com/Borangee/youtube-ozet.git
cd youtube-ozet
cp .env.example .env      # en azından GEMINI_API_KEY'i doldur
npm install
npm run dev
```

Sonra tarayıcıda **http://localhost:3000** adresini aç. `.env`'de `APP_PASSWORD` tanımladıysan giriş ekranı o şifreyi sorar;
boş bıraktıysan doğrudan açılır (yalnızca kendi bilgisayarında kullanıyorsan sorun değil).

`npm run dev` geliştirme modudur; kodu değiştirdikçe sayfa kendini yeniler. Sürekli açık kalacak bir kurulum için:

```bash
npm run build
npm run start:prod        # yine http://localhost:3000
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

Node kurmak istemiyorsan aynı işi yapan, yalnızca Python 3 standart kütüphanesiyle çalışan bir bot da var.
Kanal listesini **Ayarlar → Yerel bot** bölümündeki komutla bu uygulamadan alır:

```bash
python3 bot.py sync "https://<uygulama-adresi>/api/bot/channels?key=..."
python3 bot.py start      # arka planda başlat
python3 bot.py status     # durum
```

E-posta ve Gemini bilgileri `bot.py`'nin yanındaki `.env` dosyasından okunur. Bot ile sunucudaki otomatik
taramayı aynı anda açık tutarsan her video için iki e-posta gelir.

## Testler

```bash
npm run test:server   # tarama, kuyruk, e-posta şablonu ve ayrıştırıcı testleri
npm test              # arayüz testleri
npm run lint
```

Yapılan değişikliklerin ve düzeltilen hataların listesi için [DEGISIKLIKLER.md](DEGISIKLIKLER.md).
