# Değişiklikler

AI Studio sürümünün üzerinden geçilerek yapılanlar. Arayüz sıfırdan yeniden tasarlandı, sunucu modüllere
bölünerek yeniden yazıldı.

## Güvenlik açıkları

| Önem | Sorun | Düzeltme |
| --- | --- | --- |
| Kritik | Gmail adresi ve **uygulama şifresi** `server.ts`, `app.ts` ve `bot.py` içine açık yazılmıştı. `app.ts` tarayıcıya gönderilen JavaScript paketine girdiği için şifre, uygulamayı açan herkese görünüyordu. | Kodda hiçbir kimlik bilgisi yok. Şifre yalnızca ortam değişkeninden ya da arayüzden alınıp sunucuda saklanıyor, bir daha istemciye gönderilmiyor. **Eski şifreyi Google hesabından iptal et.** |
| Kritik | `GET /api/config` uygulama şifresini düz metin olarak döndürüyordu; `/api/raw/bot.py` şifreli `bot.py`'yi herkese indiriyordu. | Uç noktalar kaldırıldı. Ayarlar yalnızca `hasAppPassword: true/false` döndürüyor. |
| Kritik | `POST /api/send-real-email` açık bir posta aktarıcısıydı: herkes istediği konuyu, HTML içeriği ve alıcıyı vererek senin Gmail hesabından e-posta gönderebiliyordu (spam/oltalama). | Uç nokta kaldırıldı. E-postalar yalnızca sunucuda, YouTube verisinden üretilip ayarlı alıcılara gidiyor. |
| Yüksek | Hiçbir uç noktada kimlik doğrulama yoktu; linki bilen herkes kanalları, ayarları ve `.env` dosyasını değiştirebiliyordu. | `APP_PASSWORD` ile şifre koruması. İmzalı oturum jetonu, hatalı girişlerde IP başına kilitleme, dış tetikleyici için ayrı gizli anahtar. |
| Yüksek | SMTP bağlantısında `rejectUnauthorized: false` vardı; araya giren biri Gmail şifresini okuyabilirdi. `bot.py`'de de `starttls()` sertifika doğrulamıyordu. | Sertifika doğrulaması her iki tarafta açık, STARTTLS zorunlu. |
| Orta | Video başlığı, kanal adı ve Gemini çıktısı HTML'e kaçışlanmadan yazılıyor, arayüzde `bypassSecurityTrustHtml` + `innerHTML` ile gösteriliyordu. | Tüm dinamik değerler kaçışlanıyor. E-posta önizlemesi betik çalıştıramayan bir iframe'de açılıyor. |
| Orta | `/api/save-config` gelen değerleri satır sonu kontrolü yapmadan `.env` dosyasına yazıyordu (ortam değişkeni enjeksiyonu). | `.env`'ye yazılmıyor; ayarlar doğrulanıp `data/state.json`'a kaydediliyor. E-posta adresleri başlık enjeksiyonuna karşı doğrulanıyor. |
| Orta | `/api/summarize-demo` herkese açıktı; 10 MB'lık istek gövdesiyle Gemini kotası tüketilebiliyordu. | Kaldırıldı. İstek gövdesi 64 KB ile sınırlı, elle tetiklenen işlemlerde hız sınırı var. |
| Düşük | `bot.py` Gemini anahtarını URL'de gönderiyordu (loglara sızabilir). | Anahtar `x-goog-api-key` başlığında. |

## Hatalar

- **Aynı videonun e-postası tekrar tekrar gidebiliyordu.** Tarayıcı, kendi eski kanal listesini sunucuya gönderip
  sunucunun güncellediği "son video" bilgisini eziyordu; bir sonraki taramada video yine "yeni" sayılıyordu.
  Artık kanal listesi yalnızca sunucuda değişiyor.
- **Kanala elle "tara" denince yeni videonun e-postası hiç gitmiyordu**, çünkü son video kimliği güncellenip bildirim atlanıyordu.
- **Video silinince eski bir video için e-posta gidiyordu**; aynı tarama aralığında iki video yüklenince biri kayboluyordu.
  Her kanal için görülen video listesi tutuluyor, tarama başına en fazla 3 yeni video işleniyor.
- **E-posta ya da Gemini hata verince video bir daha denenmiyordu.** Artık 3 kez yeniden deneniyor; Gemini yine
  olmazsa e-posta özetsiz de olsa gidiyor.
- **Ağ isteklerinde zaman aşımı yoktu**; takılan tek bir istek tüm taramaları kalıcı olarak kilitleyebiliyordu.
- **Açık her tarayıcı sekmesi ayrıca tarama tetikliyordu** (sekmedeki geri sayım sıfırlanınca). Zamanlayıcı artık yalnızca sunucuda.
- **"Son video tarihi" aslında kanalın açılış tarihiydi** (ör. Ozan Sihay için "20 Haz 2006"): RSS'teki ilk
  `<published>` alanı kanala ait. Alanlar artık yalnızca ilgili `<entry>` bloğundan okunuyor.
- **Altyazı ayrıştırması kırılgandı**: `"captionTracks":\s*(\[.*?\])` ifadesi ilk `]` karakterinde kesiliyordu;
  liste iç içe dizi içerdiğinde JSON bozuk çıkıyordu. JSON artık parantezler sayılarak çıkarılıyor.
- **Gemini çalışmayınca elle gönderilen e-postalara sahte özet yazılıyordu**: başlıkta "bölüm" geçen her videoya
  "atmosferik ve zorlu anlar…" gibi uydurma bir metin konuyordu. Artık açıkça "özet oluşturulamadı" deniyor.
- Durum dosyası kaybolunca sahte varsayılan kanallar (yanlış video kimlikleriyle) yükleniyor ve ilk taramada
  bu kanallar için yersiz e-posta gidiyordu.
- Her sayfa açılışında otomatik olarak bir Gemini özeti üretiliyordu (gereksiz kota kullanımı).
- Saatler sunucunun saat diliminde (Cloud Run'da UTC) gösteriliyordu; Türkiye saatinden 3 saat geri.
- Abone sayıları elle yazılmış sabit bir tablodan geliyordu ve gerçek değerin üzerine yazılıyordu.
- Yazım yarıda kesilirse durum dosyası bozulabiliyordu; artık önce geçici dosyaya yazılıyor.
- `&amp;lt;` gibi değerler iki kez çözülüyordu.
- `bot.py sync` başarısız olunca kanal listeni sessizce varsayılan 15 kanalla eziyordu.
- Angular'ın yeni Host kontrolü her sayfa isteğinde uyarı veriyordu.

## İyileştirmeler

- **Gemini videoyu izliyor**: özet artık açıklamadan değil, videonun görüntü ve sesinden çıkarılıyor
  (2 saatten uzun videolarda altyazıya geçiliyor). Bu Ayarlar'dan kapatılabilir.
- Özet yapılandırılmış JSON olarak isteniyor: "Kısaca" cümlesi, paragraflar, öne çıkanlar. Açıklamadaki
  bölümler e-postada zaman damgalı linklere dönüşüyor.
- Shorts videoları atlanabiliyor; prömiyer ve canlı yayınlar bitene kadar bekleniyor.
- Özet dili (Türkçe/İngilizce) ve uzunluğu seçilebiliyor; birden fazla alıcı eklenebiliyor; tarama sıklığı ayarlanabiliyor.
- Kanal başına duraklatma, toplu ekleme (eski `channels.json` dahil) ve kanal listesini dışa aktarma.
- YouTube abonelikleri içe aktarılırken Google erişim jetonu artık sunucuya gönderilmiyor.
- Gemini model adları `gemini-flash-latest` takma adıyla güncel tutuluyor, `GEMINI_MODEL` ile değiştirilebiliyor.
- Yeni e-posta şablonu: Gmail ve mobilde düzgün görünen, düz metin alternatifi olan tasarım.
- Kullanılmayan bağımlılıklar (`@angular/material`, `@angular/cdk`, `motion`) ve eski Streamlit dosyaları
  (`app.py`, `worker.py`, `requirements.txt`) kaldırıldı. Firebase yalnızca abonelik aktarılırken yükleniyor.
- Sunucu için 44, arayüz için 2 otomatik test eklendi.

## Arayüz

Üç sayfa: **Akış** (gelen özetler, durumları ve etkinlik günlüğü), **Kanallar** (tek kutudan arama, link ya da
@kullanıcıadı ile ekleme) ve **Ayarlar**. Açık/koyu tema, mobilde alt menü, kurulum adımlarını gösteren
kontrol listesi ve e-posta önizlemesi var.
