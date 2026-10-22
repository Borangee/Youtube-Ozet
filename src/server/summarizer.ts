import { GoogleGenAI, MediaResolution, type Part } from '@google/genai';
import type { Summary, SummaryBasis, SummaryLanguage, SummaryLength } from '../shared/types';
import { parseChapters, videoUrl } from './youtube';

/**
 * Gemini ile özet üretimi.
 *
 * Sıra: (1) Gemini videoyu doğrudan YouTube linkinden izler, (2) olmazsa altyazı
 * metni, (3) o da yoksa video açıklaması kullanılır. Hiçbiri olmazsa sahte bir
 * özet uydurmak yerine `null` döner; e-posta yine de "özet yok" notuyla gider.
 */

// Gemini'nin video modunda düşük çözünürlükte saniyede ~100 token harcanır.
// 2 saati aşan videolarda maliyet ve bağlam sınırı yüzünden altyazıya düşülür.
const MAX_VIDEO_SECONDS_FOR_VIDEO_MODE = 2 * 60 * 60;
const MAX_TEXT_CHARS = 60_000;

let client: GoogleGenAI | null = null;
let clientKey = '';

function getClient(): GoogleGenAI | null {
  const key = (process.env['GEMINI_API_KEY'] ?? '').trim();
  if (!key || key === 'MY_GEMINI_API_KEY') return null;
  if (!client || clientKey !== key) {
    client = new GoogleGenAI({ apiKey: key });
    clientKey = key;
  }
  return client;
}

export function isGeminiConfigured(): boolean {
  return getClient() !== null;
}

/** GEMINI_MODEL ile değiştirilebilir. "-latest" takma adları Google tarafından güncel tutulur. */
function candidateModels(): string[] {
  const configured = (process.env['GEMINI_MODEL'] ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  return [...new Set([...configured, 'gemini-flash-latest', 'gemini-3.6-flash', 'gemini-flash-lite-latest'])];
}

export interface SummaryInput {
  videoId: string;
  title: string;
  channelName: string;
  description: string;
  transcript: string;
  durationSeconds: number | null;
  language: SummaryLanguage;
  length: SummaryLength;
  watchVideo: boolean;
}

interface ModelOutput {
  tldr: string;
  paragraphs: string[];
  keyPoints: string[];
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    tldr: { type: 'string', description: 'Videonun tek cümlelik özü.' },
    paragraphs: { type: 'array', items: { type: 'string' }, description: 'Akıcı özet paragrafları.' },
    keyPoints: { type: 'array', items: { type: 'string' }, description: 'Öne çıkan bilgiler, kısa maddeler.' },
  },
  required: ['tldr', 'paragraphs', 'keyPoints'],
};

const LENGTH_RULES: Record<SummaryLength, { tr: string; en: string }> = {
  short: {
    tr: '1 kısa paragraf ve 3 madde yaz.',
    en: 'Write 1 short paragraph and 3 bullet points.',
  },
  medium: {
    tr: '2-3 paragraf ve 4-6 madde yaz.',
    en: 'Write 2-3 paragraphs and 4-6 bullet points.',
  },
  long: {
    tr: '4-5 paragraf ve 6-8 madde yaz; önemli ayrıntıları, örnekleri ve sonuçları atlama.',
    en: 'Write 4-5 paragraphs and 6-8 bullet points; keep important details, examples and conclusions.',
  },
};

export function buildPrompt(input: SummaryInput, basis: SummaryBasis): string {
  const tr = input.language === 'tr';
  const sourceLine: Record<SummaryBasis, string> = tr
    ? {
        video: 'Ekteki YouTube videosunu izle ve dinle; özeti videonun gerçek içeriğine dayandır.',
        transcript: 'Aşağıdaki altyazı metnine dayanarak özetle.',
        description: 'Videoya erişimin yok; yalnızca başlık ve açıklamaya dayanarak ne anlatıldığını özetle. Emin olmadığın şeyleri uydurma.',
        none: '',
      }
    : {
        video: 'Watch and listen to the attached YouTube video; base the summary on what is actually in it.',
        transcript: 'Summarize based on the transcript below.',
        description: 'You cannot access the video; summarize using only the title and description. Do not invent details.',
        none: '',
      };

  const lines = tr
    ? [
        'Bir YouTube videosu için e-posta bülteni özeti hazırlıyorsun.',
        sourceLine[basis],
        LENGTH_RULES[input.length].tr,
        'Kurallar:',
        '- Yalnızca videoda gerçekten geçen bilgileri yaz, tahmin yürütme.',
        '- "Bu videoda", "Tabii ki" gibi girişlerle başlama; doğrudan içeriğe gir.',
        '- Sponsor ve reklam bölümlerini özetin parçası yapma; gerekirse tek maddede belirt.',
        '- Markdown kullanma, düz metin yaz.',
        '- Çıktı dili: Türkçe.',
      ]
    : [
        'You are writing an email newsletter summary of a YouTube video.',
        sourceLine[basis],
        LENGTH_RULES[input.length].en,
        'Rules:',
        '- Only include information that is actually in the video; do not speculate.',
        '- Do not open with filler like "In this video"; go straight to the content.',
        '- Do not treat sponsor segments as content; mention them in at most one bullet.',
        '- No Markdown, plain text only.',
        '- Output language: English.',
      ];

  lines.push('', `Kanal: ${input.channelName}`, `Başlık: ${input.title}`);
  if (input.description) lines.push('', 'Açıklama:', '"""', input.description.slice(0, 5_000), '"""');
  if (basis === 'transcript') lines.push('', 'Altyazı:', '"""', input.transcript.slice(0, MAX_TEXT_CHARS), '"""');
  return lines.join('\n');
}

export function parseModelOutput(text: string): ModelOutput | null {
  try {
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
    const raw = JSON.parse(cleaned) as Partial<ModelOutput>;
    const strings = (v: unknown) =>
      Array.isArray(v) ? v.map((x) => stripMarkdown(String(x))).filter((x) => x.length > 0) : [];
    const out: ModelOutput = {
      tldr: stripMarkdown(String(raw.tldr ?? '')),
      paragraphs: strings(raw.paragraphs).slice(0, 8),
      keyPoints: strings(raw.keyPoints).slice(0, 12),
    };
    return out.tldr || out.paragraphs.length > 0 ? out : null;
  } catch {
    return null;
  }
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^[\s•\-*]+/, '')
    .trim();
}

async function generate(parts: Part[], video: boolean): Promise<{ output: ModelOutput; model: string }> {
  const ai = getClient();
  if (!ai) throw new Error('GEMINI_API_KEY tanımlı değil');

  let lastError: unknown = null;
  for (const model of candidateModels()) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts }],
        config: {
          responseMimeType: 'application/json',
          responseJsonSchema: RESPONSE_SCHEMA,
          ...(video ? { mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW } : {}),
          abortSignal: AbortSignal.timeout(video ? 180_000 : 90_000),
        },
      });
      const output = parseModelOutput(response.text ?? '');
      if (output) return { output, model };
      lastError = new Error(`${model} boş/geçersiz yanıt döndü`);
    } catch (err) {
      lastError = err;
      console.warn(`[gemini] ${model} başarısız:`, err instanceof Error ? err.message : err);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Gemini yanıt vermedi');
}

/**
 * Özeti üretir. Gemini hiç ayarlı değilse ya da tüm denemeler başarısızsa
 * hata fırlatır; çağıran taraf yeniden denemeye ya da özetsiz göndermeye karar verir.
 */
export async function summarizeVideo(input: SummaryInput): Promise<Summary> {
  const chapters = parseChapters(input.description);
  const attempts: { basis: SummaryBasis; parts: Part[]; video: boolean }[] = [];

  const videoAllowed =
    input.watchVideo && (input.durationSeconds === null || input.durationSeconds <= MAX_VIDEO_SECONDS_FOR_VIDEO_MODE);
  if (videoAllowed) {
    attempts.push({
      basis: 'video',
      video: true,
      parts: [{ fileData: { fileUri: videoUrl(input.videoId) } }, { text: buildPrompt(input, 'video') }],
    });
  }
  if (input.transcript.length > 200) {
    attempts.push({ basis: 'transcript', video: false, parts: [{ text: buildPrompt(input, 'transcript') }] });
  }
  attempts.push({ basis: 'description', video: false, parts: [{ text: buildPrompt(input, 'description') }] });

  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      const { output, model } = await generate(attempt.parts, attempt.video);
      return {
        ...output,
        chapters,
        basis: attempt.basis,
        model,
        generatedAt: new Date().toISOString(),
      };
    } catch (err) {
      lastError = err;
      // Anahtar hiç yoksa diğer modları denemenin anlamı yok
      if (!isGeminiConfigured()) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Özet üretilemedi');
}

/** Gemini kullanılamadığında e-postaya konacak dürüst yedek içerik. */
export function fallbackSummary(description: string): Summary {
  const firstParagraph = description
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p.length > 0 && !/^https?:\/\//.test(p));
  return {
    tldr: '',
    paragraphs: firstParagraph ? [firstParagraph.slice(0, 600)] : [],
    keyPoints: [],
    chapters: parseChapters(description),
    basis: 'none',
    model: null,
    generatedAt: new Date().toISOString(),
  };
}
