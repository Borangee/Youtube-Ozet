#!/usr/bin/env python3
"""
YouTube Özet botu - web uygulamasına gerek kalmadan kendi bilgisayarında çalışan sürüm.

Takip ettiğin kanalları belirli aralıklarla kontrol eder, yeni video yüklenince
Gemini ile özetleyip e-postana gönderir. Yalnızca Python 3.8+ standart
kütüphanesini kullanır; pip ile hiçbir şey kurmak gerekmez. Windows ve Linux'ta çalışır.

Kullanım (Windows'ta "python3" yerine "py" ya da "python" yaz):
  python3 bot.py test              Ayarları dener: Gemini anahtarı ve test e-postası
  python3 bot.py run               Ön planda çalıştırır (Ctrl+C ile durur)
  python3 bot.py start             Arka planda başlatır
  python3 bot.py stop              Arka plandaki botu durdurur
  python3 bot.py restart           Yeniden başlatır
  python3 bot.py status            Çalışıyor mu, sonraki tarama ne zaman
  python3 bot.py logs              Günlüğü canlı izler (Ctrl+C ile çıkılır)
  python3 bot.py scan              Beklemeden hemen bir tarama yapar
  python3 bot.py list              Takip edilen kanalları listeler
  python3 bot.py add <kanal>       Kanal ekler (@kullanıcıadı, link ya da kanal kimliği)
  python3 bot.py remove <kanal>    Kanalı takipten çıkarır
  python3 bot.py sync "<adres>"    Kanal listesini web uygulamasından alır
  python3 bot.py autostart on      Bilgisayar açılınca otomatik başlat
  python3 bot.py autostart off     Otomatik başlatmayı kapat
  python3 bot.py autostart status  Otomatik başlatma açık mı
"""

import html
import json
import os
import re
import shutil
import signal
import smtplib
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

IS_WINDOWS = os.name == "nt"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPT_PATH = os.path.abspath(__file__)
ENV_FILE = os.path.join(BASE_DIR, ".env")
CHANNELS_FILE = os.path.join(BASE_DIR, "channels.json")
STATE_FILE = os.path.join(BASE_DIR, "last_videos.json")
STATUS_FILE = os.path.join(BASE_DIR, "bot_status.json")
PID_FILE = os.path.join(BASE_DIR, "bot.pid")
LOG_FILE = os.path.join(BASE_DIR, "bot.log")

SERVICE_NAME = "youtube-ozet-bot"
NOTIFY_MAX_AGE_SEC = 72 * 3600  # bundan eski videolar için e-posta gönderilmez
MAX_NEW_PER_CHANNEL = 3
MAX_SEND_ATTEMPTS = 3
GEMINI_MODELS = ["gemini-flash-latest", "gemini-3.6-flash", "gemini-flash-lite-latest"]
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

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


# ==============================================================================
# GÜNLÜK VE DOSYALAR
# ==============================================================================

def _safe_console():
    """Konsol Türkçe karakter/emoji basamazsa çökmek yerine soru işareti bassın."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except Exception:
            pass


_daemon_logging = False


def log(msg, level="BİLGİ"):
    line = f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] [{level}] {msg}"
    if _daemon_logging:
        # Arka planda çalışırken her şey bot.log dosyasına yazılır
        try:
            with open(LOG_FILE, "a", encoding="utf-8") as f:
                f.write(line + "\n")
        except Exception:
            pass
    if sys.stdout is not None and (not _daemon_logging or sys.stdout.isatty()):
        try:
            # Terminaldeyse önce canlı geri sayım satırını temizle
            clear = "\r" + " " * 70 + "\r" if sys.stdout.isatty() else ""
            sys.stdout.write(clear + line + "\n")
            sys.stdout.flush()
        except Exception:
            pass


def read_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def write_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp, path)


def load_env():
    """bot.py'nin yanındaki .env dosyasını okur; ortam değişkenleri önceliklidir."""
    config = {
        "GEMINI_API_KEY": "",
        # Kimlik bilgileri asla koda yazılmaz; .env dosyasından ya da ortam değişkenlerinden okunur.
        "SENDER_EMAIL": "",
        "EMAIL_APP_PASSWORD": "",
        "RECEIVER_EMAIL": "",
        "SMTP_SERVER": "smtp.gmail.com",
        "SMTP_PORT": "587",
        "CHECK_INTERVAL_MINUTES": "5",
        "SKIP_SHORTS": "1",
    }
    if os.path.exists(ENV_FILE):
        try:
            with open(ENV_FILE, "r", encoding="utf-8-sig") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    config[k.strip()] = v.split(" #")[0].strip().strip('"').strip("'")
        except Exception as e:
            log(f".env okunamadı: {e}", "HATA")
    for k in list(config):
        if os.environ.get(k):
            config[k] = os.environ[k]
    if config.get("SMTP_HOST") and config["SMTP_SERVER"] == "smtp.gmail.com":
        config["SMTP_SERVER"] = config["SMTP_HOST"]
    return config


def load_channels():
    if not os.path.exists(CHANNELS_FILE):
        try:
            write_json(CHANNELS_FILE, DEFAULT_CHANNELS)
        except Exception:
            pass
        return list(DEFAULT_CHANNELS)
    data = read_json(CHANNELS_FILE, None)
    if isinstance(data, list):
        return [c for c in data if isinstance(c, dict) and c.get("id")]
    log("channels.json okunamadı, varsayılan liste kullanılıyor.", "UYARI")
    return list(DEFAULT_CHANNELS)


def save_channels(channels):
    try:
        write_json(CHANNELS_FILE, channels)
        return True
    except Exception as e:
        log(f"channels.json kaydedilemedi: {e}", "HATA")
        return False


def load_state():
    """
    Her kanal için görülen video kimlikleri ve gönderilemeyip tekrar denenecek e-postalar.
    Eski sürümdeki {kanal: son_video} biçimi otomatik dönüştürülür.
    """
    raw = read_json(STATE_FILE, {})
    if "seen" not in raw:
        raw = {"seen": {k: [v] for k, v in raw.items() if isinstance(v, str)}, "pending": []}
    raw.setdefault("seen", {})
    raw.setdefault("pending", [])
    return raw


def save_state(state):
    try:
        write_json(STATE_FILE, state)
    except Exception as e:
        log(f"Durum kaydedilemedi: {e}", "HATA")


def write_status(**fields):
    data = read_json(STATUS_FILE, {})
    data.update(fields)
    data["updated_at"] = time.time()
    try:
        write_json(STATUS_FILE, data)
    except Exception:
        pass


# ==============================================================================
# SÜREÇ YÖNETİMİ (Windows ve Linux)
# ==============================================================================

def _windows_process_image(pid):
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.windll.kernel32
    handle = kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not handle:
        return None
    try:
        code = wintypes.DWORD()
        if not kernel32.GetExitCodeProcess(handle, ctypes.byref(code)) or code.value != 259:  # STILL_ACTIVE
            return None
        buf = ctypes.create_unicode_buffer(1024)
        size = wintypes.DWORD(1024)
        if kernel32.QueryFullProcessImageNameW(handle, 0, buf, ctypes.byref(size)):
            return buf.value
        return ""
    finally:
        kernel32.CloseHandle(handle)


def is_bot_process(pid):
    """PID hâlâ çalışan bir bot sürecine mi ait? (Yeniden kullanılan PID'leri ayıklar.)"""
    if not pid or pid == os.getpid():
        return False
    if IS_WINDOWS:
        image = _windows_process_image(pid)
        return image is not None and "python" in os.path.basename(image).lower()
    try:
        os.kill(pid, 0)  # POSIX'te sinyal 0 süreci öldürmez, yalnızca var mı diye bakar
    except OSError:
        return False
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            return b"bot.py" in f.read()
    except OSError:
        return True  # /proc yoksa (macOS) var olduğunu kabul et


def running_pid():
    data = read_json(PID_FILE, {})
    pid = data.get("pid") if isinstance(data, dict) else None
    return pid if isinstance(pid, int) and is_bot_process(pid) else None


def python_for_background():
    """Windows'ta arka plan için pencere açmayan pythonw.exe kullanılır."""
    if IS_WINDOWS:
        candidate = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
        if os.path.exists(candidate):
            return candidate
    return sys.executable


def systemd_unit_path():
    return os.path.join(os.path.expanduser("~"), ".config", "systemd", "user", f"{SERVICE_NAME}.service")


def systemd_managed():
    return not IS_WINDOWS and os.path.exists(systemd_unit_path())


def systemctl(*args):
    return subprocess.run(["systemctl", "--user", *args], capture_output=True, text=True)


def windows_startup_dir():
    return os.path.join(os.environ.get("APPDATA", ""), "Microsoft", "Windows", "Start Menu", "Programs", "Startup")


# ==============================================================================
# YOUTUBE
# ==============================================================================

NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "yt": "http://www.youtube.com/xml/schemas/2015",
    "media": "http://search.yahoo.com/mrss/",
}


def http_get(url, timeout=15):
    req = urllib.request.Request(
        url,
        headers={"User-Agent": UA, "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8", "Cookie": "SOCS=CAI; CONSENT=YES+cb"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def get_channel_videos(channel_id):
    """RSS beslemesinden kanalın son videolarını (en yeniden eskiye) döner."""
    try:
        xml_data = http_get(f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}")
    except Exception as e:
        return None, None, f"RSS alınamadı: {e}"
    try:
        root = ET.fromstring(xml_data)
    except Exception as e:
        return None, None, f"RSS okunamadı: {e}"
    author = root.find("atom:author/atom:name", NS)
    channel_name = author.text if author is not None else None
    videos = []
    for entry in root.findall("atom:entry", NS):
        vid = entry.find("yt:videoId", NS)
        if vid is None or not vid.text:
            continue
        title = entry.find("atom:title", NS)
        published = entry.find("atom:published", NS)
        desc = entry.find("media:group/media:description", NS)
        link = entry.find("atom:link[@rel='alternate']", NS)
        videos.append({
            "id": vid.text,
            "title": title.text if title is not None and title.text else "Başlıksız video",
            "channel": channel_name or "YouTube kanalı",
            "published": published.text if published is not None else "",
            "url": f"https://www.youtube.com/watch?v={vid.text}",
            "thumbnail": f"https://i.ytimg.com/vi/{vid.text}/hqdefault.jpg",
            "description": desc.text if desc is not None and desc.text else "",
            "is_short": link is not None and "/shorts/" in (link.get("href") or ""),
        })
    return channel_name, videos, None


def published_ts(video):
    try:
        return datetime.fromisoformat(video["published"].replace("Z", "+00:00")).timestamp()
    except Exception:
        return time.time()


def resolve_channel(query):
    """@kullanıcıadı, link ya da kanal kimliğini (id, ad, @kullanıcıadı) olarak çözer."""
    query = query.strip()
    handle = ""
    m = re.search(r"(UC[0-9A-Za-z_-]{22})", query)
    if m and ("/channel/" in query or query.startswith("UC")):
        ch_id = m.group(1)
    else:
        handle = query
        if "youtube.com/" in handle and "/@" in handle:
            handle = "@" + handle.split("/@")[1].split("/")[0].split("?")[0]
        if not handle.startswith("@"):
            handle = "@" + handle
        try:
            page = http_get(f"https://www.youtube.com/{urllib.parse.quote(handle)}?hl=tr", timeout=12).decode("utf-8", "ignore")
        except Exception:
            return None, None, None
        m = (re.search(r'<link rel="canonical" href="https://www\.youtube\.com/channel/(UC[0-9A-Za-z_-]{22})"', page)
             or re.search(r'"externalId":"(UC[0-9A-Za-z_-]{22})"', page))
        if not m:
            return None, None, None
        ch_id = m.group(1)
    name, _, err = get_channel_videos(ch_id)
    if err:
        return None, None, None
    return ch_id, name or handle.lstrip("@") or ch_id, handle


# ==============================================================================
# GEMINI
# ==============================================================================

def _gemini_request(model, api_key, parts, video):
    body = {"contents": [{"role": "user", "parts": parts}]}
    if video:
        body["generationConfig"] = {"mediaResolution": "MEDIA_RESOLUTION_LOW"}
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        data=json.dumps(body).encode("utf-8"),
        # Anahtar URL'de değil başlıkta gönderilir; böylece hata mesajlarına ve loglara sızmaz.
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=180 if video else 60) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return "".join(p.get("text", "") for p in data["candidates"][0]["content"]["parts"]).strip()


def generate_gemini_summary(video, api_key):
    """Önce Gemini videoyu izleyerek özetler; olmazsa başlık ve açıklamadan özetler."""
    if not api_key:
        return None
    rules = (
        "Kurallar: Yalnızca videoda gerçekten geçen bilgileri yaz. 'Bu videoda' gibi girişler yapma. "
        "Markdown kullanma. Önce 'Kısaca:' ile başlayan tek cümle yaz, sonra 2-3 paragraf özet, "
        "sonra 'Öne çıkanlar:' başlığı altında • ile başlayan 3-5 madde. Türkçe yaz."
    )
    info = f"Kanal: {video['channel']}\nBaşlık: {video['title']}\nAçıklama:\n{video['description'][:4000]}"
    attempts = [
        ([{"fileData": {"fileUri": video["url"]}},
          {"text": "Ekteki YouTube videosunu izleyip e-posta bülteni için özetle.\n" + rules + "\n\n" + info}], True),
        ([{"text": "Videoya erişimin yok; yalnızca başlık ve açıklamaya göre özetle, uydurma.\n" + rules + "\n\n" + info}], False),
    ]
    last_error = None
    for parts, is_video in attempts:
        for model in GEMINI_MODELS:
            try:
                text = _gemini_request(model, api_key, parts, is_video)
                if len(text) > 30:
                    return text
            except urllib.error.HTTPError as e:
                last_error = f"{model}: HTTP {e.code}"
            except Exception as e:
                last_error = f"{model}: {e}"
    log(f"Gemini özeti alınamadı ({last_error}). Özetsiz gönderilecek.", "UYARI")
    return None


# ==============================================================================
# E-POSTA
# ==============================================================================

def send_email(video, summary, cfg):
    """Özeti HTML e-posta olarak gönderir. Sunucu sertifikası doğrulanır."""
    sender = cfg["SENDER_EMAIL"].strip()
    pwd = cfg["EMAIL_APP_PASSWORD"].replace(" ", "")
    receivers = [r for r in re.split(r"[,;\s]+", cfg["RECEIVER_EMAIL"]) if r]
    if not sender or not pwd or not receivers:
        log("E-posta bilgileri (.env) eksik; e-posta gönderilemedi.", "UYARI")
        return False

    body_text = summary or "Bu video için özet oluşturulamadı. Videoyu YouTube'da izleyebilirsin."
    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"{video['channel']}: {video['title']}".replace("\r", " ").replace("\n", " ")[:200]
    msg["From"] = f"YouTube Özet <{sender}>"
    msg["To"] = ", ".join(receivers)

    # Başlık, kanal adı ve özet HTML'e kaçışlanarak yazılır (tırnak içeren başlıklar şablonu bozmasın)
    e_title = html.escape(video["title"])
    e_channel = html.escape(video["channel"])
    e_url = html.escape(video["url"])
    e_thumb = html.escape(video["thumbnail"])
    paragraphs = "".join(
        f'<p style="margin:0 0 12px;line-height:1.65;font-size:15px;color:#27272a;">{html.escape(p).replace(chr(10), "<br>")}</p>'
        for p in body_text.split("\n\n") if p.strip()
    )
    font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
    html_content = f"""<!doctype html><html lang="tr"><body style="margin:0;padding:24px 12px;background:#f4f4f5;font-family:{font};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#fff;border:1px solid #e4e4e7;border-radius:16px;">
<tr><td style="padding:20px 24px 12px;font-size:14px;font-weight:600;color:#18181b;">{e_channel}<div style="font-weight:400;font-size:12px;color:#71717a;">yeni video yükledi</div></td></tr>
<tr><td style="padding:0 24px;"><a href="{e_url}"><img src="{e_thumb}" width="552" alt="{e_title}" style="display:block;width:100%;height:auto;border-radius:12px;border:0;"></a></td></tr>
<tr><td style="padding:16px 24px 4px;"><a href="{e_url}" style="font-size:19px;font-weight:700;line-height:1.35;color:#09090b;text-decoration:none;">{e_title}</a></td></tr>
<tr><td style="padding:12px 24px 16px;"><a href="{e_url}" style="display:inline-block;background:#e5484d;color:#fff;font-weight:600;font-size:14px;padding:11px 16px;border-radius:10px;text-decoration:none;">YouTube'da izle</a></td></tr>
<tr><td style="padding:4px 24px 12px;">{paragraphs}</td></tr>
<tr><td style="padding:14px 24px 20px;border-top:1px solid #f4f4f5;font-size:12px;color:#a1a1aa;">Bu özet Gemini ile hazırlandı. Yapay zekâ hata yapabilir.</td></tr>
</table></td></tr></table></body></html>"""

    msg.attach(MIMEText(f"{video['channel']} yeni video yükledi\n{video['title']}\n{video['url']}\n\n{body_text}", "plain", "utf-8"))
    msg.attach(MIMEText(html_content, "html", "utf-8"))

    try:
        port = int(cfg.get("SMTP_PORT") or 587)
        host = cfg.get("SMTP_SERVER") or "smtp.gmail.com"
        context = ssl.create_default_context()  # sunucu sertifikası doğrulanır
        if port == 465:
            server = smtplib.SMTP_SSL(host, port, timeout=30, context=context)
        else:
            server = smtplib.SMTP(host, port, timeout=30)
            server.starttls(context=context)
        with server:
            server.login(sender, pwd)
            server.send_message(msg, to_addrs=receivers)
        log(f"E-posta gönderildi: {video['title']}", "BAŞARILI")
        return True
    except smtplib.SMTPAuthenticationError:
        log("Gmail giriş bilgileri reddedildi. Normal şifre değil, 16 haneli uygulama şifresi gerekir.", "HATA")
    except Exception as e:
        log(f"E-posta gönderilemedi: {e}", "HATA")
    return False


# ==============================================================================
# TARAMA
# ==============================================================================

def scan_once():
    """Tüm kanalları bir kez tarar; yeni videoları özetleyip e-postayla gönderir."""
    cfg = load_env()
    channels = load_channels()
    state = load_state()
    skip_shorts = cfg.get("SKIP_SHORTS", "1").lower() not in ("0", "false", "hayir", "hayır", "no")
    now = time.time()

    # Önce önceki taramada gönderilemeyen e-postaları tekrar dene
    still_pending = []
    for item in state["pending"]:
        if send_email(item["video"], item.get("summary"), cfg):
            continue
        item["attempts"] = item.get("attempts", 1) + 1
        if item["attempts"] < MAX_SEND_ATTEMPTS:
            still_pending.append(item)
        else:
            log(f"\"{item['video']['title']}\" {MAX_SEND_ATTEMPTS} denemede gönderilemedi, vazgeçildi.", "HATA")
    state["pending"] = still_pending

    if not channels:
        log("Takip edilen kanal yok. 'bot.py add @kanal' ya da 'bot.py sync' ile ekle.", "UYARI")
        save_state(state)
        return 0

    log(f"Tarama başladı ({len(channels)} kanal).")
    new_found = 0
    for ch in channels:
        ch_id = ch["id"]
        ch_name = ch.get("name", "Kanal")
        _, videos, err = get_channel_videos(ch_id)
        if err:
            log(f"[{ch_name}] {err}", "UYARI")
            continue
        seen = state["seen"].get(ch_id)
        ids = [v["id"] for v in videos]
        if seen is None:
            # İlk kez görülen kanal: mevcut videolar için e-posta gönderilmez
            state["seen"][ch_id] = ids
            log(f"[{ch_name}] takibe alındı, {len(ids)} mevcut video kaydedildi.")
            continue
        fresh = [v for v in videos if v["id"] not in seen]
        state["seen"][ch_id] = (ids + [i for i in seen if i not in ids])[:60]
        fresh = [v for v in fresh if now - published_ts(v) <= NOTIFY_MAX_AGE_SEC][:MAX_NEW_PER_CHANNEL]
        for video in reversed(fresh):
            if skip_shorts and video["is_short"]:
                log(f"[{ch_name}] Shorts atlandı: {video['title']}")
                continue
            new_found += 1
            log(f"[{ch_name}] YENİ VİDEO: {video['title']}")
            summary = generate_gemini_summary(video, cfg.get("GEMINI_API_KEY", ""))
            if not send_email(video, summary, cfg):
                state["pending"].append({"video": video, "summary": summary, "attempts": 1})
        save_state(state)

    save_state(state)
    log(f"Tarama bitti: {new_found} yeni video." if new_found else "Tarama bitti: yeni video yok.")
    return new_found


# ==============================================================================
# KOMUTLAR
# ==============================================================================

def cmd_run():
    """Ön planda sürekli çalışır. 'start' ve otomatik başlatma da bunu kullanır."""
    global _daemon_logging
    _daemon_logging = True

    other = running_pid()
    if other:
        # Çıkış kodu 1: systemd gibi yöneticiler bunu hata sayıp biraz sonra yeniden dener
        log(f"Bot zaten çalışıyor (PID {other}). İkinci kopya açılmadı.", "UYARI")
        sys.exit(1)
    write_json(PID_FILE, {"pid": os.getpid(), "started_at": time.time()})

    def shutdown(*_):
        raise KeyboardInterrupt

    if not IS_WINDOWS:
        signal.signal(signal.SIGTERM, shutdown)

    cfg = load_env()
    try:
        interval = max(60, int(cfg.get("CHECK_INTERVAL_MINUTES", "5")) * 60)
    except ValueError:
        interval = 300
    log(f"Bot başladı (PID {os.getpid()}). Her {interval // 60} dakikada bir taranacak.")
    if not cfg.get("GEMINI_API_KEY"):
        log(".env içinde GEMINI_API_KEY yok; e-postalar özetsiz gidecek.", "UYARI")

    interactive = sys.stdout is not None and sys.stdout.isatty()
    try:
        while True:
            try:
                scan_once()
            except Exception as e:
                log(f"Tarama sırasında beklenmeyen hata: {e}", "HATA")
            next_scan = time.time() + interval
            write_status(pid=os.getpid(), running=True, next_scan_timestamp=next_scan,
                         last_scan_at=datetime.now().strftime("%H:%M:%S"), interval=interval)
            while time.time() < next_scan:
                if interactive:
                    remain = int(next_scan - time.time())
                    sys.stdout.write(f"\rSonraki tarama: {remain // 60:02d}:{remain % 60:02d}   (durdurmak için Ctrl+C)")
                    sys.stdout.flush()
                time.sleep(1)
            if interactive:
                sys.stdout.write("\r" + " " * 60 + "\r")
    except KeyboardInterrupt:
        log("Bot durduruldu.")
    finally:
        write_status(running=False)
        data = read_json(PID_FILE, {})
        if isinstance(data, dict) and data.get("pid") == os.getpid():
            try:
                os.remove(PID_FILE)
            except OSError:
                pass


def cmd_start():
    if systemd_managed():
        r = systemctl("start", f"{SERVICE_NAME}.service")
        print("Bot başlatıldı (systemd)." if r.returncode == 0 else f"Başlatılamadı: {r.stderr.strip()}")
        return
    pid = running_pid()
    if pid:
        print(f"Bot zaten çalışıyor (PID {pid}).")
        return
    kwargs = {"cwd": BASE_DIR, "stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL}
    if IS_WINDOWS:
        kwargs["creationflags"] = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    else:
        kwargs["start_new_session"] = True
    subprocess.Popen([python_for_background(), SCRIPT_PATH, "run"], **kwargs)
    for _ in range(20):
        time.sleep(0.25)
        pid = running_pid()
        if pid:
            print(f"Bot arka planda başladı (PID {pid}).")
            print("Günlüğü izlemek için:  bot.py logs")
            return
    print("Bot başlatılamadı. Hatayı görmek için 'bot.py run' ile ön planda çalıştır.")


def cmd_stop():
    if systemd_managed() and systemctl("is-active", f"{SERVICE_NAME}.service").stdout.strip() == "active":
        systemctl("stop", f"{SERVICE_NAME}.service")
        print("Bot durduruldu (systemd). Bilgisayar yeniden açılınca tekrar başlar; kapatmak için: bot.py autostart off")
        return
    pid = running_pid()
    if not pid:
        print("Çalışan bot yok.")
        return
    try:
        os.kill(pid, signal.SIGTERM)  # Windows'ta süreci sonlandırır
    except OSError as e:
        print(f"Durdurulamadı: {e}")
        return
    for _ in range(20):
        time.sleep(0.25)
        if not is_bot_process(pid):
            break
    try:
        os.remove(PID_FILE)
    except OSError:
        pass
    write_status(running=False)
    print(f"Bot durduruldu (PID {pid}).")


def cmd_restart():
    if systemd_managed():
        systemctl("restart", f"{SERVICE_NAME}.service")
        print("Bot yeniden başlatıldı (systemd).")
        return
    cmd_stop()
    time.sleep(1)
    cmd_start()


def cmd_status():
    cfg = load_env()
    pid = running_pid()
    status = read_json(STATUS_FILE, {})
    print()
    print(f"  Durum            : {'ÇALIŞIYOR (PID ' + str(pid) + ')' if pid else 'DURDURULDU'}")
    print(f"  Otomatik başlatma: {'açık' if autostart_enabled() else 'kapalı'}")
    print(f"  Kanal sayısı     : {len(load_channels())}")
    print(f"  Alıcı            : {cfg.get('RECEIVER_EMAIL') or '(.env içinde tanımlı değil)'}")
    print(f"  Gemini anahtarı  : {'var' if cfg.get('GEMINI_API_KEY') else 'YOK'}")
    if status.get("last_scan_at"):
        print(f"  Son tarama       : {status['last_scan_at']}")
    if pid and status.get("next_scan_timestamp"):
        remain = int(status["next_scan_timestamp"] - time.time())
        print(f"  Sonraki tarama   : {max(0, remain) // 60} dk {max(0, remain) % 60} sn sonra")
    print()


def cmd_logs():
    if not os.path.exists(LOG_FILE):
        print("Henüz günlük yok. Bot 'start' ile başlatılınca oluşur.")
        return
    print(f"{LOG_FILE} izleniyor (çıkmak için Ctrl+C)\n")
    with open(LOG_FILE, "r", encoding="utf-8", errors="replace") as f:
        for line in f.readlines()[-30:]:
            print(line, end="")
        try:
            while True:
                line = f.readline()
                if line:
                    print(line, end="")
                else:
                    time.sleep(1)
        except KeyboardInterrupt:
            print()


def cmd_list():
    channels = load_channels()
    print(f"\nTakip edilen kanallar ({len(channels)}):")
    for i, ch in enumerate(channels, 1):
        print(f"  {i:2d}. {ch.get('name', 'Kanal'):<28} {ch.get('handle', ''):<22} {ch['id']}")
    print()


def cmd_add(query):
    if not query:
        print("Kullanım: bot.py add @KanalAdi   (ya da kanal linki / kanal kimliği)")
        return
    print(f"'{query}' aranıyor...")
    ch_id, name, handle = resolve_channel(query)
    if not ch_id:
        print("Kanal bulunamadı. @kullanıcıadını ya da kanal linkini kontrol et.")
        return
    channels = load_channels()
    if any(c["id"] == ch_id for c in channels):
        print(f"'{name}' zaten listede.")
        return
    channels.append({"id": ch_id, "name": name, "handle": handle})
    if save_channels(channels):
        print(f"Eklendi: {name} ({ch_id}). Mevcut videoları için e-posta gönderilmez, yeni yüklemeler özetlenir.")


def cmd_remove(query):
    if not query:
        print("Kullanım: bot.py remove @KanalAdi")
        return
    q = query.strip().lower().lstrip("@")
    channels = load_channels()
    keep = [c for c in channels if q not in (c["id"].lower(), c.get("handle", "").lower().lstrip("@"), c.get("name", "").lower())]
    if len(keep) == len(channels):
        print(f"'{query}' ile eşleşen kanal yok. 'bot.py list' ile kontrol et.")
        return
    save_channels(keep)
    print(f"{len(channels) - len(keep)} kanal çıkarıldı. Kalan: {len(keep)}")


def cmd_sync(source_url=None):
    """Web uygulamasındaki kanal listesini indirir (Ayarlar > Yerel bot'taki adres)."""
    if not source_url:
        print("Eşitleme adresi gerekli. Web uygulamasında Ayarlar > Yerel bot bölümündeki komutu kullan:")
        print('  bot.py sync "http://localhost:3500/api/bot/channels?key=..."')
        return
    try:
        req = urllib.request.Request(source_url, headers={"User-Agent": "youtube-ozet-bot"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        chs = data.get("channels") if isinstance(data, dict) else data
        if not isinstance(chs, list):
            raise ValueError("beklenmeyen yanıt biçimi")
        minimal = [{"id": c["id"], "name": c.get("name", ""), "handle": c.get("handle", "")} for c in chs if c.get("id")]
        save_channels(minimal)
        print(f"{len(minimal)} kanal eşitlendi.")
        cmd_list()
    except Exception as e:
        # Eski sürüm burada listeyi varsayılan kanallarla eziyordu; artık mevcut liste korunur.
        print(f"Eşitleme başarısız, mevcut liste korundu: {e}")


def cmd_test():
    """Kurulumdan sonra ayarların çalıştığını doğrular."""
    cfg = load_env()
    print("\n1) Gemini anahtarı")
    key = cfg.get("GEMINI_API_KEY", "")
    if not key:
        print("   YOK. .env dosyasına GEMINI_API_KEY=... satırını ekle.")
    else:
        ok = False
        for model in GEMINI_MODELS:
            try:
                _gemini_request(model, key, [{"text": "Sadece 'tamam' yaz."}], False)
                print(f"   Çalışıyor ({model}).")
                ok = True
                break
            except urllib.error.HTTPError as e:
                reason = "anahtar geçersiz" if e.code in (400, 403) else "Gemini yoğun, sonra tekrar dene" if e.code == 503 else f"HTTP {e.code}"
                print(f"   {model}: {reason}")
            except Exception as e:
                print(f"   {model}: {e}")
        if not ok:
            print("   Gemini'ye ulaşılamadı.")

    print("\n2) Test e-postası")
    sample = {
        "id": "test", "title": "Kurulum testi", "channel": "YouTube Özet botu",
        "url": "https://www.youtube.com", "thumbnail": "https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg",
        "description": "",
    }
    if send_email(sample, "Bot doğru kuruldu. Takip ettiğin kanallar yeni video yüklediğinde özetler bu adrese gelecek.", cfg):
        print(f"   Gönderildi: {cfg['RECEIVER_EMAIL']}")
    else:
        print("   Gönderilemedi. .env içindeki SENDER_EMAIL, EMAIL_APP_PASSWORD ve RECEIVER_EMAIL değerlerini kontrol et.")
    print()


def autostart_enabled():
    if IS_WINDOWS:
        d = windows_startup_dir()
        return any(os.path.exists(os.path.join(d, f"{SERVICE_NAME}{ext}")) for ext in (".lnk", ".cmd"))
    return os.path.exists(systemd_unit_path())


def cmd_autostart(action):
    action = (action or "status").lower()
    if action in ("status", "durum"):
        print(f"Otomatik başlatma {'açık' if autostart_enabled() else 'kapalı'}.")
        return
    if action not in ("on", "off", "ac", "aç", "kapat"):
        print("Kullanım: bot.py autostart on | off | status")
        return
    enable = action in ("on", "ac", "aç")
    if IS_WINDOWS:
        _autostart_windows(enable)
    elif sys.platform.startswith("linux"):
        _autostart_linux(enable)
    else:
        print("Otomatik başlatma bu işletim sisteminde desteklenmiyor (Windows ve Linux destekleniyor).")


def _autostart_linux(enable):
    unit = systemd_unit_path()
    if not enable:
        if os.path.exists(unit):
            systemctl("disable", "--now", f"{SERVICE_NAME}.service")
            os.remove(unit)
            systemctl("daemon-reload")
        print("Otomatik başlatma kapatıldı.")
        return
    if not shutil.which("systemctl"):
        print("Bu sistemde systemd yok. Bunun yerine 'crontab -e' ile şu satırı ekleyebilirsin:")
        print(f"  @reboot cd {BASE_DIR} && {sys.executable} {SCRIPT_PATH} start")
        return
    # Elle başlatılmış bir kopya varsa durdur; systemd yenisini açacak
    pid = running_pid()
    if pid:
        os.kill(pid, signal.SIGTERM)
        for _ in range(40):
            if not is_bot_process(pid):
                break
            time.sleep(0.25)
    os.makedirs(os.path.dirname(unit), exist_ok=True)
    with open(unit, "w", encoding="utf-8") as f:
        f.write(f"""[Unit]
Description=YouTube Özet botu
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory={BASE_DIR}
ExecStart={sys.executable} -u {SCRIPT_PATH} run
Restart=on-failure
RestartSec=30

[Install]
WantedBy=default.target
""")
    systemctl("daemon-reload")
    r = systemctl("enable", "--now", f"{SERVICE_NAME}.service")
    if r.returncode != 0:
        # Yarım kalan kurulumu geri al ki start/stop komutları systemd'ye yönlenmesin
        systemctl("disable", f"{SERVICE_NAME}.service")
        os.remove(unit)
        print(f"systemd kullanıcı servisi kurulamadı: {r.stderr.strip().splitlines()[-1] if r.stderr.strip() else r.returncode}")
        print("Masaüstü oturumunda değil de SSH gibi bir bağlantıdaysan bu normal. Bunun yerine 'crontab -e' ile şu satırı ekleyebilirsin:")
        print(f"  @reboot cd {BASE_DIR} && {sys.executable} {SCRIPT_PATH} start")
        return
    print("Otomatik başlatma açıldı; bot şimdi de çalışmaya başladı.")
    print("Bilgisayar açılınca, oturum açmayı beklemeden başlaması için bir kez şunu çalıştır:")
    print(f"  sudo loginctl enable-linger {os.environ.get('USER', '$USER')}")


def _autostart_windows(enable):
    startup = windows_startup_dir()
    lnk = os.path.join(startup, f"{SERVICE_NAME}.lnk")
    cmd = os.path.join(startup, f"{SERVICE_NAME}.cmd")
    if not enable:
        for p in (lnk, cmd):
            if os.path.exists(p):
                os.remove(p)
        print("Otomatik başlatma kapatıldı.")
        return
    os.makedirs(startup, exist_ok=True)
    target = python_for_background()
    # Değerler ortam değişkeniyle aktarılır; yollardaki boşluk ve tırnaklar sorun çıkarmasın
    env = dict(os.environ, OZET_LNK=lnk, OZET_TARGET=target, OZET_ARGS=f'"{SCRIPT_PATH}" run', OZET_WD=BASE_DIR)
    ps = ("$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:OZET_LNK);"
          "$s.TargetPath=$env:OZET_TARGET;$s.Arguments=$env:OZET_ARGS;$s.WorkingDirectory=$env:OZET_WD;"
          "$s.WindowStyle=7;$s.Save()")
    try:
        subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
                       env=env, check=True, capture_output=True, timeout=30)
    except Exception:
        # PowerShell yoksa basit bir .cmd dosyası (açılışta kısa süre siyah pencere görünebilir)
        with open(cmd, "w", encoding="utf-8") as f:
            f.write(f'@echo off\r\ncd /d "{BASE_DIR}"\r\nstart "" "{target}" "{SCRIPT_PATH}" run\r\n')
    print("Otomatik başlatma açıldı: Windows'a her giriş yaptığında bot arka planda başlayacak.")
    if not running_pid():
        cmd_start()


def print_help():
    print(__doc__)


def main():
    _safe_console()
    args = sys.argv[1:]
    cmd = args[0].lower() if args else "run"
    rest = " ".join(args[1:]).strip()
    commands = {
        "run": cmd_run, "start": cmd_start, "stop": cmd_stop, "restart": cmd_restart,
        "status": cmd_status, "logs": cmd_logs, "scan": scan_once, "list": cmd_list,
        "test": cmd_test, "help": print_help, "-h": print_help, "--help": print_help,
    }
    if cmd == "scan" and running_pid():
        # İki tarayıcı aynı anda çalışırsa aynı video için iki e-posta gidebilir
        print("Arka planda çalışan bot zaten tarama yapıyor. Hemen taratmak için: bot.py restart")
    elif cmd in commands:
        commands[cmd]()
    elif cmd == "add":
        cmd_add(rest)
    elif cmd in ("remove", "rm"):
        cmd_remove(rest)
    elif cmd == "sync":
        cmd_sync(args[1] if len(args) > 1 else None)
    elif cmd == "autostart":
        cmd_autostart(args[1] if len(args) > 1 else "status")
    else:
        print(f"Bilinmeyen komut: {cmd}")
        print_help()


if __name__ == "__main__":
    main()
