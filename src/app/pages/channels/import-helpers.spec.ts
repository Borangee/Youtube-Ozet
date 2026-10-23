import { parseTakeoutCsv } from './import-helpers';

describe('parseTakeoutCsv', () => {
  it('İngilizce başlıklı Takeout dosyasını okur', () => {
    const csv = [
      'Channel Id,Channel Url,Channel Title',
      'UCsBjURrPoezykLs9EqgamOA,http://www.youtube.com/channel/UCsBjURrPoezykLs9EqgamOA,Fireship',
      'UC51-ljNFrvY5ZmV0C_61XcA,http://www.youtube.com/channel/UC51-ljNFrvY5ZmV0C_61XcA,"Elraenn, ""Tayfa"""',
      '',
    ].join('\r\n');
    expect(parseTakeoutCsv(csv)).toEqual([
      { id: 'UCsBjURrPoezykLs9EqgamOA', name: 'Fireship', avatar: '' },
      { id: 'UC51-ljNFrvY5ZmV0C_61XcA', name: 'Elraenn, "Tayfa"', avatar: '' },
    ]);
  });

  it('Türkçe başlıklı ve BOM içeren dosyayı okur, tekrarları atar', () => {
    const csv =
      '﻿Kanal Kimliği,Kanal URL’si,Kanal Başlığı\n' +
      'UCVBX2n_5egE9XuJL8NUS0Xg,http://www.youtube.com/channel/UCVBX2n_5egE9XuJL8NUS0Xg,Yusuf İpek\n' +
      'UCVBX2n_5egE9XuJL8NUS0Xg,http://www.youtube.com/channel/UCVBX2n_5egE9XuJL8NUS0Xg,Yusuf İpek\n';
    expect(parseTakeoutCsv(csv)).toEqual([{ id: 'UCVBX2n_5egE9XuJL8NUS0Xg', name: 'Yusuf İpek', avatar: '' }]);
  });

  it('kanal kimliği olmayan dosyada boş liste döner', () => {
    expect(parseTakeoutCsv('ad,soyad\nali,veli')).toEqual([]);
  });
});
