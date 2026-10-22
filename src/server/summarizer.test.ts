import { describe, expect, it } from 'vitest';
import { buildPrompt, fallbackSummary, parseModelOutput, type SummaryInput } from './summarizer';

const input: SummaryInput = {
  videoId: 'idz35UHLc20',
  title: 'Başlık',
  channelName: 'Kanal',
  description: '00:00 Giriş\n01:00 Orta\n02:00 Son',
  transcript: 'altyazi metni',
  durationSeconds: 600,
  language: 'tr',
  length: 'short',
  watchVideo: true,
};

describe('parseModelOutput', () => {
  it('kod bloğu içindeki JSON’u okur ve Markdown işaretlerini temizler', () => {
    const out = parseModelOutput('```json\n{"tldr":"**Öz**","paragraphs":["P1",""],"keyPoints":["• Madde","- İki"]}\n```');
    expect(out).toEqual({ tldr: 'Öz', paragraphs: ['P1'], keyPoints: ['Madde', 'İki'] });
  });

  it('geçersiz yanıtta null döner', () => {
    expect(parseModelOutput('Tabii, işte özet:')).toBeNull();
    expect(parseModelOutput('{"tldr":"","paragraphs":[],"keyPoints":[]}')).toBeNull();
  });
});

describe('buildPrompt', () => {
  it('altyazıyı yalnızca altyazı modunda ekler', () => {
    expect(buildPrompt(input, 'transcript')).toContain('altyazi metni');
    expect(buildPrompt(input, 'video')).not.toContain('altyazi metni');
    expect(buildPrompt(input, 'description')).toContain('uydurma');
  });

  it('İngilizce seçilince çıktı dilini İngilizce ister', () => {
    expect(buildPrompt({ ...input, language: 'en' }, 'video')).toContain('Output language: English');
  });
});

describe('fallbackSummary', () => {
  it('açıklamanın ilk anlamlı paragrafını ve bölümleri kullanır, içerik uydurmaz', () => {
    const s = fallbackSummary('https://link.example\n\nAsıl açıklama.\n\n00:00 Giriş\n01:00 Orta\n02:00 Son');
    expect(s.basis).toBe('none');
    expect(s.paragraphs).toEqual(['Asıl açıklama.']);
    expect(s.chapters).toHaveLength(3);
    expect(s.keyPoints).toEqual([]);
  });
});
