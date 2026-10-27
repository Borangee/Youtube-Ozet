# Notlar

Yapılacaklar ve kararlar. Tamamlananlar işaretli.

- [x] **Gemini API anahtarı girilmeden "Bağlantıyı test et" çalışmamalı.**
  Anahtar yokken düğme pasif ve yanında "Test etmek için önce anahtarı yapıştır" yazıyor; sunucu da anahtarsız
  isteği reddediyor. Kutuya yeni bir anahtar yazıldıysa, kaydetmeden önce o anahtar denenebiliyor.

- [x] **Gemini yerine Claude ya da başka bir yapay zekâ bağlansa daha mı iyi olur?** Karar: Gemini kalıyor.
  - Gemini, YouTube linkini doğrudan alıp videonun görüntüsünü ve sesini işleyebiliyor. Uygulamanın en isabetli
    özeti ("videoyu izleyerek özetle") buna dayanıyor.
  - Claude API'si metin, görsel ve PDF alıyor; video ya da YouTube linki almıyor. Claude ile özet için önce videonun
    altyazısını (transkriptini) çekmek gerekir. YouTube altyazıları sunucudan güvenilir şekilde çekilemiyor; altyazı
    yoksa yalnızca açıklamadan özet çıkar.
  - Altyazı varsa Claude Türkçe yazımda iyi sonuç verebilir; maliyet modele göre değişir (en ucuzu Claude Haiku 5.5,
    milyon token başına $0.10 giriş / $0.50 çıkış). Gemini'nin ücretsiz katmanı ise kişisel kullanım için genelde yetiyor.
  - Öneri: ana özetleyici Gemini kalsın. İstenirse "altyazı varsa Claude ile yaz" gibi isteğe bağlı ikinci bir
    sağlayıcı eklenebilir.

- [x] **Elle özetlemede Shorts videoları farklı görünsün.**
  Shorts dikey, kırmızı çerçeveli küçük resim ve "Shorts" etiketiyle gösteriliyor. Listede Shorts varsa
  "Tümü / Videolar / Shorts" filtresi çıkıyor.

- [x] **Başka bir uygulamayla port çakışması.** Uygulama artık 3000 yerine **3500** portunda açılıyor:
  http://localhost:3500 (Chrome ve Firefox'ta http://ozetci.localhost:3500 adresi de çalışır).
