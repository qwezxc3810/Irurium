import { ENGINE_VERSION, type EngineVersion } from './config';
import type { MoodVec } from './types';

/**
 * 감정 분석(규칙 기반, MVP).
 * 감정 칩 0.7 + 한마디 0.3. 수치는 모두 [가설] — v0.3.1 수정 노트 6장 H1·H2에서 검증한다.
 */

export const MOOD_WEIGHTS = { chips: 0.7, note: 0.3, minNoteConfidence: 0.3 } as const;

type Vec = { temp: number; energy: number };

/** 기본 마음 칩 8개 + 분야 칩. */
/** 0.2.0 칩 벡터(그대로 고정). 0.3.0은 아래 EMOTIONS에서 만든다 */
export const CHIP_VECTORS_V2: Record<string, Vec> = {
  따뜻함: { temp: 0.8, energy: 0.1 },
  설렘: { temp: 0.6, energy: 0.7 },
  유쾌함: { temp: 0.7, energy: 0.8 },
  차분함: { temp: 0.2, energy: -0.7 },
  그리움: { temp: -0.2, energy: -0.3 },
  쓸쓸함: { temp: -0.6, energy: -0.5 },
  답답함: { temp: -0.5, energy: 0.4 },
  막막함: { temp: -0.4, energy: -0.2 },
  뿌듯함: { temp: 0.6, energy: 0.4 },
  자신감: { temp: 0.5, energy: 0.5 },
  졸림: { temp: 0, energy: -0.8 },
  힘듦: { temp: -0.3, energy: 0.5 },
};

export const BASE_CHIPS_V2 = ['따뜻함', '설렘', '유쾌함', '차분함', '그리움', '쓸쓸함', '답답함', '막막함'] as const;

/** 한마디 키워드 사전: 단어 → [칩, 가중치]. 실제 서비스에서는 별도 JSON으로 분리해 늘린다. */
const KEYWORDS_V2: Array<[string, string, number]> = [
  ['몽글', '따뜻함', 1], ['따뜻', '따뜻함', 1], ['포근', '따뜻함', 1], ['좋았', '따뜻함', 0.6], ['고마', '따뜻함', 0.8],
  ['설레', '설렘', 1], ['두근', '설렘', 1], ['기대', '설렘', 0.7],
  ['웃기', '유쾌함', 1], ['웃김', '유쾌함', 1], ['ㅋㅋ', '유쾌함', 0.8], ['재밌', '유쾌함', 1], ['신나', '유쾌함', 1],
  ['차분', '차분함', 1], ['조용', '차분함', 0.8], ['편안', '차분함', 0.8],
  ['그립', '그리움', 1], ['그리워', '그리움', 1], ['어릴 때', '그리움', 0.6], ['추억', '그리움', 0.8],
  ['쓸쓸', '쓸쓸함', 1], ['외롭', '쓸쓸함', 1], ['슬프', '쓸쓸함', 1], ['슬펐', '쓸쓸함', 1], ['미안', '쓸쓸함', 0.6],
  ['답답', '답답함', 1], ['얄밉', '답답함', 0.9], ['짜증', '답답함', 1], ['화나', '답답함', 1],
  ['막막', '막막함', 1], ['어렵', '막막함', 0.7], ['모르겠', '막막함', 0.7],
  ['뿌듯', '뿌듯함', 1], ['해냈', '뿌듯함', 1], ['졸려', '졸림', 1], ['졸렸', '졸림', 1], ['힘들', '힘듦', 1],
];

const EMOJI_V2: Array<[string, Array<[string, number]>]> = [
  ['🥲', [['그리움', 0.6], ['따뜻함', 0.4]]],
  ['😤', [['답답함', 1]]],
  ['😊', [['따뜻함', 1]]],
  ['😂', [['유쾌함', 1]]],
  ['😢', [['쓸쓸함', 1]]],
  ['🥰', [['따뜻함', 0.7], ['설렘', 0.5]]],
];

// ───────── 0.3.0 감정 사전(docs/EMOTION_DICTIONARY.md, 2026-11-18 확정: 12개) ─────────
/**
 * 감정은 고정 id + 표시명 + 옛 이름(별칭)으로 관리한다.
 * 저장된 moodChips는 기록할 때의 단어 그대로 두고(소급해서 바꾸지 않음), 계산할 때만 id로 읽는다.
 * symbol: 이 감정이 남기는 흔적(카탈로그 EMOTION_SYMBOLS의 id)
 */
export interface EmotionDef { id: string; name: string; aliases: string[]; vec: Vec; symbol: string }
export const EMOTIONS: EmotionDef[] = [
  { id: 'emo.joy', name: '기쁨', aliases: ['따뜻함'], vec: { temp: 0.8, energy: 0.1 }, symbol: 'emotion.sunset-coral' },
  { id: 'emo.flutter', name: '설렘', aliases: [], vec: { temp: 0.6, energy: 0.7 }, symbol: 'emotion.pearl-clam' },
  { id: 'emo.excited', name: '신남', aliases: ['유쾌함'], vec: { temp: 0.7, energy: 0.8 }, symbol: 'emotion.fish-school' },
  { id: 'emo.proud', name: '뿌듯함', aliases: ['자신감'], vec: { temp: 0.6, energy: 0.4 }, symbol: 'emotion.stone-tower' },
  { id: 'emo.calm', name: '평온', aliases: ['차분함'], vec: { temp: 0.2, energy: -0.7 }, symbol: 'emotion.star-jelly' },
  { id: 'emo.longing', name: '그리움', aliases: [], vec: { temp: -0.2, energy: -0.3 }, symbol: 'emotion.bottle-letter' },
  { id: 'emo.lonely', name: '외로움', aliases: ['쓸쓸함'], vec: { temp: -0.6, energy: -0.5 }, symbol: 'emotion.lantern-fish' },
  { id: 'emo.sad', name: '슬픔', aliases: [], vec: { temp: -0.7, energy: -0.6 }, symbol: 'emotion.tear-pearl' },
  { id: 'emo.stuffy', name: '답답함', aliases: [], vec: { temp: -0.5, energy: 0.4 }, symbol: 'emotion.tangled-weed' },
  { id: 'emo.lost', name: '막막함', aliases: [], vec: { temp: -0.4, energy: -0.2 }, symbol: 'emotion.foggy-compass' },
  { id: 'emo.pain', name: '괴로움', aliases: ['힘듦'], vec: { temp: -0.4, energy: 0.5 }, symbol: 'emotion.black-urchin' },
  { id: 'emo.sleepy', name: '졸림', aliases: [], vec: { temp: 0, energy: -0.8 }, symbol: 'emotion.sleeping-conch' },
];
const EMOTION_BY_WORD = new Map<string, EmotionDef>(EMOTIONS.flatMap((e) => [e.name, ...e.aliases].map((w) => [w, e] as const)));
/** 단어(표시명·옛 이름) → 감정. 모르는 단어면 undefined */
export function emotionOf(word: string): EmotionDef | undefined {
  return EMOTION_BY_WORD.get(word);
}
export function emotionById(id: string): EmotionDef | undefined {
  return EMOTIONS.find((e) => e.id === id);
}

/** 0.3.0 칩 벡터: 표시명과 옛 이름 모두 같은 벡터 */
export const CHIP_VECTORS_V3: Record<string, Vec> = Object.fromEntries(EMOTIONS.flatMap((e) => [e.name, ...e.aliases].map((w) => [w, e.vec])));
export const BASE_CHIPS_V3 = EMOTIONS.map((e) => e.name);

const canon = (w: string) => emotionOf(w)?.name ?? w;
const KEYWORDS_V3: Array<[string, string, number]> = [
  // 0.2.0 사전을 새 이름으로 옮기되, 아래 단어는 새 감정으로 읽는다(0.3.0 어항에만 적용, 0.2.0 기록은 다시 분류하지 않음)
  ...KEYWORDS_V2.filter(([w]) => !['슬프', '슬펐', '힘들', '외롭', '쓸쓸'].includes(w)).map(([w, c, k]) => [w, canon(c), k] as [string, string, number]),
  ['슬프', '슬픔', 1], ['슬펐', '슬픔', 1], ['눈물', '슬픔', 0.9], ['울었', '슬픔', 1],
  ['외롭', '외로움', 1], ['쓸쓸', '외로움', 1], ['혼자', '외로움', 0.6],
  ['힘들', '괴로움', 1], ['괴로', '괴로움', 1], ['아팠', '괴로움', 0.8],
  ['기뻐', '기쁨', 1], ['기쁘', '기쁨', 1], ['행복', '기쁨', 1],
];
const EMOJI_V3: Array<[string, Array<[string, number]>]> = [
  ...EMOJI_V2.filter(([e]) => e !== '😢').map(([e, list]) => [e, list.map(([c, k]) => [canon(c), k] as [string, number])] as [string, Array<[string, number]>]),
  ['😢', [['슬픔', 1]]],
  ['😴', [['졸림', 1]]],
];

function tablesFor(v: EngineVersion) {
  return v === '0.2.0'
    ? { vectors: CHIP_VECTORS_V2, keywords: KEYWORDS_V2, emoji: EMOJI_V2, canon: (w: string) => w }
    : { vectors: CHIP_VECTORS_V3, keywords: KEYWORDS_V3, emoji: EMOJI_V3, canon };
}

/** 지금 엔진(새 어항)의 칩 목록과 벡터 */
export const BASE_CHIPS = BASE_CHIPS_V3;
export const CHIP_VECTORS = CHIP_VECTORS_V3;

const INTENSIFIERS = ['너무', '진짜', '완전', '정말', '엄청'];
const NEGATIONS = ['안 ', '못 ', '않', '없었'];

export const NEUTRAL: MoodVec = { temp: 0, energy: 0, confidence: 0, labels: [] };

function averageOf(items: Array<{ v: Vec; w: number }>): Vec | null {
  const total = items.reduce((s, i) => s + i.w, 0);
  if (total <= 0) return null;
  return {
    temp: items.reduce((s, i) => s + i.v.temp * i.w, 0) / total,
    energy: items.reduce((s, i) => s + i.v.energy * i.w, 0) / total,
  };
}

export function analyzeNote(note: string, version: EngineVersion = ENGINE_VERSION): { vec: Vec | null; confidence: number; labels: string[] } {
  const { vectors: CHIP_VECTORS, keywords: KEYWORDS, emoji: EMOJI } = tablesFor(version);
  const text = note.trim();
  if (!text) return { vec: null, confidence: 0, labels: [] };
  const hits: Array<{ v: Vec; w: number; label: string }> = [];
  const boost = INTENSIFIERS.some((w) => text.includes(w)) ? 1.3 : 1;
  const damp = NEGATIONS.some((w) => text.includes(w)) ? 0.5 : 1;
  for (const [word, chip, weight] of KEYWORDS) {
    const v = CHIP_VECTORS[chip];
    if (v && text.includes(word)) hits.push({ v, w: weight * boost * damp, label: chip });
  }
  for (const [emoji, list] of EMOJI) {
    if (!text.includes(emoji)) continue;
    for (const [chip, weight] of list) {
      const v = CHIP_VECTORS[chip];
      if (v) hits.push({ v, w: weight, label: chip });
    }
  }
  const vec = averageOf(hits);
  const confidence = Math.min(1, hits.reduce((s, h) => s + h.w, 0));
  if (!vec) return { vec: null, confidence: 0, labels: [] };
  const exclaim = (text.match(/!/g) ?? []).length > 0 ? 0.1 : 0;
  return { vec: { temp: vec.temp, energy: clamp(vec.energy + exclaim) }, confidence, labels: [...new Set(hits.map((h) => h.label))] };
}

/** version: 어항의 엔진 버전. 0.2.0이면 0.2.0 사전 그대로, 0.3.0이면 감정 사전(옛 이름은 새 표시명으로 읽음) */
export function analyzeMood(chips: string[], note: string, version: EngineVersion = ENGINE_VERSION): MoodVec {
  const { vectors: CHIP_VECTORS, canon: name } = tablesFor(version);
  const chipVec = averageOf(chips.map((c) => CHIP_VECTORS[c]).filter((v): v is Vec => !!v).map((v) => ({ v, w: 1 })));
  const n = analyzeNote(note, version);
  const noteUsable = n.vec && n.confidence >= MOOD_WEIGHTS.minNoteConfidence ? n.vec : null;
  const labels = [...new Set([...chips.filter((c) => c in CHIP_VECTORS).map(name), ...(noteUsable ? n.labels : [])])];
  if (chipVec && noteUsable) {
    return {
      temp: round(chipVec.temp * MOOD_WEIGHTS.chips + noteUsable.temp * MOOD_WEIGHTS.note),
      energy: round(chipVec.energy * MOOD_WEIGHTS.chips + noteUsable.energy * MOOD_WEIGHTS.note),
      confidence: 1,
      labels,
    };
  }
  if (chipVec) return { temp: round(chipVec.temp), energy: round(chipVec.energy), confidence: 1, labels };
  if (noteUsable) return { temp: round(noteUsable.temp), energy: round(noteUsable.energy), confidence: round(n.confidence), labels };
  return { ...NEUTRAL };
}

export function clamp(v: number, lo = -1, hi = 1): number {
  return Math.max(lo, Math.min(hi, v));
}

/** 소수점 4자리로 고정해 기기마다 부동소수 차이가 결과에 번지지 않게 한다. */
export function round(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/**
 * 0.3.0 대표 감정: 처음 고른 칩(앱이 '대표'로 표시한 칩이 맨 앞). 칩이 없으면 한마디 분석 결과(확신도 기준 이상)의 첫 감정.
 * 감정을 알 수 없으면 null(그 기록은 흔적을 만들지 않고 기본 생태계만 자람).
 */
export function representativeEmotion(chips: readonly string[], mood: MoodVec): EmotionDef | null {
  for (const c of chips) {
    const e = emotionOf(c);
    if (e) return e;
  }
  if (chips.length === 0 && mood.confidence >= MOOD_WEIGHTS.minNoteConfidence && mood.labels[0]) return emotionOf(mood.labels[0]) ?? null;
  return null;
}
