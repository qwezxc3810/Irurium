import type { MoodVec } from './types';

/**
 * 감정 분석(규칙 기반, MVP).
 * 감정 칩 0.7 + 한마디 0.3. 수치는 모두 [가설] — v0.3.1 수정 노트 6장 H1·H2에서 검증한다.
 */

export const MOOD_WEIGHTS = { chips: 0.7, note: 0.3, minNoteConfidence: 0.3 } as const;

type Vec = { temp: number; energy: number };

/** 기본 마음 칩 8개 + 분야 칩. */
export const CHIP_VECTORS: Record<string, Vec> = {
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

export const BASE_CHIPS = ['따뜻함', '설렘', '유쾌함', '차분함', '그리움', '쓸쓸함', '답답함', '막막함'] as const;

/** 한마디 키워드 사전: 단어 → [칩, 가중치]. 실제 서비스에서는 별도 JSON으로 분리해 늘린다. */
const KEYWORDS: Array<[string, string, number]> = [
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

const EMOJI: Array<[string, Array<[string, number]>]> = [
  ['🥲', [['그리움', 0.6], ['따뜻함', 0.4]]],
  ['😤', [['답답함', 1]]],
  ['😊', [['따뜻함', 1]]],
  ['😂', [['유쾌함', 1]]],
  ['😢', [['쓸쓸함', 1]]],
  ['🥰', [['따뜻함', 0.7], ['설렘', 0.5]]],
];

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

export function analyzeNote(note: string): { vec: Vec | null; confidence: number; labels: string[] } {
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

export function analyzeMood(chips: string[], note: string): MoodVec {
  const chipVec = averageOf(chips.map((c) => CHIP_VECTORS[c]).filter((v): v is Vec => !!v).map((v) => ({ v, w: 1 })));
  const n = analyzeNote(note);
  const noteUsable = n.vec && n.confidence >= MOOD_WEIGHTS.minNoteConfidence ? n.vec : null;
  const labels = [...new Set([...chips.filter((c) => c in CHIP_VECTORS), ...(noteUsable ? n.labels : [])])];
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
