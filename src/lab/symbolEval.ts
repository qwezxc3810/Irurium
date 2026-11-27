import manifestJson from '../../public/assets/manifest.json';
import { ENGINE_VERSION } from '../engine/config';
import { EMOTIONS, emotionById } from '../engine/mood';
import { mulberry32 } from '../engine/random';

/**
 * 감정 상징 평가(블라인드): 상징 그림 하나를 보여 주고 "어떤 마음에서 생겼을까요?"를 고르게 한다.
 * - 12종 상징 + 대조 2개(감정과 무관한 기본 생태계 그림: 송사리·둥근 수석)
 * - 평가 중에는 이름·정답을 보여 주지 않는다. 순서는 세션마다 무작위
 * - 3명은 탐색용(헷갈리는 상징·혼동 패턴 찾기). 성공·출시 판단은 5명 이상 별도 평가로 정한다(PR #26 리뷰)
 * - 집계 단위는 '유효한 평가 세션'이다. 별칭은 선택이라 같은 사람이 여러 번 했는지 자동으로 알 수 없다.
 *   서로 다른 사람인지는 진행자가 확인한다(PR #27 리뷰)
 */
export const SE_SCHEMA = 'irurium.symbol-eval.v1';
export const SE_CRITERIA = {
  /** 탐색 결과를 보여 주는 최소 유효 세션 수(서로 다른 사람 3명이 하는 것을 전제로, 확인은 진행자가) */
  minEvaluators: 3,
  /** 출시 판단용(별도 평가) 권장 인원 */
  decisionEvaluators: 5,
  /** 상징 하나가 '잘 읽힘'으로 보는 맞힌 비율(초안). 찍으면 1/12 ≈ 8% */
  readable: 0.5,
  /** 이 비율 미만이면 '안 읽힘'(초안) */
  unreadable: 0.25,
} as const;

export type SeGuess = string; // 감정 id 또는 'unsure'
export const UNSURE = 'unsure';

export interface SeItem {
  id: string;
  /** 매니페스트 요소 id */
  el: string;
  src: string;
  /** 정답 감정 id. 대조 그림은 null(감정과 무관) */
  truth: string | null;
  /** 결과 화면용 이름(평가 중엔 보이지 않음) */
  name: string;
  /** 그림 모양: 바닥 장식 / 헤엄치는 물고기 / 떠다님 */
  shape: 'floor' | 'swim' | 'float';
}

const ELS = (manifestJson as { elements: Record<string, { src: string }> }).elements;
const SYMBOL_NAMES: Record<string, string> = {
  'emotion.sunset-coral': '노을빛 꽃산호', 'emotion.pearl-clam': '반짝이 진주조개', 'emotion.fish-school': '작은 물고기 떼',
  'emotion.stone-tower': '쌓아 올린 돌탑', 'emotion.star-jelly': '별빛 해파리', 'emotion.bottle-letter': '유리병 편지',
  'emotion.lantern-fish': '등불 물고기', 'emotion.tear-pearl': '푸른 눈물 진주', 'emotion.tangled-weed': '엉킨 해초',
  'emotion.foggy-compass': '안개 낀 나침반', 'emotion.black-urchin': '검은 성게', 'emotion.sleeping-conch': '잠든 소라고둥',
};
export const CONTROL_ELS = ['fish.medaka', 'rock.round'] as const;

export function seItems(): SeItem[] {
  const symbols = EMOTIONS.map((e): SeItem => ({
    id: e.symbol, el: e.symbol, src: ELS[e.symbol]!.src, truth: e.id, name: SYMBOL_NAMES[e.symbol] ?? e.symbol,
    shape: e.symbol === 'emotion.fish-school' || e.symbol === 'emotion.lantern-fish' ? 'swim' : e.symbol === 'emotion.star-jelly' ? 'float' : 'floor',
  }));
  const controls: SeItem[] = [
    { id: 'control.medaka', el: 'fish.medaka', src: ELS['fish.medaka']!.src, truth: null, name: '송사리(기본 생태계, 대조)', shape: 'swim' },
    { id: 'control.rock', el: 'rock.round', src: ELS['rock.round']!.src, truth: null, name: '둥근 수석(기본 생태계, 대조)', shape: 'floor' },
  ];
  return [...symbols, ...controls];
}

/** 고를 수 있는 답: 12개 감정(고정 순서) + 모르겠어요 */
export const GUESS_OPTIONS: Array<{ id: SeGuess; label: string }> = [...EMOTIONS.map((e) => ({ id: e.id, label: e.name })), { id: UNSURE, label: '잘 모르겠어요' }];
export const guessLabel = (g: SeGuess) => (g === UNSURE ? '모르겠어요' : emotionById(g)?.name ?? g);

export interface SeAnswer { itemId: string; guess: SeGuess }
export type SeOrigin = 'human' | 'synthetic-test';
export interface SeSession {
  schema: typeof SE_SCHEMA;
  id: string;
  evaluator: string;
  origin: SeOrigin;
  seed: number;
  order: string[];
  answers: SeAnswer[];
  startedAt: string;
  completedAt?: string;
  engineVersion: string;
  userAgent: string;
  /** 평가 도중 정답 화면이 열려 있었음(판정 제외) */
  blindBreach?: boolean;
}

export function shuffleItems(items: SeItem[], seed: number): string[] {
  const ids = items.map((i) => i.id);
  const rng = mulberry32(seed);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }
  return ids;
}

export function newSeSession(evaluator: string, seed: number, now: Date, userAgent: string, origin: SeOrigin = 'human'): SeSession {
  return {
    schema: SE_SCHEMA, id: `se-${now.getTime().toString(36)}-${(seed >>> 0).toString(36)}`, evaluator: evaluator.trim().slice(0, 40), origin,
    seed: seed >>> 0, order: shuffleItems(seItems(), seed), answers: [], startedAt: now.toISOString(), engineVersion: ENGINE_VERSION, userAgent: userAgent.slice(0, 200),
  };
}

const VALID_GUESS = new Set(GUESS_OPTIONS.map((g) => g.id));

export function seProblems(x: unknown): string[] {
  const s = x as Partial<SeSession>;
  const errs: string[] = [];
  if (!s || typeof s !== 'object') return ['세션이 아니에요'];
  if (s.schema !== SE_SCHEMA) errs.push('형식(schema)이 달라요');
  if (typeof s.id !== 'string' || !s.id) errs.push('id가 없어요');
  if (s.origin !== 'human' && s.origin !== 'synthetic-test') errs.push('출처(origin)가 틀려요');
  const ids = new Set(seItems().map((i) => i.id));
  if (!Array.isArray(s.order) || s.order.length !== ids.size || new Set(s.order).size !== ids.size || s.order.some((o) => !ids.has(o))) errs.push('문항 순서가 틀려요');
  if (!Array.isArray(s.answers)) errs.push('답이 없어요');
  else {
    const seen = new Set<string>();
    for (const a of s.answers) {
      if (!ids.has(a?.itemId)) errs.push('없는 문항에 답했어요');
      else if (seen.has(a.itemId)) errs.push('같은 문항에 두 번 답했어요');
      else seen.add(a.itemId);
      if (!VALID_GUESS.has(a?.guess)) errs.push('답 형식이 틀려요');
    }
  }
  if (typeof s.startedAt !== 'string' || Number.isNaN(Date.parse(s.startedAt))) errs.push('시작 시각이 틀려요');
  return [...new Set(errs)];
}

export function parseSeSessions(text: string): SeSession[] {
  const t = text.trim();
  if (!t) return [];
  const data = JSON.parse(t) as unknown;
  const list = Array.isArray(data) ? data : [data];
  for (const [i, x] of list.entries()) {
    const p = seProblems(x);
    if (p.length) throw new Error(`${i + 1}번째 세션: ${p.join(', ')}`);
  }
  return list as SeSession[];
}

export function seExclusion(s: SeSession): string | null {
  if (seProblems(s).length) return '형식·일관성 오류';
  if (s.origin !== 'human') return '테스트용(화면 시험)';
  if (!s.completedAt || s.answers.length < s.order.length) return '끝까지 하지 않음';
  if (s.blindBreach) return '평가 도중 정답 화면이 열려 있었음';
  return null;
}

/** 판정에 쓰는 세션: 사람·완료·위반 없음. 같은 id는 한 번만 */
export function seCounted(sessions: SeSession[]): SeSession[] {
  const seen = new Set<string>();
  return sessions.filter((s) => {
    if (seExclusion(s) || seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
}

export interface SeItemSummary {
  item: SeItem;
  n: number;
  /** 정답 감정을 고른 수(대조 그림은 0) */
  correct: number;
  unsure: number;
  /** 고른 답별 개수 */
  counts: Record<SeGuess, number>;
  /** 정답 말고 가장 많이 고른 감정(대조 그림은 가장 많이 고른 감정) */
  topWrong: { guess: SeGuess; n: number } | null;
  /** 탐색 판정(초안): 잘 읽힘 / 애매 / 안 읽힘 / 대조 */
  label: 'readable' | 'mixed' | 'unreadable' | 'control' | 'none';
}

export const SE_LABEL: Record<SeItemSummary['label'], string> = { readable: '잘 읽힘', mixed: '애매', unreadable: '안 읽힘', control: '대조', none: '—' };

export function seSummary(sessions: SeSession[]): SeItemSummary[] {
  const counted = seCounted(sessions);
  return seItems().map((item) => {
    const counts: Record<SeGuess, number> = {};
    for (const s of counted) for (const a of s.answers) if (a.itemId === item.id) counts[a.guess] = (counts[a.guess] ?? 0) + 1;
    const n = Object.values(counts).reduce((a, b) => a + b, 0);
    const correct = item.truth ? counts[item.truth] ?? 0 : 0;
    const unsure = counts[UNSURE] ?? 0;
    const wrong = Object.entries(counts).filter(([g]) => g !== UNSURE && g !== item.truth).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    const rate = n ? correct / n : 0;
    const label: SeItemSummary['label'] = !item.truth ? 'control' : n === 0 ? 'none' : rate >= SE_CRITERIA.readable ? 'readable' : rate < SE_CRITERIA.unreadable ? 'unreadable' : 'mixed';
    return { item, n, correct, unsure, counts, topWrong: wrong ? { guess: wrong[0], n: wrong[1] } : null, label };
  });
}

export interface SeOverview {
  /** 유효한 평가 세션 수(사람 수가 아님: 같은 사람이 여러 번 했는지는 알 수 없음) */
  evaluators: number;
  enough: boolean;
  /** 상징 12종 전체 맞힌 비율 */
  accuracy: number;
  unsureRate: number;
  /** 대조 그림에 어떤 감정을 고른 비율(높으면 '아무 그림이나 감정으로 읽는' 경향) */
  controlEmotionRate: number;
  counts: Record<SeItemSummary['label'], number>;
}

export function seOverview(sessions: SeSession[]): SeOverview {
  const rows = seSummary(sessions);
  const sym = rows.filter((r) => r.item.truth);
  const ctl = rows.filter((r) => !r.item.truth);
  const n = sym.reduce((a, r) => a + r.n, 0);
  const cn = ctl.reduce((a, r) => a + r.n, 0);
  const counts = { readable: 0, mixed: 0, unreadable: 0, control: 0, none: 0 };
  for (const r of rows) counts[r.label]++;
  const evaluators = seCounted(sessions).length;
  return {
    evaluators, enough: evaluators >= SE_CRITERIA.minEvaluators,
    accuracy: n ? sym.reduce((a, r) => a + r.correct, 0) / n : 0,
    unsureRate: n ? sym.reduce((a, r) => a + r.unsure, 0) / n : 0,
    controlEmotionRate: cn ? ctl.reduce((a, r) => a + r.n - r.unsure, 0) / cn : 0,
    counts,
  };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function formatSeReport(sessions: SeSession[], collection?: SeCollection): string {
  const o = seOverview(sessions);
  const rows = seSummary(sessions);
  const excluded = sessions.filter((s) => seExclusion(s)).length;
  const L: string[] = [];
  L.push(`# 감정 상징 평가(블라인드) — 엔진 ${ENGINE_VERSION}`);
  L.push('');
  L.push(`유효한 평가 세션 ${o.evaluators}개, 판정에서 뺀 세션 ${excluded}개. ${o.enough ? '' : `**세션 ${SE_CRITERIA.minEvaluators}개 미만이라 보류.** `}${o.evaluators < SE_CRITERIA.decisionEvaluators ? `탐색용 결과예요(출시 판단은 ${SE_CRITERIA.decisionEvaluators}명 이상 별도 평가).` : ''}`);
  L.push('');
  L.push('> 집계 단위는 세션이에요. 서로 다른 사람이 한 번씩 했는지는 진행자가 확인해 주세요(별칭은 선택이라 자동으로 알 수 없어요).');
  const after = collection ? seCounted(sessions).filter((x) => startedAfterReveal(x, collection)).length : 0;
  if (after) L.push(`> ⚠️ 이 기기에서 정답이 공개된 뒤 시작한 세션 ${after}개가 집계에 들어 있어요. 정답을 본 사람이 아닌지 확인하고, 봤다면 빼 주세요.`);
  L.push('');
  L.push(`- 상징 12종 전체 맞힌 비율 ${pct(o.accuracy)} (찍으면 약 8%), 모르겠어요 ${pct(o.unsureRate)}`);
  L.push(`- 대조 그림(송사리·둥근 수석)에 감정을 고른 비율 ${pct(o.controlEmotionRate)}`);
  L.push(`- 잘 읽힘(≥${pct(SE_CRITERIA.readable)}) ${o.counts.readable}종 · 애매 ${o.counts.mixed}종 · 안 읽힘(<${pct(SE_CRITERIA.unreadable)}) ${o.counts.unreadable}종`);
  L.push('');
  L.push('| 상징 | 정답 | 맞힘 | 모르겠어요 | 가장 많이 고른 다른 감정 | 탐색 판정 |');
  L.push('|---|---|---|---|---|---|');
  for (const r of rows) {
    const truth = r.item.truth ? guessLabel(r.item.truth) : '(감정과 무관)';
    const hit = r.item.truth ? `${r.correct}/${r.n}${r.n ? ` (${pct(r.correct / r.n)})` : ''}` : '—';
    L.push(`| ${r.item.name} | ${truth} | ${hit} | ${r.unsure}/${r.n} | ${r.topWrong ? `${guessLabel(r.topWrong.guess)} ${r.topWrong.n}` : '—'} | ${SE_LABEL[r.label]} |`);
  }
  return L.join('\n');
}

// ───────── 수집 상태(PR #27 재리뷰: 정답은 진행자가 수집을 끝낸 뒤에만) ─────────
/**
 * 이 기기의 평가 수집 상태.
 * - open(기본): 평가할 수 있고, 결과·정답·갤러리는 볼 수 없다(평가 전·평가자 사이 노출 방지)
 * - closed: 진행자가 '수집 종료'를 고른 뒤. 결과·정답을 볼 수 있고, 새 평가는 시작할 수 없다
 * - 다시 열면 결과는 다시 닫힌다. 정답이 한 번이라도 공개된 뒤 시작한 세션은 표시해서 진행자가 확인하게 한다
 */
export interface SeCollection {
  state: 'open' | 'closed';
  closedAt?: string;
  /** 이 기기에서 정답이 처음 공개된 시각 */
  firstRevealAt?: string;
}
export const SE_COLLECTION_OPEN: SeCollection = { state: 'open' };
export const resultsVisible = (c: SeCollection) => c.state === 'closed';
export const mayStartEval = (c: SeCollection) => c.state === 'open';
export function closeCollection(c: SeCollection, now: Date): SeCollection {
  const t = now.toISOString();
  return { state: 'closed', closedAt: t, firstRevealAt: c.firstRevealAt ?? t };
}
export function reopenCollection(c: SeCollection): SeCollection {
  return { state: 'open', ...(c.firstRevealAt ? { firstRevealAt: c.firstRevealAt } : {}) };
}
/** 정답이 공개된 뒤 시작한 세션인지(같은 기기). 자동으로 빼지는 않고 진행자가 확인하게 표시한다 */
export function startedAfterReveal(s: Pick<SeSession, 'startedAt'>, c: SeCollection): boolean {
  return !!c.firstRevealAt && Date.parse(s.startedAt) > Date.parse(c.firstRevealAt);
}
