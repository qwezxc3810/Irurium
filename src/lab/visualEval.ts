import { ENGINE_VERSION } from '../engine/config';
import { addDays } from '../engine/dates';
import { seedFromString } from '../engine/random';
import type { TankConfig, TankState } from '../engine/types';
import { compositionDistance, layoutDistance, lightDistance, mean, moodCompositionDistance } from './metrics';
import { frameAt, runTank } from './runner';
import { SAMPLE_PREFIX, type RunResult, type SampleTank, type ScriptedEntry } from './types';

/**
 * V1 감정별 어항 다양성(시각) 검증.
 * 같은 책·기간·진행량·시드에서 감정 기록만 바꾼 어항과, 감정 기록은 같고 시드만 바꾼 어항을 만들고
 * 사람에게 블라인드로 보여 준다. 엔진 규칙·스냅샷·그래픽은 바꾸지 않는다. 모든 어항은 샘플(sample:) 기록이다.
 *
 * 자동 수치(엔진 상태 기반)와 사람 평가는 따로 저장하고 따로 계산한다.
 * 실제 사람 평가가 없으면(또는 최소 인원 미만이면) 판정은 언제나 '보류'다.
 */

export const VE_START = '2026-09-01';
export const VE_DAYS = [14, 100, 200] as const;
export type VeDay = (typeof VE_DAYS)[number];
const TOTAL_PAGES = 5000; // 200일 동안 끝나지 않게(완독 확인이 끼어들지 않게)
const DAILY_PAGES = 20;
const SEED_MAIN = 'sample:v1:seed-a';

export type EmotionKind = 'warm' | 'cool' | 'swing';
export const EMOTION_LABEL: Record<EmotionKind, string> = {
  warm: '따뜻한 감정(따뜻함·설렘·유쾌함)',
  cool: '차가운 감정(차분함·쓸쓸함·그리움)',
  swing: '감정 변화가 큼(4일마다 밝음 ↔ 막막·답답)',
};

/** 그날 감정 칩. 같은 날짜·같은 쪽수로 맞추고 칩만 다르다 */
export function chipsFor(kind: EmotionKind, day: number): string[] {
  if (kind === 'warm') return [['따뜻함'], ['설렘'], ['유쾌함']][day % 3]!;
  if (kind === 'cool') return [['차분함'], ['쓸쓸함'], ['그리움']][day % 3]!;
  const bright = Math.floor((day - 1) / 4) % 2 === 0;
  return bright ? [['유쾌함'], ['설렘']][day % 2]! : [['막막함'], ['답답함'], ['쓸쓸함']][day % 3]!;
}

function cfg(key: string, seedText: string): TankConfig {
  return {
    tankId: `${SAMPLE_PREFIX}v1:${key}`,
    seed: seedFromString(seedText),
    themeId: 'starlit-desert',
    goal: { type: 'amount', totalUnits: TOTAL_PAGES, dailyTarget: DAILY_PAGES },
    startDate: VE_START,
  };
}

function entries(key: string, kind: EmotionKind): ScriptedEntry[] {
  const out: ScriptedEntry[] = [];
  for (let day = 1; day <= 200; day++) {
    out.push({
      clientId: `${SAMPLE_PREFIX}v1:${key}:${day}`,
      localDate: addDays(VE_START, day - 1),
      time: '21:00',
      amount: DAILY_PAGES,
      progressValue: day * DAILY_PAGES,
      moodChips: chipsFor(kind, day),
      note: '',
    });
  }
  return out;
}

export interface VeTank {
  key: string;
  group: 'emotion' | 'seed';
  emotion: EmotionKind;
  seedText: string;
  tank: SampleTank;
}

/** 감정만 다른 3개(같은 시드) + 감정은 같고(차가운 감정) 시드만 다른 3개 */
export function veTanks(): VeTank[] {
  const make = (key: string, group: VeTank['group'], emotion: EmotionKind, seedText: string): VeTank => ({
    key, group, emotion, seedText,
    tank: { key, label: key, cfg: cfg(key, seedText), entries: entries(key, emotion), days: 200, tags: { emotion, seed: seedText } },
  });
  return [
    make('E-warm', 'emotion', 'warm', SEED_MAIN),
    make('E-cool', 'emotion', 'cool', SEED_MAIN),
    make('E-swing', 'emotion', 'swing', SEED_MAIN),
    make('S-a', 'seed', 'cool', 'sample:v1:seed-a'),
    make('S-b', 'seed', 'cool', 'sample:v1:seed-b'),
    make('S-c', 'seed', 'cool', 'sample:v1:seed-c'),
  ];
}

export type PairKind = 'emotion' | 'seed' | 'control';
export const PAIR_KIND_LABEL: Record<PairKind, string> = {
  emotion: '감정만 다름(같은 시드)',
  seed: '시드만 다름(같은 감정 기록)',
  control: '같은 어항 두 번(주의 확인용)',
};

export interface VePair {
  id: string;
  kind: PairKind;
  day: VeDay;
  a: string;
  b: string;
  /** 정답: 같은 기록(감정 기록)으로 만든 어항인가 */
  sameRecords: boolean;
}

/** 평가할 쌍 21개: 날짜마다 감정 쌍 3 + 시드 쌍 3 + 같은 어항 1 */
export function vePairs(): VePair[] {
  const out: VePair[] = [];
  for (const day of VE_DAYS) {
    for (const [a, b] of [['E-warm', 'E-cool'], ['E-warm', 'E-swing'], ['E-cool', 'E-swing']] as const) out.push({ id: `d${day}:${a}|${b}`, kind: 'emotion', day, a, b, sameRecords: false });
    for (const [a, b] of [['S-a', 'S-b'], ['S-a', 'S-c'], ['S-b', 'S-c']] as const) out.push({ id: `d${day}:${a}|${b}`, kind: 'seed', day, a, b, sameRecords: true });
    out.push({ id: `d${day}:E-swing|E-swing`, kind: 'control', day, a: 'E-swing', b: 'E-swing', sameRecords: true });
  }
  return out;
}

export interface VeSet {
  tanks: VeTank[];
  runs: Map<string, RunResult>;
  pairs: VePair[];
  state(key: string, day: VeDay): TankState;
}

export function runVisualSet(): VeSet {
  const tanks = veTanks();
  const runs = new Map(tanks.map((t) => [t.key, runTank(t.tank, 'sample')]));
  return {
    tanks, runs, pairs: vePairs(),
    state: (key, day) => frameAt(runs.get(key)!, day).state,
  };
}

// ───────── 블라인드 ─────────

/** 평가 화면에 넘기는 값: 어떤 감정·쌍 종류인지 들어 있지 않다 */
export interface BlindPair {
  pairId: string;
  index: number;
  day: VeDay;
  left: TankState;
  right: TankState;
}

/** 쌍 순서와 좌우를 섞는 간단한 난수(세션마다 다르게, 평가자 기기에서만 씀. 엔진과 무관) */
export function shuffleOrder(pairs: VePair[], seed: number): Array<{ pairId: string; swap: boolean }> {
  let x = seed >>> 0 || 1;
  const rnd = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
  const order = pairs.map((p) => ({ pairId: p.id, swap: rnd() < 0.5 }));
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

export function blindPair(set: VeSet, order: Array<{ pairId: string; swap: boolean }>, index: number): BlindPair {
  const o = order[index]!;
  const p = set.pairs.find((x) => x.id === o.pairId)!;
  const A = set.state(p.a, p.day);
  const B = set.state(p.b, p.day);
  return { pairId: p.id, index, day: p.day, left: o.swap ? B : A, right: o.swap ? A : B };
}

// ───────── 자동 수치 ─────────

export interface AutoPairMetric {
  pairId: string;
  kind: PairKind;
  day: VeDay;
  /** 기존 감정 구별 수치와 같은 거리(감정 쪽 구성 + 물빛) */
  moodComposition: number;
  composition: number;
  light: number;
  layout: number;
}

export function autoMetrics(set: VeSet): AutoPairMetric[] {
  return set.pairs.map((p) => {
    const a = set.state(p.a, p.day);
    const b = set.state(p.b, p.day);
    return { pairId: p.id, kind: p.kind, day: p.day, moodComposition: moodCompositionDistance(a, b), composition: compositionDistance(a, b), light: lightDistance(a, b), layout: layoutDistance(a, b) };
  });
}

/** 기존 '감정 구별' 수치 기준을 이 세트에 그대로: 감정 쌍 최소 거리 > 시드 쌍 최대 거리 */
export interface AutoDistinct {
  day: VeDay;
  emotionMin: number;
  seedMax: number;
  ok: boolean;
}

export function autoDistinct(metrics: AutoPairMetric[]): AutoDistinct[] {
  return VE_DAYS.map((day) => {
    const emo = metrics.filter((m) => m.day === day && m.kind === 'emotion').map((m) => m.moodComposition);
    const seed = metrics.filter((m) => m.day === day && m.kind === 'seed').map((m) => m.moodComposition);
    const emotionMin = Math.min(...emo);
    const seedMax = Math.max(...seed);
    return { day, emotionMin, seedMax, ok: emotionMin > seedMax };
  });
}

// ───────── 사람 평가 ─────────

export type SameAnswer = 'same' | 'different' | 'unsure';
export type EmotionGuess = EmotionKind | 'unsure';
export const SAME_LABEL: Record<SameAnswer, string> = { same: '같은 기록 같아요', different: '다른 기록 같아요', unsure: '모르겠어요' };
export const GUESS_LABEL: Record<EmotionGuess, string> = {
  warm: '따뜻하고 밝은 느낌',
  cool: '차분하고 차가운 느낌',
  swing: '들쑥날쑥, 감정이 오가는 느낌',
  unsure: '잘 모르겠어요',
};

export interface VeAnswer {
  pairId: string;
  /** 화면 왼쪽(위)에 B를 보였는지 */
  swap: boolean;
  same: SameAnswer;
  /** 화면 기준(왼쪽·오른쪽) 감정 추측 */
  emotionLeft: EmotionGuess;
  emotionRight: EmotionGuess;
  /** 두 어항이 얼마나 달라 보이는지 1(거의 같음) ~ 5(완전히 다름) */
  diff: 1 | 2 | 3 | 4 | 5;
  note?: string;
}

export const VE_SCHEMA = 'irurium.visual-eval.v1';
/**
 * 평가 출처. 'human'만 판정에 쓴다.
 * 'synthetic-test'는 테스트·화면 확인용으로 만든 가짜 응답이라 판정·요약의 사람 평가에서 언제나 빠진다.
 */
export type VeOrigin = 'human' | 'synthetic-test';

export interface VeSession {
  schema: typeof VE_SCHEMA;
  sessionId: string;
  origin: VeOrigin;
  /** 평가자 별칭(선택). 이름 대신 이니셜 등 */
  evaluator: string;
  engineVersion: string;
  startedAt: string;
  completedAt: string | null;
  order: Array<{ pairId: string; swap: boolean }>;
  answers: VeAnswer[];
  userAgent: string;
}

export function newSession(evaluator: string, seed: number, now: Date, userAgent: string, origin: VeOrigin = 'human'): VeSession {
  return {
    schema: VE_SCHEMA, sessionId: `ve-${now.getTime().toString(36)}-${(seed >>> 0).toString(36)}`, origin, evaluator: evaluator.trim().slice(0, 40),
    engineVersion: ENGINE_VERSION, startedAt: now.toISOString(), completedAt: null,
    order: shuffleOrder(vePairs(), seed), answers: [], userAgent,
  };
}

/** 내보낸 JSON을 읽는다. 형식이 틀리면 이유와 함께 거부 */
export function parseSessions(text: string): VeSession[] {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error('JSON 형식이 아니에요'); }
  const list = Array.isArray(raw) ? raw : [raw];
  const ids = new Set(vePairs().map((p) => p.id));
  return list.map((x, i) => {
    const s = x as Partial<VeSession>;
    if (s?.schema !== VE_SCHEMA) throw new Error(`${i + 1}번째: 이 평가 도구의 결과 파일이 아니에요`);
    if (s.origin !== 'human' && s.origin !== 'synthetic-test') throw new Error(`${i + 1}번째: 출처(origin)가 없어요`);
    if (!Array.isArray(s.answers) || !Array.isArray(s.order) || typeof s.sessionId !== 'string') throw new Error(`${i + 1}번째: 형식이 맞지 않아요`);
    for (const a of s.answers) {
      if (!ids.has(a.pairId)) throw new Error(`${i + 1}번째: 모르는 쌍(${a.pairId})`);
      if (![1, 2, 3, 4, 5].includes(a.diff)) throw new Error(`${i + 1}번째: 차이 점수가 1~5가 아니에요`);
    }
    return s as VeSession;
  });
}

/** 판정에 쓸 세션: 실제 사람 평가이고, 끝까지 답했고, 쌍 하나에 답이 하나씩 */
export function countedSessions(sessions: VeSession[]): VeSession[] {
  const total = vePairs().length;
  const seen = new Set<string>();
  return sessions.filter((s) => {
    if (s.origin !== 'human' || !s.completedAt || seen.has(s.sessionId)) return false;
    const pairIds = new Set(s.answers.map((a) => a.pairId));
    if (pairIds.size !== total || s.answers.length !== total) return false;
    seen.add(s.sessionId);
    return true;
  });
}

export interface HumanCell {
  kind: PairKind;
  day: VeDay | 'all';
  answers: number;
  /** '같은 기록인지' 정답률(감정 쌍은 '다름', 시드·같은 어항 쌍은 '같음'이 정답, 모르겠어요는 오답으로 셈) */
  sameCorrect: number | null;
  /** 차이 점수 평균(1~5) */
  diffMean: number | null;
  /** 감정 추측 정답률(같은 어항 쌍 제외, '모르겠어요'는 오답) */
  emotionCorrect: number | null;
}

function truthOf(set: { tanks: VeTank[] }, key: string): EmotionKind {
  return set.tanks.find((t) => t.key === key)!.emotion;
}

export function humanSummary(sessions: VeSession[], tanks: VeTank[] = veTanks()): HumanCell[] {
  const counted = countedSessions(sessions);
  const pairs = new Map(vePairs().map((p) => [p.id, p]));
  const cells: HumanCell[] = [];
  for (const kind of ['emotion', 'seed', 'control'] as PairKind[]) {
    for (const day of [...VE_DAYS, 'all'] as Array<VeDay | 'all'>) {
      const rows = counted.flatMap((s) => s.answers).filter((a) => {
        const p = pairs.get(a.pairId)!;
        return p.kind === kind && (day === 'all' || p.day === day);
      });
      const n = rows.length;
      const sameOk = rows.filter((a) => (pairs.get(a.pairId)!.sameRecords ? a.same === 'same' : a.same === 'different')).length;
      let emoTotal = 0;
      let emoOk = 0;
      if (kind !== 'control') {
        for (const a of rows) {
          const p = pairs.get(a.pairId)!;
          const leftKey = a.swap ? p.b : p.a;
          const rightKey = a.swap ? p.a : p.b;
          emoTotal += 2;
          if (a.emotionLeft === truthOf({ tanks }, leftKey)) emoOk++;
          if (a.emotionRight === truthOf({ tanks }, rightKey)) emoOk++;
        }
      }
      cells.push({
        kind, day, answers: n,
        sameCorrect: n ? sameOk / n : null,
        diffMean: n ? mean(rows.map((a) => a.diff)) : null,
        emotionCorrect: emoTotal ? emoOk / emoTotal : null,
      });
    }
  }
  return cells;
}

/** 판정 기준(초안). 기획자가 실제 평가를 보고 확정한다 */
export const V1_CRITERIA = {
  minEvaluators: 5, // 기존 계획(짝짓기 테스트 지인 5명 이상)과 같게
  emotionDifferentRate: 0.7,
  diffGap: 1.0,
  emotionGuessRate: 0.5,
  controlSameRate: 0.6,
} as const;

export type V1Verdict = 'hold' | 'pass' | 'adjust';
export const V1_VERDICT_LABEL: Record<V1Verdict, string> = { hold: '보류(사람 평가 부족)', pass: '통과(기준 초안)', adjust: '조정 필요(기준 초안)' };

export interface V1Result {
  verdict: V1Verdict;
  evaluators: number;
  excluded: number;
  reasons: string[];
}

/**
 * V1 판정. 실제 사람 평가(origin 'human', 완료, 21쌍 모두)가 최소 인원보다 적으면 언제나 보류.
 * 자동 수치는 판정에 넣지 않는다(비교용으로만 보여 준다).
 */
export function v1Verdict(sessions: VeSession[]): V1Result {
  const counted = countedSessions(sessions);
  const excluded = sessions.length - counted.length;
  if (counted.length < V1_CRITERIA.minEvaluators) {
    return {
      verdict: 'hold', evaluators: counted.length, excluded,
      reasons: [`판정에 쓸 실제 사람 평가가 ${counted.length}명이에요(최소 ${V1_CRITERIA.minEvaluators}명). 자동 수치만으로는 통과시키지 않아요.`],
    };
  }
  const cell = (kind: PairKind) => humanSummary(counted).find((c) => c.kind === kind && c.day === 'all')!;
  const emo = cell('emotion');
  const seed = cell('seed');
  const ctl = cell('control');
  const checks: Array<[boolean, string]> = [
    [(emo.sameCorrect ?? 0) >= V1_CRITERIA.emotionDifferentRate, `감정만 다른 쌍을 '다른 기록'으로 본 비율 ${pct(emo.sameCorrect)} (기준 ${pct(V1_CRITERIA.emotionDifferentRate)} 이상)`],
    [(emo.diffMean ?? 0) - (seed.diffMean ?? 0) >= V1_CRITERIA.diffGap, `차이 점수: 감정 쌍 ${n2(emo.diffMean)} − 시드 쌍 ${n2(seed.diffMean)} = ${n2((emo.diffMean ?? 0) - (seed.diffMean ?? 0))} (기준 ${V1_CRITERIA.diffGap} 이상)`],
    [(emo.emotionCorrect ?? 0) >= V1_CRITERIA.emotionGuessRate, `감정 쌍 어항의 감정 맞힌 비율 ${pct(emo.emotionCorrect)} (기준 ${pct(V1_CRITERIA.emotionGuessRate)} 이상, 찍으면 약 33%)`],
    [(ctl.sameCorrect ?? 0) >= V1_CRITERIA.controlSameRate, `같은 어항 두 번을 '같은 기록'으로 본 비율 ${pct(ctl.sameCorrect)} (주의 확인, 기준 ${pct(V1_CRITERIA.controlSameRate)} 이상)`],
  ];
  return {
    verdict: checks.every(([ok]) => ok) ? 'pass' : 'adjust',
    evaluators: counted.length, excluded,
    reasons: checks.map(([ok, t]) => `${ok ? '✓' : '✗'} ${t}`),
  };
}

const pct = (x: number | null) => (x == null ? '-' : `${Math.round(x * 100)}%`);
const n2 = (x: number | null) => (x == null ? '-' : x.toFixed(2));

/** 자동 수치와 사람 평가를 한 표로(날짜별). 두 값은 서로 섞지 않는다 */
export interface CompareRow {
  day: VeDay;
  autoEmotionMin: number;
  autoSeedMax: number;
  autoOk: boolean;
  autoEmotionMean: number;
  autoSeedMean: number;
  humanEvaluators: number;
  humanEmotionDiff: number | null;
  humanSeedDiff: number | null;
  humanEmotionDifferentRate: number | null;
  humanEmotionGuess: number | null;
}

export function compareRows(set: VeSet, sessions: VeSession[]): CompareRow[] {
  const m = autoMetrics(set);
  const ad = autoDistinct(m);
  const counted = countedSessions(sessions);
  const hs = humanSummary(counted, set.tanks);
  return VE_DAYS.map((day) => {
    const a = ad.find((x) => x.day === day)!;
    const he = hs.find((c) => c.kind === 'emotion' && c.day === day)!;
    const hseed = hs.find((c) => c.kind === 'seed' && c.day === day)!;
    return {
      day,
      autoEmotionMin: a.emotionMin, autoSeedMax: a.seedMax, autoOk: a.ok,
      autoEmotionMean: mean(m.filter((x) => x.day === day && x.kind === 'emotion').map((x) => x.moodComposition)),
      autoSeedMean: mean(m.filter((x) => x.day === day && x.kind === 'seed').map((x) => x.moodComposition)),
      humanEvaluators: counted.length,
      humanEmotionDiff: he.diffMean, humanSeedDiff: hseed.diffMean,
      humanEmotionDifferentRate: he.sameCorrect, humanEmotionGuess: he.emotionCorrect,
    };
  });
}

/** 정리용 텍스트(복사해서 PR·문서에 붙임). 자동 수치와 사람 평가를 다른 절로 나눈다 */
export function formatV1Report(set: VeSet, sessions: VeSession[]): string {
  const rows = compareRows(set, sessions);
  const v = v1Verdict(sessions);
  const L: string[] = [];
  L.push(`# V1 감정별 어항 다양성(시각) — 엔진 ${ENGINE_VERSION}`);
  L.push('');
  L.push('## 자동 수치 (엔진 상태 기반, 샘플 기록)');
  L.push('| 날짜 | 감정 쌍 최소 거리 | 시드 쌍 최대 거리 | 기존 감정 구별 기준(최소 > 최대) | 감정 쌍 평균 | 시드 쌍 평균 |');
  L.push('|---|---|---|---|---|---|');
  for (const r of rows) L.push(`| ${r.day}일 | ${r.autoEmotionMin.toFixed(3)} | ${r.autoSeedMax.toFixed(3)} | ${r.autoOk ? '통과(수치)' : '미달(수치)'} | ${r.autoEmotionMean.toFixed(3)} | ${r.autoSeedMean.toFixed(3)} |`);
  L.push('');
  L.push(`## 사람 평가 (실제 평가 ${v.evaluators}명${v.excluded ? `, 판정에서 뺀 세션 ${v.excluded}개` : ''})`);
  if (!v.evaluators) L.push('아직 실제 사람 평가가 없어요.');
  else {
    L.push('| 날짜 | 감정 쌍 차이 점수 | 시드 쌍 차이 점수 | 감정 쌍을 다른 기록으로 본 비율 | 감정 맞힌 비율 |');
    L.push('|---|---|---|---|---|');
    for (const r of rows) L.push(`| ${r.day}일 | ${n2(r.humanEmotionDiff)} | ${n2(r.humanSeedDiff)} | ${pct(r.humanEmotionDifferentRate)} | ${pct(r.humanEmotionGuess)} |`);
  }
  L.push('');
  L.push(`## 판정: ${V1_VERDICT_LABEL[v.verdict]}`);
  for (const r of v.reasons) L.push(`- ${r}`);
  return L.join('\n');
}
