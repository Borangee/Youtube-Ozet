import firebaseConfig from '../../../../firebase-applet-config.json';

/**
 * Abonelik aktarma için Firebase'e bağımlı olmayan yardımcılar. Bu dosya ana
 * pakete girer; Firebase SDK'sı yalnızca "Google ile bağlan"a basılınca yüklenir.
 */

export interface SubscriptionChannel {
  id: string;
  name: string;
  avatar: string;
}

const CHANNEL_ID = /UC[0-9A-Za-z_-]{22}/;

export function firebaseAuthSettingsUrl(): string {
  return `https://console.firebase.google.com/project/${encodeURIComponent(firebaseConfig.projectId)}/authentication/settings`;
}

export function firebaseSignInMethodsUrl(): string {
  return `https://console.firebase.google.com/project/${encodeURIComponent(firebaseConfig.projectId)}/authentication/providers`;
}

export function enableYoutubeApiUrl(): string {
  return `https://console.cloud.google.com/apis/library/youtube.googleapis.com?project=${encodeURIComponent(firebaseConfig.projectId)}`;
}

/**
 * Google ile girişin bu adreste (ör. localhost) çalışıp çalışmayacağını önceden
 * kontrol eder. Firebase yalnızca "Authorized domains" listesindeki adreslerden
 * açılan giriş pencerelerine izin veriyor. Kontrol yapılamazsa null döner.
 */
export async function checkAuthorizedDomain(hostname: string): Promise<boolean | null> {
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects?key=${encodeURIComponent(firebaseConfig.apiKey)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { authorizedDomains?: string[] };
    const domains = data.authorizedDomains ?? [];
    return domains.some((d) => d === hostname || (d.startsWith('*.') && hostname.endsWith(d.slice(1))));
  } catch {
    return null;
  }
}

function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      fields.push(cur);
      cur = '';
    } else cur += ch;
  }
  fields.push(cur);
  return fields.map((f) => f.trim());
}

/**
 * Google Takeout'tan inen YouTube abonelik dosyasını (subscriptions.csv /
 * abonelikler.csv) okur. Sütun başlıkları dile göre değiştiği için her satırda
 * kanal kimliği aranır, ad olarak kimlik ya da link olmayan ilk alan alınır.
 */
export function parseTakeoutCsv(text: string): SubscriptionChannel[] {
  const out: SubscriptionChannel[] = [];
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    const id = line.match(CHANNEL_ID)?.[0];
    if (!id || out.some((c) => c.id === id)) continue;
    const fields = splitCsvLine(line);
    const name = fields.find((f) => f && !CHANNEL_ID.test(f) && !/^https?:\/\//i.test(f)) ?? id;
    out.push({ id, name, avatar: '' });
  }
  return out;
}
