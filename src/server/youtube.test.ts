import { describe, expect, it } from 'vitest';
import {
  decodeEntities,
  extractJsonObject,
  parseChannelInput,
  parseChannelPage,
  parseChapters,
  parseFeed,
  parseSearchResults,
  parseTranscriptJson3,
  parseWatchPage,
  pickCaptionTrack,
} from './youtube';

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <link rel="self" href="http://www.youtube.com/feeds/videos.xml?channel_id=UCWpk9PSGHoJW1hZT4egxTNQ"/>
 <id>yt:channel:Wpk9PSGHoJW1hZT4egxTNQ</id>
 <yt:channelId>UCWpk9PSGHoJW1hZT4egxTNQ</yt:channelId>
 <title>Ruhi Cenet Documentaries</title>
 <author>
  <name>Ruhi Cenet Documentaries</name>
  <uri>https://www.youtube.com/channel/UCWpk9PSGHoJW1hZT4egxTNQ</uri>
 </author>
 <published>2012-09-19T10:00:00+00:00</published>
 <entry>
  <id>yt:video:idz35UHLc20</id>
  <yt:videoId>idz35UHLc20</yt:videoId>
  <yt:channelId>UCWpk9PSGHoJW1hZT4egxTNQ</yt:channelId>
  <title>SİZE &quot;ÇOK ÖNEMLİ&quot; BİR MESAJIM VAR!</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=idz35UHLc20"/>
  <published>2026-10-20T15:00:12+00:00</published>
  <media:group>
   <media:title>SİZE &quot;ÇOK ÖNEMLİ&quot; BİR MESAJIM VAR!</media:title>
   <media:description>Merhabalar &amp;amp; selam &lt;3</media:description>
  </media:group>
 </entry>
 <entry>
  <id>yt:video:AAAAAAAAAAA</id>
  <yt:videoId>AAAAAAAAAAA</yt:videoId>
  <title>Kısa video</title>
  <link rel="alternate" href="https://www.youtube.com/shorts/AAAAAAAAAAA"/>
  <published>2026-10-18T09:00:00+00:00</published>
  <media:group><media:description></media:description></media:group>
 </entry>
</feed>`;

describe('parseFeed', () => {
  it('kanal bilgisini ve videoları kendi <entry> bloklarından okur', () => {
    const feed = parseFeed(FEED);
    expect(feed.channelId).toBe('UCWpk9PSGHoJW1hZT4egxTNQ');
    expect(feed.channelName).toBe('Ruhi Cenet Documentaries');
    expect(feed.entries).toHaveLength(2);
    expect(feed.entries[0].id).toBe('idz35UHLc20');
    expect(feed.entries[0].title).toBe('SİZE "ÇOK ÖNEMLİ" BİR MESAJIM VAR!');
  });

  it('kanalın açılış tarihini video tarihi sanmaz (eski hata)', () => {
    const feed = parseFeed(FEED);
    expect(feed.entries[0].publishedAt).toBe('2026-10-20T15:00:12.000Z');
  });

  it('&amp;amp; gibi değerleri iki kez çözmez', () => {
    expect(parseFeed(FEED).entries[0].description).toBe('Merhabalar &amp; selam <3');
    expect(decodeEntities('&amp;lt;b&amp;gt;')).toBe('&lt;b&gt;');
  });

  it('Shorts linklerini işaretler', () => {
    const feed = parseFeed(FEED);
    expect(feed.entries[0].isShortLink).toBe(false);
    expect(feed.entries[1].isShortLink).toBe(true);
  });
});

describe('parseChannelInput', () => {
  it.each([
    ['UCsBjURrPoezykLs9EqgamOA', { kind: 'id', id: 'UCsBjURrPoezykLs9EqgamOA' }],
    ['https://www.youtube.com/channel/UCsBjURrPoezykLs9EqgamOA/videos', { kind: 'id', id: 'UCsBjURrPoezykLs9EqgamOA' }],
    ['https://youtube.com/@Fireship?si=abc', { kind: 'handle', handle: '@Fireship' }],
    ['m.youtube.com/@yusufipk/videos', { kind: 'handle', handle: '@yusufipk' }],
    ['@Elraenn', { kind: 'handle', handle: '@Elraenn' }],
    ['Elraenn', { kind: 'handle', handle: '@Elraenn' }],
    ['https://www.youtube.com/c/Fireship', { kind: 'path', path: 'c/Fireship' }],
    ['Ruhi Cenet', { kind: 'query', query: 'Ruhi Cenet' }],
  ])('%s', (input, expected) => {
    expect(parseChannelInput(input)).toEqual(expected);
  });

  it('kullanıcı adındaki yol ayırıcılarını temizler', () => {
    expect(parseChannelInput('@foo/../bar')).toEqual({ kind: 'handle', handle: '@foo..bar' });
  });

  it('boş ya da ilgisiz linklerde null döner', () => {
    expect(parseChannelInput('   ')).toBeNull();
    expect(parseChannelInput('https://www.youtube.com/watch?v=idz35UHLc20')).toBeNull();
  });
});

describe('extractJsonObject', () => {
  it('iç içe nesneleri ve tırnak içindeki süslü parantezleri doğru sayar', () => {
    const html = `<script>var ytInitialData = {"a":{"b":[1,2,{"c":"}{"}]},"d":"x\\"}"};var other = {"z":1};</script>`;
    expect(extractJsonObject(html, 'var ytInitialData =')).toEqual({ a: { b: [1, 2, { c: '}{' }] }, d: 'x"}' });
  });

  it('işaret yoksa null döner', () => {
    expect(extractJsonObject('<html></html>', 'var ytInitialData =')).toBeNull();
  });
});

describe('parseChannelPage', () => {
  it('kanonik linkten kanal kimliğini alır', () => {
    const html = `<link rel="canonical" href="https://www.youtube.com/channel/UCsBjURrPoezykLs9EqgamOA">
      <meta property="og:title" content="Fireship &amp; Co">
      <meta property="og:image" content="https://yt3.googleusercontent.com/abc=s900">
      "vanityChannelUrl":"http://www.youtube.com/@Fireship" {"content":"4,29 Mn abone"}`;
    expect(parseChannelPage(html)).toEqual({
      id: 'UCsBjURrPoezykLs9EqgamOA',
      name: 'Fireship & Co',
      handle: '@Fireship',
      avatar: 'https://yt3.googleusercontent.com/abc=s900',
      subscribers: '4,29 Mn abone',
    });
  });
});

describe('parseSearchResults', () => {
  it('kanal kartlarını ve karışık gelen abone/handle alanlarını ayıklar', () => {
    const data = {
      contents: {
        sectionListRenderer: {
          contents: [
            {
              itemSectionRenderer: {
                contents: [
                  {
                    channelRenderer: {
                      channelId: 'UC51-ljNFrvY5ZmV0C_61XcA',
                      title: { simpleText: 'Elraenn' },
                      navigationEndpoint: { browseEndpoint: { canonicalBaseUrl: '/@Elraenn' } },
                      subscriberCountText: { simpleText: '@Elraenn' },
                      videoCountText: { simpleText: '3,89 Mn abone' },
                      thumbnail: { thumbnails: [{ url: '//yt3.ggpht.com/small' }, { url: '//yt3.ggpht.com/big' }] },
                    },
                  },
                  { videoRenderer: { videoId: 'x' } },
                ],
              },
            },
          ],
        },
      },
    };
    const html = `<script>var ytInitialData = ${JSON.stringify(data)};</script>`;
    expect(parseSearchResults(html)).toEqual([
      {
        id: 'UC51-ljNFrvY5ZmV0C_61XcA',
        name: 'Elraenn',
        handle: '@Elraenn',
        avatar: 'https://yt3.ggpht.com/big',
        subscribers: '3,89 Mn abone',
      },
    ]);
  });
});

describe('parseWatchPage', () => {
  it('süre, canlı yayın durumu ve altyazıları okur', () => {
    const player = {
      playabilityStatus: { status: 'OK' },
      videoDetails: { title: 'Başlık', lengthSeconds: '1234', shortDescription: 'Açıklama', isLive: false },
      microformat: { playerMicroformatRenderer: { liveBroadcastDetails: { isLiveNow: false } } },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            { baseUrl: 'https://www.youtube.com/api/timedtext?v=1&lang=en', languageCode: 'en', kind: 'asr' },
            { baseUrl: 'https://www.youtube.com/api/timedtext?v=1&lang=tr', languageCode: 'tr' },
          ],
        },
      },
    };
    const meta = parseWatchPage(`<script>var ytInitialPlayerResponse = ${JSON.stringify(player)};</script>`);
    expect(meta).toMatchObject({ title: 'Başlık', lengthSeconds: 1234, isUpcoming: false, isLiveNow: false, playable: true });
    expect(pickCaptionTrack(meta!.captionTracks, ['tr', 'en'])?.languageCode).toBe('tr');
  });

  it('yayınlanmamış prömiyeri bekleme durumuna alır', () => {
    const player = { playabilityStatus: { status: 'LIVE_STREAM_OFFLINE' }, videoDetails: { isUpcoming: true } };
    const meta = parseWatchPage(`var ytInitialPlayerResponse = ${JSON.stringify(player)};`);
    expect(meta?.isUpcoming).toBe(true);
  });
});

describe('parseTranscriptJson3', () => {
  it('parçaları birleştirir', () => {
    const body = JSON.stringify({ events: [{ segs: [{ utf8: 'Merhaba ' }, { utf8: 'dünya' }] }, {}, { segs: [{ utf8: '\n nasılsın' }] }] });
    expect(parseTranscriptJson3(body)).toBe('Merhaba dünya nasılsın');
    expect(parseTranscriptJson3('<html>')).toBe('');
  });
});

describe('parseChapters', () => {
  it('açıklamadaki bölüm listesini okur', () => {
    const desc = `Video açıklaması\n\n00:00 Giriş\n00:54 Blender Maketiyle 3 Kamera Açısı\n1:12 Claude'a MCP Bağlamak\n1:02:05 - Kapanış`;
    expect(parseChapters(desc)).toEqual([
      { seconds: 0, time: '00:00', label: 'Giriş' },
      { seconds: 54, time: '00:54', label: 'Blender Maketiyle 3 Kamera Açısı' },
      { seconds: 72, time: '1:12', label: "Claude'a MCP Bağlamak" },
      { seconds: 3725, time: '1:02:05', label: 'Kapanış' },
    ]);
  });

  it("0:00'dan başlamayan ya da 3'ten az zaman damgasını bölüm saymaz", () => {
    expect(parseChapters('05:00 Bir yer\n10:00 Başka yer\n12:00 Son')).toEqual([]);
    expect(parseChapters('00:00 Giriş\n01:00 Son')).toEqual([]);
  });
});
