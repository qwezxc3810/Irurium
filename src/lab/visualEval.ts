import { ENGINE_VERSION } from '../engine/config';
import { addDays } from '../engine/dates';
import { seedFromString } from '../engine/random';
import type { TankConfig, TankState } from '../engine/types';
import { compositionDistance, layoutDistance, lightDistance, mean, moodCompositionDistance } from './metrics';
import { frameAt, runTank } from './runner';
import { applyBackgroundGrade, atmosphere, backgroundGrade, compositeWater, hasBackgroundGrade, RENDER_STYLE, RENDER_STYLES, type RenderStyle } from '../render/atmosphere';
import { gradedWater } from '../render/lighting';
import { WATER } from './metrics';
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
  /** 그날 감정 이력 흔들림(분위기 렌더링 입력) */
  spread(key: string, day: VeDay): number;
}

export function runVisualSet(): VeSet {
  const tanks = veTanks();
  const runs = new Map(tanks.map((t) => [t.key, runTank(t.tank, 'sample')]));
  return {
    tanks, runs, pairs: vePairs(),
    state: (key, day) => frameAt(runs.get(key)!, day).state,
    spread: (key, day) => frameAt(runs.get(key)!, day).moodSpread,
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
  /** 분위기 렌더링 입력(숫자만, 감정 이름 없음) */
  leftSpread: number;
  rightSpread: number;
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
  const sa = set.spread(p.a, p.day);
  const sb = set.spread(p.b, p.day);
  return { pairId: p.id, index, day: p.day, left: o.swap ? B : A, right: o.swap ? A : B, leftSpread: o.swap ? sb : sa, rightSpread: o.swap ? sa : sb };
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
  /** 평가 도중(시작 뒤 끝나기 전) 정답 화면이 열린 적이 있으면 true. 블라인드 위반이라 판정에서 뺀다 */
  blindBreach?: boolean;
  /** 평가에 쓴 렌더링 버전. 없으면 기존 렌더링(v0, 이 칸이 생기기 전 결과). 버전끼리 판정을 섞지 않는다 */
  renderStyle?: RenderStyle;
}

export const styleOf = (s: Pick<VeSession, 'renderStyle'>): RenderStyle => s.renderStyle ?? 'v0';

export function newSession(evaluator: string, seed: number, now: Date, userAgent: string, origin: VeOrigin = 'human', renderStyle: RenderStyle = RENDER_STYLE): VeSession {
  return {
    renderStyle,
    schema: VE_SCHEMA, sessionId: `ve-${now.getTime().toString(36)}-${(seed >>> 0).toString(36)}`, origin, evaluator: evaluator.trim().slice(0, 40),
    engineVersion: ENGINE_VERSION, startedAt: now.toISOString(), completedAt: null,
    order: shuffleOrder(vePairs(), seed), answers: [], userAgent,
  };
}

const SAME_VALUES: readonly SameAnswer[] = ['same', 'different', 'unsure'];
const GUESS_VALUES: readonly EmotionGuess[] = ['warm', 'cool', 'swing', 'unsure'];

/**
 * 세션 하나의 형식·일관성 문제(없으면 빈 배열).
 * - order: 21쌍을 빠짐없이 한 번씩, swap은 참·거짓
 * - answers: order에 있는 쌍에 한 번씩, swap은 **실제로 보여 준 order의 swap과 같아야** 함, 응답 값은 허용값만
 * - 완료 세션은 21쌍 모두 답해야 함
 */
export function sessionProblems(x: unknown): string[] {
  const s = x as Partial<VeSession> | null;
  if (!s || typeof s !== 'object') return ['세션이 객체가 아니에요'];
  const errs: string[] = [];
  if (s.schema !== VE_SCHEMA) return ['이 평가 도구의 결과 파일이 아니에요'];
  if (s.origin !== 'human' && s.origin !== 'synthetic-test') errs.push('출처(origin)가 없어요');
  if (typeof s.sessionId !== 'string' || !s.sessionId) errs.push('세션 id가 없어요');
  if (typeof s.engineVersion !== 'string') errs.push('엔진 버전이 없어요');
  if (typeof s.startedAt !== 'string') errs.push('시작 시각이 없어요');
  if (s.completedAt !== null && typeof s.completedAt !== 'string') errs.push('완료 시각 형식이 틀려요');
  if (!Array.isArray(s.order) || !Array.isArray(s.answers)) return [...errs, '순서(order)나 답(answers)이 배열이 아니에요'];
  const known = new Set(vePairs().map((p) => p.id));
  const shown = new Map<string, boolean>();
  for (const o of s.order) {
    if (!o || !known.has(o.pairId)) { errs.push(`순서에 모르는 쌍이 있어요(${o?.pairId})`); continue; }
    if (typeof o.swap !== 'boolean') errs.push(`순서의 좌우(swap) 형식이 틀려요(${o.pairId})`);
    if (shown.has(o.pairId)) errs.push(`순서에 같은 쌍이 두 번 있어요(${o.pairId})`);
    shown.set(o.pairId, o.swap);
  }
  if (shown.size !== known.size) errs.push(`순서가 ${known.size}쌍을 모두 담고 있지 않아요(${shown.size}쌍)`);
  const answered = new Set<string>();
  for (const a of s.answers) {
    if (!a || !shown.has(a.pairId)) { errs.push(`보여 주지 않은 쌍에 답했어요(${a?.pairId})`); continue; }
    if (answered.has(a.pairId)) errs.push(`같은 쌍에 두 번 답했어요(${a.pairId})`);
    answered.add(a.pairId);
    if (a.swap !== shown.get(a.pairId)) errs.push(`답의 좌우(swap)가 실제로 보여 준 순서와 달라요(${a.pairId})`);
    if (!SAME_VALUES.includes(a.same)) errs.push(`'같은 기록' 답이 허용값이 아니에요(${a.pairId})`);
    if (!GUESS_VALUES.includes(a.emotionLeft) || !GUESS_VALUES.includes(a.emotionRight)) errs.push(`감정 답이 허용값이 아니에요(${a.pairId})`);
    if (![1, 2, 3, 4, 5].includes(a.diff)) errs.push(`차이 점수가 1~5가 아니에요(${a.pairId})`);
    if (a.note !== undefined && typeof a.note !== 'string') errs.push(`한마디 형식이 틀려요(${a.pairId})`);
  }
  if (s.completedAt && answered.size !== known.size) errs.push(`완료로 표시됐지만 ${answered.size}/${known.size}쌍만 답했어요`);
  if (s.blindBreach !== undefined && typeof s.blindBreach !== 'boolean') errs.push('블라인드 위반 표시 형식이 틀려요');
  if (s.renderStyle !== undefined && !RENDER_STYLES.includes(s.renderStyle)) errs.push('렌더링 버전 형식이 틀려요');
  return errs;
}

/** 내보낸 JSON을 읽는다. 형식·일관성이 틀린 세션이 하나라도 있으면 이유와 함께 거부 */
export function parseSessions(text: string): VeSession[] {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error('JSON 형식이 아니에요'); }
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((x, i) => {
    const errs = sessionProblems(x);
    if (errs.length) throw new Error(`${i + 1}번째: ${errs.slice(0, 3).join(' / ')}${errs.length > 3 ? ` 외 ${errs.length - 3}개` : ''}`);
    return x as VeSession;
  });
}

/**
 * 정답 화면은 열려 있는 동안 REVEAL_HEARTBEAT_MS마다 '마지막으로 열려 있던 시각'을 남긴다.
 * 이 시각이 REVEAL_FRESH_MS 안이면 지금 어느 탭에서든 정답 화면이 열려 있다고 본다.
 */
export const REVEAL_HEARTBEAT_MS = 1000;
export const REVEAL_FRESH_MS = 2500;

/** 평가를 시작해도 되는지: 다른 탭 등에 정답 화면이 열려 있으면 안 됨 */
export function canStartEvaluation(revealedAt: string | null, nowMs: number): boolean {
  if (!revealedAt) return true;
  return nowMs - Date.parse(revealedAt) > REVEAL_FRESH_MS;
}

/**
 * 블라인드 위반: 정답 화면이 '마지막으로 열려 있던 시각'이 평가 시작 뒤(완료 전)면 위반.
 * 정답 화면은 열려 있는 동안 계속 시각을 갱신하므로, 평가 전부터 열어 둔 화면도 평가 도중까지 열려 있었다면 잡힌다.
 * 시작 직전(REVEAL_FRESH_MS 안)에 열려 있던 것도 위반으로 본다(엄격하게).
 */
export function isBlindBreach(session: Pick<VeSession, 'startedAt'>, revealedAt: string | null, completedAt: string): boolean {
  if (!revealedAt) return false;
  const t = Date.parse(revealedAt);
  return t >= Date.parse(session.startedAt) - REVEAL_FRESH_MS && t <= Date.parse(completedAt);
}

/** 판정에서 빼는 까닭(없으면 null) */
export function exclusionReason(s: VeSession, style: RenderStyle = RENDER_STYLE): string | null {
  if (sessionProblems(s).length) return '형식·일관성 오류';
  if (s.origin !== 'human') return '테스트용(화면 시험·자동화)';
  if (!s.completedAt) return '끝까지 답하지 않음';
  if (s.blindBreach) return '블라인드 위반(평가 도중 정답 화면 열림)';
  if (s.engineVersion !== ENGINE_VERSION) return `다른 엔진 버전(${s.engineVersion})으로 본 어항`;
  if (styleOf(s) !== style) return `다른 렌더링(${styleOf(s)})으로 본 어항`;
  return null;
}

/**
 * 판정에 쓸 세션: 실제 사람 평가, 형식·일관성 정상, 끝까지 답함, 블라인드 유지, 지금 엔진 버전, 같은 세션은 한 번.
 * 주의: 세는 단위는 '고유 세션'이다. 같은 사람이 여러 번 평가하면 여러 명으로 셀 수 있어서, 평가자 중복은 수집 절차에서 막는다.
 */
export function countedSessions(sessions: VeSession[], style: RenderStyle = RENDER_STYLE): VeSession[] {
  const seen = new Set<string>();
  return sessions.filter((s) => {
    if (exclusionReason(s, style) || seen.has(s.sessionId)) return false;
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

export function humanSummary(sessions: VeSession[], tanks: VeTank[] = veTanks(), style: RenderStyle = RENDER_STYLE): HumanCell[] {
  const counted = countedSessions(sessions, style);
  const pairs = new Map(vePairs().map((p) => [p.id, p]));
  const shownSwap = new Map<VeAnswer, boolean>();
  for (const s of counted) {
    const order = new Map(s.order.map((o) => [o.pairId, o.swap]));
    for (const a of s.answers) shownSwap.set(a, order.get(a.pairId)!);
  }
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
          // 좌우는 답에 적힌 값이 아니라 실제로 보여 준 순서(order)로 정한다
          const swap = shownSwap.get(a)!;
          const leftKey = swap ? p.b : p.a;
          const rightKey = swap ? p.a : p.b;
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

/**
 * 감정 맞히기 답 분포: 실제 감정(행) × 고른 답(열) 개수. 감정 쌍·시드 쌍의 양쪽 어항을 모두 센다(대조 쌍 제외).
 * '잘 모르겠어요'가 많은지, 어떤 감정과 헷갈리는지 보는 용도. 좌우는 실제로 보여 준 순서(order)로 정한다.
 */
export type GuessMatrix = Record<EmotionKind, Record<EmotionGuess, number>>;

export function guessMatrix(sessions: VeSession[], tanks: VeTank[] = veTanks(), style: RenderStyle = RENDER_STYLE): GuessMatrix {
  const zero = (): Record<EmotionGuess, number> => ({ warm: 0, cool: 0, swing: 0, unsure: 0 });
  const out: GuessMatrix = { warm: zero(), cool: zero(), swing: zero() };
  const pairs = new Map(vePairs().map((p) => [p.id, p]));
  for (const s of countedSessions(sessions, style)) {
    const order = new Map(s.order.map((o) => [o.pairId, o.swap]));
    for (const a of s.answers) {
      const p = pairs.get(a.pairId)!;
      if (p.kind === 'control') continue;
      const swap = order.get(a.pairId)!;
      out[truthOf({ tanks }, swap ? p.b : p.a)][a.emotionLeft]++;
      out[truthOf({ tanks }, swap ? p.a : p.b)][a.emotionRight]++;
    }
  }
  return out;
}

/** 판정 기준(초안). 기획자가 실제 평가를 보고 확정한다 */
export const V1_CRITERIA = {
  minEvaluators: 3, // 기획자 결정(2026-11-17): 빠른 반복을 위해 5명 → 3명. 표본이 작아 판정이 흔들릴 수 있음
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
export function v1Verdict(sessions: VeSession[], style: RenderStyle = RENDER_STYLE): V1Result {
  const counted = countedSessions(sessions, style);
  const excluded = sessions.length - counted.length;
  if (counted.length < V1_CRITERIA.minEvaluators) {
    return {
      verdict: 'hold', evaluators: counted.length, excluded,
      reasons: [`판정에 쓸 실제 사람 평가가 ${counted.length}개 세션이에요(최소 ${V1_CRITERIA.minEvaluators}개, 한 사람 한 번 기준). 자동 수치만으로는 통과시키지 않아요.`],
    };
  }
  const cell = (kind: PairKind) => humanSummary(counted, veTanks(), style).find((c) => c.kind === kind && c.day === 'all')!;
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

export function compareRows(set: VeSet, sessions: VeSession[], style: RenderStyle = RENDER_STYLE): CompareRow[] {
  const m = autoMetrics(set);
  const ad = autoDistinct(m);
  const counted = countedSessions(sessions, style);
  const hs = humanSummary(counted, set.tanks, style);
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
export function formatV1Report(set: VeSet, sessions: VeSession[], style: RenderStyle = RENDER_STYLE): string {
  const rows = compareRows(set, sessions, style);
  const v = v1Verdict(sessions, style);
  const L: string[] = [];
  L.push(`# V1 감정별 어항 다양성(시각) — 엔진 ${ENGINE_VERSION} · 렌더링 ${style}`);
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
    const gm = guessMatrix(sessions, set.tanks, style);
    L.push('');
    L.push('### 감정 맞히기 답 분포 (실제 감정 × 고른 답, 감정·시드 쌍의 어항 모두 — 판정의 감정 맞힌 비율(감정 쌍만)과 분모가 달라요)');
    L.push('| 실제 감정 | 따뜻함 | 차가움 | 들쑥날쑥 | 모르겠어요 |');
    L.push('|---|---|---|---|---|');
    for (const k of ['warm', 'cool', 'swing'] as const) L.push(`| ${GUESS_LABEL[k]} | ${gm[k].warm} | ${gm[k].cool} | ${gm[k].swing} | ${gm[k].unsure} |`);
  }
  L.push('');
  L.push(`## 판정: ${V1_VERDICT_LABEL[v.verdict]}`);
  for (const r of v.reasons) L.push(`- ${r}`);
  return L.join('\n');
}

/**
 * 자동 비교: 화면 물 색(대략값) 차이. 렌더링 버전마다 계산한다(엔진 상태는 같음).
 * v0은 기존 조명 색 보정만, atmos-1은 그 위에 생물 뒤 물색 덧칠까지 올린 색. RGB 거리(0~441).
 * 사람 눈의 구별과 같지 않다. 비교용 참고값이다.
 */
export interface WaterGap {
  day: VeDay;
  style: RenderStyle;
  emotionMean: number;
  seedMean: number;
}

export function waterColorOf(state: TankState, spread: number, style: RenderStyle): [number, number, number] {
  const mood = { temp: state.light.temp, energy: state.light.energy, spread };
  // atmos-2: 배경 그림 색감을 먼저 바꾸고(감정 배경), 그 위에 기존 조명·물색 덧칠
  const base = hasBackgroundGrade(style) ? applyBackgroundGrade(WATER, backgroundGrade(mood)) : WATER;
  const graded = gradedWater(base, state.light);
  if (style === 'v0') return graded;
  const hex = (graded[0] << 16) | (graded[1] << 8) | graded[2];
  return compositeWater(hex, atmosphere(mood));
}

export function waterGaps(set: VeSet): WaterGap[] {
  const dist = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
  const out: WaterGap[] = [];
  for (const style of [...RENDER_STYLES].reverse()) {
    for (const day of VE_DAYS) {
      const gap = (kind: PairKind) => mean(set.pairs.filter((p) => p.day === day && p.kind === kind).map((p) =>
        dist(waterColorOf(set.state(p.a, day), set.spread(p.a, day), style), waterColorOf(set.state(p.b, day), set.spread(p.b, day), style))));
      out.push({ day, style, emotionMean: gap('emotion'), seedMean: gap('seed') });
    }
  }
  return out;
}

