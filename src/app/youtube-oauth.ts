import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import type { SubscriptionChannel } from './pages/channels/import-helpers';

/**
 * Google ile giriş yapıp kullanıcının YouTube aboneliklerini okur.
 * Bu modül yalnızca abonelik aktarma paneli açıldığında dinamik olarak
 * yüklenir; Firebase ana paketi şişirmesin.
 *
 * Erişim jetonu sunucuya gönderilmez, YouTube API'si doğrudan tarayıcıdan çağrılır.
 */

function auth() {
  const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  return getAuth(app);
}

export async function signInForYoutube(): Promise<string> {
  const provider = new GoogleAuthProvider();
  provider.addScope('https://www.googleapis.com/auth/youtube.readonly');
  provider.setCustomParameters({ prompt: 'select_account' });
  const result = await signInWithPopup(auth(), provider);
  const token = GoogleAuthProvider.credentialFromResult(result)?.accessToken;
  if (!token) throw new Error('Google erişim izni alınamadı.');
  return token;
}

export async function signOutGoogle(): Promise<void> {
  try {
    await signOut(auth());
  } catch {
    // yok say
  }
}

export class YoutubeApiDisabledError extends Error {}

interface SubscriptionsResponse {
  nextPageToken?: string;
  items?: {
    snippet?: {
      title?: string;
      resourceId?: { channelId?: string };
      thumbnails?: { default?: { url?: string }; medium?: { url?: string } };
    };
  }[];
  error?: { message?: string; errors?: { reason?: string }[] };
}

export async function fetchSubscriptions(token: string): Promise<SubscriptionChannel[]> {
  const out: SubscriptionChannel[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 20; page++) {
    const url = new URL('https://www.googleapis.com/youtube/v3/subscriptions');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('mine', 'true');
    url.searchParams.set('maxResults', '50');
    url.searchParams.set('order', 'alphabetical');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = (await res.json().catch(() => ({}))) as SubscriptionsResponse;
    if (!res.ok) {
      const msg = data.error?.message ?? `HTTP ${res.status}`;
      const reason = data.error?.errors?.[0]?.reason ?? '';
      if (reason === 'accessNotConfigured' || /has not been used|is disabled/i.test(msg)) {
        throw new YoutubeApiDisabledError('YouTube Data API bu Google Cloud projesinde etkin değil.');
      }
      if (reason === 'subscriptionForbidden') {
        throw new Error('Bu hesabın abonelikleri okunamıyor. Hesabında bir YouTube kanalı olmayabilir.');
      }
      throw new Error(`YouTube aboneliklere erişilemedi: ${msg}`);
    }
    for (const item of data.items ?? []) {
      const id = item.snippet?.resourceId?.channelId;
      if (!id || out.some((c) => c.id === id)) continue;
      out.push({
        id,
        name: item.snippet?.title ?? 'YouTube kanalı',
        avatar: item.snippet?.thumbnails?.medium?.url ?? item.snippet?.thumbnails?.default?.url ?? '',
      });
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}
