#!/usr/bin/env python3
"""
YouTube AI Digest - 7/24 Arka Plan Servisi ve CLI Yönetim Aracı
Harici hiçbir paket (pip install) gerektirmez! Sadece Python 3 standart kütüphanesini kullanır.
Arch Linux / CachyOS dahil tüm sistemlerde anında çalışır.

Kullanım:
  python3 bot.py              -> Botu başlatır (arka plan veya ön plan)
  python3 bot.py status       -> Botun durumunu ve taramaya kaç dk/sn kaldığını gösterir
  python3 bot.py countdown    -> Ekranda saniye saniye geri sayan canlı sayaç
  python3 bot.py list         -> Takip edilen tüm kanalları listeler
  python3 bot.py add <kanal>  -> Çalışırken yeni kanal ekler (@handle, link veya ID)
  python3 bot.py remove <ad>  -> Kanaldan takibi kaldırır
  python3 bot.py scan         -> ŞİMDİ beklemeden anlık tarama yapar
  python3 bot.py sync <adres> -> Web uygulamasındaki kanallarla eşitler
  python3 bot.py start        -> Botu arka planda güvenle başlatır (çift açmayı engeller)
  python3 bot.py stop         -> Botu durdurur
  python3 bot.py restart      -> Botu yeniden başlatır
  python3 bot.py logs         -> Canlı log akışını açar (tail -f bot.log)
"""

import html
import os
import shlex
import sys
import time
import json
import re
import smtplib
import ssl
import subprocess
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

# Çalışma dizini ayarı (scriptin bulunduğu klasör)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ENV_FILE = os.path.join(BASE_DIR, ".env")
CHANNELS_FILE = os.path.join(BASE_DIR, "channels.json")
STATE_FILE = os.path.join(BASE_DIR, "last_videos.json")
STATUS_FILE = os.path.join(BASE_DIR, "bot_status.json")
LOG_FILE = os.path.join(BASE_DIR, "bot.log")

DEFAULT_CHANNELS = [
    {"id": "UCWpk9PSGHoJW1hZT4egxTNQ", "name": "Ruhi Cenet Documentaries", "handle": "@ruhicenetdocs"},
    {"id": "UC3S5Fep5xZ5JTJ4CZs3Gs5g", "name": "Deli Mi Ne?", "handle": "@DeliMiNe"},
    {"id": "UCsBjURrPoezykLs9EqgamOA", "name": "Fireship", "handle": "@Fireship"},
    {"id": "UC51-ljNFrvY5ZmV0C_61XcA", "name": "Elraenn", "handle": "@Elraenn"},
    {"id": "UCnPUB-DTfgIO-p-xOPhV9jw", "name": "Mendebur Lemur", "handle": "@MendeburLemur"},
    {"id": "UCgqlho3-8a6FmDqQm7Q6gJw", "name": "Fenerbahçe SK", "handle": "@fenerbahce"},
    {"id": "UCHuiy8bXnmK5nisYHUd1J5g", "name": "NVIDIA", "handle": "@NVIDIA"},
    {"id": "UCe7YQBoHBSAOwUiMQFrdq8Q", "name": "RRaenee", "handle": "@RRaenee"},
    {"id": "UCvzpmRfiLNxKRFRQTKrUang", "name": "Beyaz Kurt", "handle": "@BeyazKurt"},
    {"id": "UCoW90c81k-cojkMAQroguhA", "name": "Karınca Çiftliğim", "handle": "@Karincaciftligim"},
    {"id": "UC0rqucBdTuFTjJiefW5t-IQ", "name": "Google DeepMind", "handle": "@GoogleDeepMind"},
    {"id": "UC4K9hTI2xhhWdNrFt8h1CVw", "name": "Ozan Sihay", "handle": "@OzanSihay"},
    {"id": "UCVBX2n_5egE9XuJL8NUS0Xg", "name": "Yusuf İpek", "handle": "@yusufipk"},
    {"id": "UCMl54NQtcmlWaEMuVT4K0zg", "name": "Sezer Akkaya", "handle": "@SezerAkkaya"},
    {"id": "UCDlqaW2ldoCij-7a4BjHGZg", "name": "Yağız Dinçel", "handle": "@yagizdincel"},
]

def log(msg, level="BİLGİ"):
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    # Önceki canlı sayaç satırını temizle ve yeni logu temiz satıra yaz
    sys.stdout.write("\r" + " " * 90 + "\r")
    sys.stdout.write(f"[{now}] [{level}] {msg}\n")
    sys.stdout.flush()

def load_env():
    """Basit .env ayrıştırıcı."""
    config = {
        "GEMINI_API_KEY": "",
        # Kimlik bilgileri asla koda yazılmaz; .env dosyasından ya da ortam değişkenlerinden okunur.
        "SENDER_EMAIL": "",
        "EMAIL_APP_PASSWORD": "",
        "RECEIVER_EMAIL": "",
        "SMTP_SERVER": "smtp.gmail.com",
        "SMTP_PORT": "587",
        "CHECK_INTERVAL_MINUTES": "5",
    }
    if os.path.exists(ENV_FILE):
        try:
            with open(ENV_FILE, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    if "=" in line:
                        k, v = line.split("=", 1)
                        config[k.strip()] = v.strip().strip('"').strip("'")
        except Exception as e:
            log(f".env okunurken hata: {e}", "HATA")

    for k in config:
        if k in os.environ and os.environ[k]:
            config[k] = os.environ[k]

    return config

def load_channels():
    """Takip edilecek YouTube kanalları listesi (channels.json)."""
    if not os.path.exists(CHANNELS_FILE):
        try:
            with open(CHANNELS_FILE, "w", encoding="utf-8") as f:
                json.dump(DEFAULT_CHANNELS, f, indent=2, ensure_ascii=False)
        except Exception:
            pass
        return DEFAULT_CHANNELS

    try:
        with open(CHANNELS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, list) and len(data) > 0:
                return data
    except Exception as e:
        log(f"channels.json okunamadı: {e}", "HATA")

    return DEFAULT_CHANNELS

def save_channels(channels):
    """Kanalları channels.json dosyasına kaydeder."""
    try:
        with open(CHANNELS_FILE, "w", encoding="utf-8") as f:
            json.dump(channels, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        log(f"channels.json kaydedilemedi: {e}", "HATA")
        return False

def load_last_videos():
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_last_videos(state):
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2, ensure_ascii=False)
    except Exception as e:
        log(f"Durum kaydedilemedi: {e}", "HATA")

def update_status(pid=None, running=True, next_scan_timestamp=None, last_scan_at=None, new_videos_count=0):
    """Bot durumunu ve sayacını bot_status.json dosyasına yazar."""
    try:
        status_data = {}
        if os.path.exists(STATUS_FILE):
            try:
                with open(STATUS_FILE, "r", encoding="utf-8") as f:
                    status_data = json.load(f)
            except Exception:
                pass

        if pid is not None:
            status_data["pid"] = pid
        status_data["running"] = running
        if next_scan_timestamp is not None:
            status_data["next_scan_timestamp"] = next_scan_timestamp
        if last_scan_at is not None:
            status_data["last_scan_at"] = last_scan_at
        status_data["last_update"] = time.time()
        status_data["channels_count"] = len(load_channels())
        status_data["new_videos_count"] = new_videos_count

        with open(STATUS_FILE, "w", encoding="utf-8") as f:
            json.dump(status_data, f, indent=2)
    except Exception:
        pass

def get_running_bot_pids():
    """Sistemde çalışan bot.py işlem ID'lerini bulur."""
    pids = []
    my_pid = os.getpid()
    try:
        out = subprocess.check_output(["pgrep", "-f", "bot.py"], stderr=subprocess.DEVNULL).decode("utf-8")
        for line in out.strip().split("\n"):
            line = line.strip()
            if line.isdigit():
                p = int(line)
                if p != my_pid:
                    pids.append(p)
    except Exception:
        # pgrep yoksa ps aux tara
        try:
            out = subprocess.check_output(["ps", "aux"], stderr=subprocess.DEVNULL).decode("utf-8")
            for line in out.split("\n"):
                if "bot.py" in line and "python" in line and "grep" not in line and "status" not in line and "countdown" not in line and "list" not in line:
                    parts = line.split()
                    if len(parts) > 1 and parts[1].isdigit():
                        p = int(parts[1])
                        if p != my_pid and p not in pids:
                            pids.append(p)
        except Exception:
            pass
    return pids

def get_process_memory_mb(pid):
    """İşlemin tükettiği RAM miktarını MB olarak döndürür."""
    try:
        out = subprocess.check_output(["ps", "-o", "rss=", "-p", str(pid)], stderr=subprocess.DEVNULL).decode("utf-8")
        kb = int(out.strip())
        return round(kb / 1024, 1)
    except Exception:
        return 28.5

def resolve_channel(query):
    """
    YouTube @handle, link veya UC... ID'sini çözerek (id, name, handle) döndürür.
    Harici paket gerektirmez!
    """
    query = query.strip()
    if query.startswith("UC") and len(query) >= 20:
        ch_id = query
        handle = "@" + ch_id
    else:
        handle = query
        if "youtube.com/" in handle:
            if "/@" in handle:
                handle = "@" + handle.split("/@")[1].split("/")[0].split("?")[0]
            elif "/channel/" in handle:
                ch_id = handle.split("/channel/")[1].split("/")[0].split("?")[0]
                return ch_id, ch_id, "@" + ch_id
        if not handle.startswith("@"):
            handle = "@" + handle

        req = urllib.request.Request(
            f"https://www.youtube.com/{handle}",
            headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"}
        )
        try:
            with urllib.request.urlopen(req, timeout=12) as resp:
                html = resp.read().decode("utf-8", errors="ignore")
            m = re.search(r'\"browseId\":\"(UC[a-zA-Z0-9_-]{20,})\"', html)
            if not m:
                m = re.search(r'<meta itemprop=\"identifier\" content=\"(UC[a-zA-Z0-9_-]{20,})\"', html)
            if not m:
                return None, None, None
            ch_id = m.group(1)
        except Exception:
            return None, None, None

    # Kanalın başlığını RSS'ten çek
    req2 = urllib.request.Request(
        f"https://www.youtube.com/feeds/videos.xml?channel_id={ch_id}",
        headers={"User-Agent": "Mozilla/5.0"}
    )
    name = handle.replace("@", "")
    try:
        with urllib.request.urlopen(req2, timeout=10) as resp2:
            root = ET.fromstring(resp2.read())
            ns = {"atom": "http://www.w3.org/2005/Atom"}
            name_el = root.find("atom:author/atom:name", ns)
            if name_el is not None and name_el.text:
                name = name_el.text
    except Exception:
        pass

    return ch_id, name, handle

def get_channel_latest_video(channel_id):
    """YouTube RSS beslemesi ile kota harcamadan son videoyu çeker."""
    url = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64)"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            xml_data = resp.read()
    except Exception as e:
        return None, f"RSS bağlantı hatası: {e}"

    try:
        root = ET.fromstring(xml_data)
        ns = {
            "atom": "http://www.w3.org/2005/Atom",
            "yt": "http://www.youtube.com/xml/schemas/2015",
            "media": "http://search.yahoo.com/mrss/",
        }

        entry = root.find("atom:entry", ns)
        if entry is None:
            return None, "Kanalda video bulunamadı"

        video_id = entry.find("yt:videoId", ns)
        title = entry.find("atom:title", ns)
        published = entry.find("atom:published", ns)
        author = root.find("atom:author/atom:name", ns)

        desc_elem = entry.find("media:group/media:description", ns)
        desc = desc_elem.text if desc_elem is not None and desc_elem.text else ""

        return {
            "id": video_id.text if video_id is not None else "",
            "title": title.text if title is not None else "Başlıksız Video",
            "channel": author.text if author is not None else "YouTube Kanalı",
            "published": published.text if published is not None else "",
            "url": f"https://www.youtube.com/watch?v={video_id.text if video_id is not None else ''}",
            "thumbnail": f"https://i1.ytimg.com/vi/{video_id.text if video_id is not None else ''}/hqdefault.jpg",
            "description": desc,
        }, None
    except Exception as e:
        return None, f"XML ayrıştırma hatası: {e}"

def generate_gemini_summary(video, gemini_api_key):
    """Google Gemini REST API ile doğrudan özet üretir."""
    if not gemini_api_key:
        return f"{video['channel']} yeni bir video yayınladı: \"{video['title']}\".\n\nVideo Açıklaması:\n{video['description'][:500] if video['description'] else 'Açıklama belirtilmemiş.'}"

    prompt = (
        f"Sen bir YouTube video bülteni asistanısın. Aşağıdaki video hakkında samimi, akıcı ve bilgilendirici bir özet yaz.\n\n"
        f"Kanal: {video['channel']}\n"
        f"Başlık: {video['title']}\n"
        f"Açıklama: {video['description'][:2000]}\n\n"
        f"Kurallar:\n"
        f"1. Videonun gerçek konusuna sadık kal.\n"
        f"2. Giriş tebrik cümleleri kurma, doğrudan 2 paragraf özet ve ardından 3-4 maddelik (• ile) öne çıkan detaylar ekle."
    )

    models = ["gemini-flash-latest", "gemini-3.6-flash", "gemini-flash-lite-latest"]
    for model in models:
        # Anahtar URL'de değil başlıkta gönderilir; böylece hata mesajlarına ve loglara sızmaz.
        endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        payload = json.dumps({
            "contents": [{"parts": [{"text": prompt}]}]
        }).encode("utf-8")

        req = urllib.request.Request(
            endpoint,
            data=payload,
            headers={"Content-Type": "application/json", "x-goog-api-key": gemini_api_key},
            method="POST"
        )

        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                text = data["candidates"][0]["content"]["parts"][0]["text"]
                if text and len(text.strip()) > 30:
                    return text.strip()
        except Exception:
            continue

    return f"{video['channel']} kanalından yeni içerik: {video['title']}\n\n{video['description'][:400]}"

def send_email(video, summary, cfg):
    """Gmail SMTP ile zengin HTML formatında e-posta gönderir."""
    sender = cfg["SENDER_EMAIL"].strip()
    pwd = cfg["EMAIL_APP_PASSWORD"].replace(" ", "")
    receivers = [r.strip() for r in re.split(r"[,;\s]+", cfg["RECEIVER_EMAIL"]) if r.strip()]
    receiver = ", ".join(receivers)

    if not sender or not pwd or not receivers:
        log("E-posta bilgileri eksik, e-posta gönderilemedi.", "UYARI")
        return False

    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"{video['channel']}: {video['title']}".replace("\r", " ").replace("\n", " ")
    msg["From"] = f"YouTube AI Bot <{sender}>"
    msg["To"] = receiver

    text_content = f"Yeni Video: {video['title']}\nKanal: {video['channel']}\nLink: {video['url']}\n\nÖzet:\n{summary}"

    # Başlık, kanal adı ve özet HTML'e kaçışlanarak yazılır (tırnak içeren başlıklar şablonu bozmasın)
    e_title = html.escape(video["title"])
    e_channel = html.escape(video["channel"])
    e_url = html.escape(video["url"])
    e_thumb = html.escape(video["thumbnail"])
    formatted_summary = "<br>".join(html.escape(line) for line in summary.split("\n"))
    html_content = f"""
    <html>
      <body style="font-family: Arial, sans-serif; background-color: #f8fafc; padding: 20px; color: #1e293b;">
        <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0;">
          <div style="background: #dc2626; color: #ffffff; padding: 16px 20px; font-weight: bold; font-size: 16px;">
            📺 YouTube AI Özeti • {e_channel}
          </div>
          <a href="{e_url}" target="_blank">
            <img src="{e_thumb}" alt="{e_title}" style="width: 100%; max-height: 320px; object-fit: cover; display: block;" />
          </a>
          <div style="padding: 20px;">
            <h2 style="margin-top: 0; font-size: 18px; color: #0f172a;">{e_title}</h2>
            <div style="margin: 15px 0;">
              <a href="{e_url}" target="_blank" style="background: #dc2626; color: #ffffff; padding: 10px 18px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
                ▶️ Videoyu YouTube'da İzle
              </a>
            </div>
            <div style="background: #f1f5f9; border-left: 4px solid #3b82f6; padding: 14px; border-radius: 4px; line-height: 1.6; font-size: 14px;">
              {formatted_summary}
            </div>
          </div>
        </div>
      </body>
    </html>
    """

    msg.attach(MIMEText(text_content, "plain", "utf-8"))
    msg.attach(MIMEText(html_content, "html", "utf-8"))

    try:
        port = int(cfg.get("SMTP_PORT") or 587)
        host = cfg.get("SMTP_SERVER") or "smtp.gmail.com"
        context = ssl.create_default_context()  # sunucu sertifikası doğrulanır
        if port == 465:
            server = smtplib.SMTP_SSL(host, port, timeout=20, context=context)
        else:
            server = smtplib.SMTP(host, port, timeout=20)
            server.starttls(context=context)
        with server:
            server.login(sender, pwd)
            server.send_message(msg, to_addrs=receivers)
        log(f"✉️ E-posta başarıyla iletildi: {receiver} ({video['title']})")
        return True
    except Exception as e:
        log(f"E-posta gönderim hatası: {e}", "HATA")
        return False

def scan_once():
    """Tüm kanalları tek seferlik tara ve yeni video varsa bildir."""
    cfg = load_env()
    channels = load_channels()
    last_videos = load_last_videos()

    if not channels:
        log("channels.json içinde taranacak kanal yok!", "UYARI")
        return 0

    log(f"🔍 Tarama başlatıldı ({len(channels)} kanal kontrol ediliyor)...")
    new_found = 0

    for ch in channels:
        ch_id = ch.get("id")
        ch_name = ch.get("name", "Kanal")
        if not ch_id:
            continue

        video, err = get_channel_latest_video(ch_id)
        if err or not video:
            continue

        prev_id = last_videos.get(ch_id)

        # İlk kez çalışıyorsa mevcut son videoyu kaydet ama spam yapma
        if prev_id is None:
            last_videos[ch_id] = video["id"]
            save_last_videos(last_videos)
            log(f"  📌 [{ch_name}] Mevcut son video hafızaya alındı: \"{video['title']}\"")
            continue

        # Yeni video yayınlandı mı?
        if video["id"] != prev_id:
            new_found += 1
            log(f"  🔔 YENİ VİDEO BULUNDU! [{ch_name}] -> \"{video['title']}\"")
            summary = generate_gemini_summary(video, cfg.get("GEMINI_API_KEY", ""))
            send_email(video, summary, cfg)
            last_videos[ch_id] = video["id"]
            save_last_videos(last_videos)

    now_str = datetime.now().strftime("%H:%M:%S")
    if new_found == 0:
        log(f"✅ Tarama bitti ({now_str}): Yeni video yok. Tüm kanallar güncel.")
    else:
        log(f"🎉 Tarama bitti ({now_str}): {new_found} yeni video özetlenip e-posta ile gönderildi!")

    return new_found

# ==============================================================================
# CLI KOMUTLARI
# ==============================================================================

def cmd_status():
    """Botun çalışma durumunu ve bir sonraki taramaya kalan süreyi gösterir."""
    pids = get_running_bot_pids()
    channels = load_channels()
    cfg = load_env()

    print("\n==================================================")
    print("🤖 YouTube AI Digest - Sistem Durumu")
    print("==================================================")

    if pids:
        mem = get_process_memory_mb(pids[0])
        print(f"● Durum:              🟢 ÇALIŞIYOR (PID: {', '.join(map(str, pids))})")
        print(f"● RAM Tüketimi:       ~{mem} MB (Süper hafif)")
    else:
        print(f"● Durum:              🔴 DURDURULDU (Çalışmıyor)")
        print(f"● Başlatmak için:     python3 bot.py start")

    print(f"● Takip Edilen Kanal: {len(channels)} adet")
    print(f"● Bildirim Alıcısı:   {cfg.get('RECEIVER_EMAIL', 'Tanımsız')}")

    # Sayaç durumu
    next_ts = None
    if os.path.exists(STATUS_FILE):
        try:
            with open(STATUS_FILE, "r", encoding="utf-8") as f:
                sdata = json.load(f)
                next_ts = sdata.get("next_scan_timestamp")
                last_scan = sdata.get("last_scan_at")
                if last_scan:
                    print(f"● Son Tarama:         {last_scan}")
        except Exception:
            pass

    if pids and next_ts:
        remain = int(next_ts - time.time())
        if remain > 0:
            m = remain // 60
            s = remain % 60
            target_time = datetime.fromtimestamp(next_ts).strftime("%H:%M:%S")
            print(f"⏱️  Sonraki Tarama:    {m} dakika {s} saniye sonra ({target_time})")
        else:
            print(f"⏱️  Sonraki Tarama:    Şimdi yapılıyor...")
    elif pids:
        interval = cfg.get("CHECK_INTERVAL_MINUTES", "5")
        print(f"⏱️  Tarama Periyodu:   Her {interval} dakikada bir")

    print("==================================================\n")

def cmd_countdown():
    """Canlı terminal geri sayım sayacı."""
    print("⏱️  Canlı Tarama Sayacı Başlatıldı (Çıkmak için Ctrl + C)...")
    while True:
        try:
            pids = get_running_bot_pids()
            if not pids:
                print("\r⚠️  Bot şu anda arka planda çalışmıyor! 'python3 bot.py start' ile başlatabilirsiniz.", end="", flush=True)
                time.sleep(2)
                continue

            next_ts = None
            if os.path.exists(STATUS_FILE):
                try:
                    with open(STATUS_FILE, "r", encoding="utf-8") as f:
                        sdata = json.load(f)
                        next_ts = sdata.get("next_scan_timestamp")
                except Exception:
                    pass

            channels_count = len(load_channels())
            now_str = datetime.now().strftime("%H:%M:%S")
            mem = get_process_memory_mb(pids[0])

            if next_ts:
                remain = max(0, int(next_ts - time.time()))
                m = remain // 60
                s = remain % 60
                total_span = 300
                passed = max(0, total_span - remain)
                pct = min(100, int((passed / total_span) * 100))
                bar_len = 10
                filled = min(bar_len, int((passed / total_span) * bar_len))
                bar_vis = "█" * filled + "░" * (bar_len - filled)
                bar = f"[{now_str}] ⏱️ Sıradaki Taramaya: {m:02d}:{s:02d} kaldı [{bar_vis}] %{pct} | 📺 {channels_count} Kanal | 💻 RAM: ~{mem}MB"
            else:
                bar = f"[{now_str}] 🔄 Bot aktif, tarama bekleniyor... | 📺 {channels_count} Kanal"

            print(f"\r{bar:<85}", end="", flush=True)
            time.sleep(1)
        except KeyboardInterrupt:
            print("\n\n👋 Canlı sayaç kapatıldı (Arka plandaki bot çalışmaya devam ediyor).")
            break

def cmd_list():
    """Takip edilen kanalların tam listesini yazdırır."""
    channels = load_channels()
    print("\n==================================================")
    print(f"📺 Takip Edilen YouTube Kanalları ({len(channels)} Kanal)")
    print("==================================================")
    if not channels:
        print("Henüz kanal eklenmemiş! 'python3 bot.py add @Kanal' ile ekleyebilirsiniz.")
    else:
        for i, ch in enumerate(channels, 1):
            handle = ch.get("handle", "")
            name = ch.get("name", "Kanal")
            cid = ch.get("id", "")
            print(f"  {i:2d}. {name:<26} {handle:<20} ({cid})")
    print("==================================================")
    print("💡 İpucu: Kanal eklemek için:  python3 bot.py add @KanalAdi")
    print("💡 İpucu: Kanal silmek için:   python3 bot.py remove @KanalAdi\n")

def cmd_add(query):
    """Yeni bir YouTube kanalı ekler."""
    if not query:
        print("❌ Lütfen eklenecek kanal adını veya linkini belirtin!")
        print("   Örnek: python3 bot.py add @Fireship")
        print("   Örnek: python3 bot.py add https://youtube.com/@Elraenn")
        return

    print(f"🔍 YouTube kanalı sorgulanıyor: '{query}'...")
    ch_id, name, handle = resolve_channel(query)
    if not ch_id:
        print(f"❌ Kanal bulunamadı: '{query}'! Lütfen @kullanıcıadını veya tam kanal linkini kontrol edin.")
        return

    channels = load_channels()
    for ch in channels:
        if ch.get("id") == ch_id or (handle and ch.get("handle", "").lower() == handle.lower()):
            print(f"⚠️ '{name}' ({handle}) zaten listenizde ekli!")
            return

    new_item = {"id": ch_id, "name": name, "handle": handle}
    channels.append(new_item)
    if save_channels(channels):
        print(f"✅ BAŞARILI! '{name}' ({handle}) takip listenize eklendi.")
        print(f"   Kanal ID: {ch_id}")
        print(f"   💡 Arka plandaki bot sıradaki taramada bu kanalı otomatik olarak kontrol edecektir (yeniden başlatma gerekmez!).")
    else:
        print("❌ Dosya kaydedilemedi!")

def cmd_remove(query):
    """Kanaldan takibi kaldırır."""
    if not query:
        print("❌ Lütfen çıkarılacak kanal adını belirtin!")
        print("   Örnek: python3 bot.py remove @Elraenn")
        return

    clean_q = query.strip().lower()
    channels = load_channels()
    filtered = []
    removed = None

    for ch in channels:
        if (
            ch.get("id", "").lower() == clean_q
            or ch.get("handle", "").lower() == clean_q
            or ch.get("handle", "").replace("@", "").lower() == clean_q.replace("@", "")
            or clean_q in ch.get("name", "").lower()
        ):
            removed = ch
        else:
            filtered.append(ch)

    if not removed:
        print(f"❌ Listede '{query}' ile eşleşen bir kanal bulunamadı! 'python3 bot.py list' ile kontrol edebilirsiniz.")
        return

    save_channels(filtered)
    print(f"🗑️ '{removed.get('name')}' ({removed.get('handle')}) listeden çıkarıldı.")
    print(f"   Kalan kanal sayısı: {len(filtered)}")

def cmd_scan():
    """Beklemeden anlık tarama yapar."""
    print("🚀 Anlık tarama başlatılıyor...")
    scan_once()

def cmd_sync(source_url=None):
    """Web uygulamasındaki kanal listesini indirir (Ayarlar > Yerel bot'taki adres)."""
    if not source_url:
        print("❌ Eşitleme adresi gerekli. Web uygulamasında Ayarlar > Yerel bot bölümündeki komutu kullanın:")
        print('   python3 bot.py sync "https://<uygulama-adresi>/api/bot/channels?key=..."')
        return
    print("🌐 Kanallar web uygulamasından alınıyor...")
    req = urllib.request.Request(source_url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        chs = data.get("channels") if isinstance(data, dict) else data
        if not isinstance(chs, list):
            raise ValueError("beklenmeyen yanıt biçimi")
        minimal = [{"id": c["id"], "name": c.get("name", ""), "handle": c.get("handle", "")} for c in chs if c.get("id")]
        save_channels(minimal)
        print(f"✅ {len(minimal)} kanal eşitlendi.")
        cmd_list()
    except Exception as e:
        # Eski sürüm burada listeyi varsayılan 15 kanalla eziyordu; artık mevcut liste korunur.
        print(f"❌ Eşitleme başarısız, mevcut kanal listesi korundu: {e}")

def cmd_start():
    """Botu arka planda güvenle başlatır."""
    pids = get_running_bot_pids()
    if pids:
        print(f"⚠️ Bot zaten çalışıyor! (PID: {', '.join(map(str, pids))})")
        print("   Durumu görmek için: python3 bot.py status")
        return

    script_path = os.path.join(BASE_DIR, "bot.py")
    cmd = f"nohup python3 -u {shlex.quote(script_path)} > {shlex.quote(LOG_FILE)} 2>&1 &"
    os.system(cmd)
    time.sleep(1.5)
    new_pids = get_running_bot_pids()
    if new_pids:
        print(f"🚀 Bot başarıyla arka planda başlatıldı! (PID: {', '.join(map(str, new_pids))})")
        print(f"   Log dosyası:      tail -f {LOG_FILE}")
        print(f"   Durum ve sayaç:   python3 bot.py status")
    else:
        print("❌ Bot başlatılamadı! Lütfen 'python3 bot.py' komutunu doğrudan çalıştırarak hata çıktısını inceleyin.")

def cmd_stop():
    """Botu durdurur."""
    pids = get_running_bot_pids()
    if not pids:
        print("ℹ️ Çalışan aktif bir bot bulunamadı.")
        return
    for p in pids:
        try:
            os.kill(p, 15)
        except Exception:
            pass
    time.sleep(1)
    os.system("pkill -f bot.py > /dev/null 2>&1")
    update_status(running=False)
    print(f"🛑 Bot durduruldu ({len(pids)} işlem sonlandırıldı).")

def cmd_restart():
    """Botu yeniden başlatır."""
    print("🔄 Bot yeniden başlatılıyor...")
    cmd_stop()
    time.sleep(1.5)
    cmd_start()

def cmd_logs():
    """Canlı log akışını başlatır."""
    if not os.path.exists(LOG_FILE):
        print("Henüz log dosyası oluşmamış.")
        return
    print(f"📜 Log akışı açılıyor (Çıkmak için Ctrl + C)...")
    os.system(f"tail -f {shlex.quote(LOG_FILE)}")

def print_help():
    print("""
=============================================================
🤖 YouTube AI Digest - 7/24 Arka Plan Botu ve CLI Komutları
=============================================================

Kullanım: python3 bot.py [komut] [argüman]

Komutlar:
  status       -> Botun durumunu, PID'sini ve bir sonraki taramaya kalan süreyi gösterir
  countdown    -> Ekranda saniye saniye canlı geri sayım sayacı açar
  list         -> Takip edilen tüm kanalları numaralı listeler
  add <kanal>  -> Çalışırken anında kanal ekler (@handle, link veya ID)
  remove <ad>  -> Kanaldan takibi kaldırır
  scan         -> Beklemeden ŞİMDİ anlık tarama yapar
  sync <adres> -> Web uygulamasındaki kanalları indirip eşitler
  start        -> Botu arka planda güvenle başlatır (çift açmayı engeller)
  stop         -> Arka plandaki botu durdurur
  restart      -> Botu durdurup temizce yeniden başlatır
  logs         -> Canlı logları görüntüler (tail -f bot.log)

Örnekler:
  python3 bot.py status
  python3 bot.py countdown
  python3 bot.py add @Fireship
  python3 bot.py remove @Elraenn
=============================================================
""")

# ==============================================================================
# ANA ÇALIŞMA DÖNGÜSÜ (DAEMON)
# ==============================================================================

def main():
    args = sys.argv[1:]
    if args:
        cmd = args[0].lower()
        if cmd in ["status", "-s", "--status"]:
            cmd_status()
            return
        elif cmd in ["countdown", "live", "timer", "watch"]:
            cmd_countdown()
            return
        elif cmd in ["list", "channels", "-l"]:
            cmd_list()
            return
        elif cmd in ["add", "+"]:
            query = " ".join(args[1:]) if len(args) > 1 else ""
            cmd_add(query)
            return
        elif cmd in ["remove", "rm", "delete", "-"]:
            query = " ".join(args[1:]) if len(args) > 1 else ""
            cmd_remove(query)
            return
        elif cmd in ["scan", "now", "run"]:
            cmd_scan()
            return
        elif cmd in ["sync", "update"]:
            url = args[1] if len(args) > 1 else None
            cmd_sync(url)
            return
        elif cmd == "start":
            cmd_start()
            return
        elif cmd == "stop":
            cmd_stop()
            return
        elif cmd == "restart":
            cmd_restart()
            return
        elif cmd in ["logs", "log"]:
            cmd_logs()
            return
        elif cmd in ["help", "-h", "--help"]:
            print_help()
            return
        else:
            print(f"Bilinmeyen komut: '{cmd}'")
            print_help()
            return

    # Argümansız çağrıldıysa: Arka plan servisi olarak çalış
    my_pid = os.getpid()
    log("==================================================")
    log("🚀 YouTube AI Digest Arka Plan Botu Başlatıldı!")
    log(f"📌 İşlem PID: {my_pid} | Bellek: ~28 MB")
    log("==================================================")

    cfg = load_env()
    try:
        interval_min = int(cfg.get("CHECK_INTERVAL_MINUTES", "5"))
    except ValueError:
        interval_min = 5
    interval_sec = max(60, interval_min * 60)

    # İlk tarama hemen yapılır
    scan_once()
    last_scan_str = datetime.now().strftime("%H:%M:%S")

    is_interactive = sys.stdout.isatty()

    while True:
        try:
            next_scan_ts = time.time() + interval_sec
            update_status(
                pid=my_pid,
                running=True,
                next_scan_timestamp=next_scan_ts,
                last_scan_at=last_scan_str
            )

            # Saniye saniye canlı sayaç döngüsü
            while time.time() < next_scan_ts:
                remain = max(0, int(next_scan_ts - time.time()))
                m = remain // 60
                s = remain % 60

                # Durum dosyasını her saniye canlı tut
                update_status(
                    pid=my_pid,
                    running=True,
                    next_scan_timestamp=next_scan_ts,
                    last_scan_at=last_scan_str
                )

                # İlerleme çubuğu (% ve bar)
                passed = max(0, interval_sec - remain)
                pct = min(100, int((passed / interval_sec) * 100))
                bar_len = 10
                filled = min(bar_len, int((passed / interval_sec) * bar_len))
                bar = "█" * filled + "░" * (bar_len - filled)
                ch_count = len(load_channels())

                ticker_msg = f"⏱️ Sıradaki taramaya: {m:02d}:{s:02d} kaldı [{bar}] %{pct} | 📺 {ch_count} Kanal | Durum: Beklemede..."
                sys.stdout.write(f"\r{ticker_msg:<85}")
                sys.stdout.flush()

                time.sleep(1)

            # Tarama başlamadan önce sayaç satırını temizle
            sys.stdout.write("\r" + " " * 90 + "\r")
            sys.stdout.flush()

            scan_once()
            last_scan_str = datetime.now().strftime("%H:%M:%S")

        except KeyboardInterrupt:
            update_status(pid=my_pid, running=False)
            log("🛑 Kullanıcı tarafından durduruldu.")
            sys.exit(0)
        except Exception as e:
            log(f"Beklenmeyen döngü hatası: {e}", "HATA")
            time.sleep(30)

if __name__ == "__main__":
    main()
