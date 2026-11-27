import { ENGINE_VERSION } from '../engine/config';
import { EMOTIONS } from '../engine/mood';
import { GUESS_OPTIONS, seItems, shuffleItems, UNSURE, type SeGuess, type SeItem } from './symbolEval';

/**
 * 감정 상징 기억 평가(24시간). 규칙은 docs/MEMORY_EVAL.md.
 * 같은 참여자가 세 단계를 순서대로 한다.
 *   A. 첫인상: 설명 없이 상징을 보고 마음 고르기(블라인드, 확신 정도 함께)
 *   B. 체험: 배정된 조건대로 노출(마음 골라 흔적이 생기는 체험 / 감정 도감 보기 / 둘 다 / 없음)
 *   C. 약 24시간 뒤: 설명·도감 없이 다시 고르기 + "체험 때 일이 떠오르는지" 회상 질문
 * - 정답률과 회상은 따로 집계한다(PR #27 후속 리뷰). 3명은 탐색용
 * - 노출 조건·노출 횟수·경과 시간을 기록해, 표본을 늘렸을 때 조건끼리 비교할 수 있게 한다
 *   (같은 그림을 두 번 본 것만으로도 기억이 오를 수 있어 'none' 조건이 대조군)
 * - 개인정보: 체험의 한마디는 저장하지 않고 썼는지 여부만 남긴다
 */
export const ME_SCHEMA = 'irurium.memory-eval.v1';
export const ME_CRITERIA = {
  /** 탐색 결과를 보여 주는 최소 완료 참여자 수 */
  minParticipants: 3,
  /** 권장 경과 시간(B 끝 → C 시작, 시간). 벗어나면 표시만 하고 빼지는 않는다 */
  idealHours: [20, 30] as const,
  /** C를 시작할 수 있는 최소 경과 시간(이보다 짧으면 '다음 날'이 아님) */
  minHours: 12,
  /** 체험: 최소·최대 기록 수 */
  experienceMin: 4,
  experienceMax: 8,
  /** 도감 보기 최소 시간(ms). 훑고 지나가지 않게(다 읽었다는 뜻은 아님) */
  guideMinMs: 20_000,
  /** 체험: 흔적 장면을 보여 준 뒤 다음 입력·종료까지 최소 시간(ms). 빠른 클릭으로 노출 없이 넘기지 않게 */
  noticeMinMs: 3_000,
} as const;

export type MeCondition = 'experience' | 'guide' | 'both' | 'none';
/** 자동 배정 순서. 3명 탐색에서도 대조(none)가 반드시 들어가도록 두 번째에 둔다(PR #29 리뷰) */
export const CONDITIONS: MeCondition[] = ['experience', 'none', 'both', 'guide'];
export const CONDITION_LABEL: Record<MeCondition, string> = {
  experience: '체험(마음 골라 흔적 생기기)',
  guide: '감정 도감 보기',
  both: '체험 + 도감',
  none: '노출 없음(대조)',
};

export type MeConfidence = 1 | 2 | 3;
export const CONFIDENCE_LABEL: Record<MeConfidence, string> = { 1: '찍었어요', 2: '아마도', 3: '확실해요' };

export type MeRecall = 'clear' | 'vague' | 'none' | 'not-seen';
export const RECALL_OPTIONS: Array<{ id: MeRecall; label: string }> = [
  { id: 'clear', label: '또렷이 떠올라요' },
  { id: 'vague', label: '어렴풋해요' },
  { id: 'none', label: '떠오르지 않아요' },
  { id: 'not-seen', label: '체험 때 못 본 것 같아요' },
];

export interface MeAnswer { itemId: string; guess: SeGuess; confidence: MeConfidence; ms: number; recall?: MeRecall }
export interface MeTest {
  seed: number;
  order: string[];
  answers: MeAnswer[];
  startedAt: string;
  completedAt?: string;
  /** 평가 도중 정답 화면이 열려 있었음(판정 제외) */
  blindBreach?: boolean;
}
export interface MeRecord {
  emotionId: string; symbolId: string; at: string; noted: boolean;
  /** 흔적 장면을 본 시간(장면 표시 → 다음 기록 또는 체험 종료, ms) */
  viewMs?: number;
}
export interface MeExposure {
  startedAt: string;
  completedAt?: string;
  /** 체험에서 고른 마음 → 생긴 흔적 */
  records: MeRecord[];
  /** 도감을 연 횟수와 머문 시간 */
  guideOpens: number;
  guideMs: number;
}
export type MeOrigin = 'human' | 'synthetic-test';
/** 평가 전에 정답이 담긴 화면(앱 감정 도감, 상징 평가 결과 등)을 본 적이 있는지. 자동으로 빼지 않고 보고서에 표시 */
export type MePrior = 'no' | 'yes' | 'unsure';
export const PRIOR_LABEL: Record<MePrior, string> = { no: '본 적 없어요', yes: '본 적 있어요', unsure: '잘 모르겠어요' };
export interface MeParticipant {
  schema: typeof ME_SCHEMA;
  id: string;
  /** 참여자가 다음 날 이어서 하려고 기억하는 짧은 코드(이름 대신) */
  code: string;
  origin: MeOrigin;
  condition: MeCondition;
  createdAt: string;
  engineVersion: string;
  userAgent: string;
  a?: MeTest;
  b?: MeExposure;
  c?: MeTest;
  /** A 전: 앱 도감·상징 평가 결과를 본 적 있는지 / C 전: 체험 뒤 도감·앱을 찾아봤는지 */
  priorA?: MePrior;
  priorC?: MePrior;
}

export const meItems = (): SeItem[] => seItems();
const ITEM_IDS = new Set(meItems().map((i) => i.id));
const VALID_GUESS = new Set(GUESS_OPTIONS.map((g) => g.id));

export function newParticipant(condition: MeCondition, seed: number, now: Date, userAgent: string, origin: MeOrigin = 'human'): MeParticipant {
  const code = `M${((seed >>> 0) % 46656).toString(36).toUpperCase().padStart(3, '0')}`;
  return {
    schema: ME_SCHEMA, id: `me-${now.getTime().toString(36)}-${(seed >>> 0).toString(36)}`, code, origin, condition,
    createdAt: now.toISOString(), engineVersion: ENGINE_VERSION, userAgent: userAgent.slice(0, 200),
  };
}

/** 다음 참여자 조건: 완료·진행 중 참여자 수가 가장 적은 조건(같으면 정해진 순서). 조건끼리 인원을 맞춘다 */
export function nextCondition(ps: MeParticipant[], allowed: readonly MeCondition[] = CONDITIONS): MeCondition {
  const n = (c: MeCondition) => ps.filter((p) => p.origin === 'human' && p.condition === c).length;
  return [...allowed].sort((x, y) => n(x) - n(y) || allowed.indexOf(x) - allowed.indexOf(y))[0]!;
}

export function newTest(seed: number, now: Date): MeTest {
  return { seed: seed >>> 0, order: shuffleItems(meItems(), seed), answers: [], startedAt: now.toISOString() };
}

export type MeStage = 'a' | 'b' | 'wait' | 'c' | 'done';
/** 참여자가 지금 해야 할 단계. B가 끝났어도 경과 시간이 짧으면 'wait' */
export function stageOf(p: MeParticipant, now: number): MeStage {
  if (!p.a?.completedAt) return 'a';
  if (!p.b?.completedAt) return 'b';
  if (!p.c?.completedAt) return hoursSinceExposure(p, now) < ME_CRITERIA.minHours && !p.c ? 'wait' : 'c';
  return 'done';
}

export function hoursSinceExposure(p: MeParticipant, now: number): number {
  return p.b?.completedAt ? (now - Date.parse(p.b.completedAt)) / 3_600_000 : 0;
}
/** B 끝 → C 시작 경과 시간(기록용) */
export function elapsedHours(p: MeParticipant): number | null {
  return p.b?.completedAt && p.c?.startedAt ? (Date.parse(p.c.startedAt) - Date.parse(p.b.completedAt)) / 3_600_000 : null;
}

/** B 노출 기록에서 상징별 노출 횟수(체험으로 생긴 수 + 도감을 봤으면 모든 상징 +도감 연 횟수) */
export function exposureOf(p: MeParticipant): Record<string, { experienced: number; guide: number }> {
  const out: Record<string, { experienced: number; guide: number }> = {};
  for (const e of EMOTIONS) out[e.symbol] = { experienced: 0, guide: p.b?.guideOpens ?? 0 };
  for (const r of p.b?.records ?? []) if (out[r.symbolId]) out[r.symbolId]!.experienced += 1;
  return out;
}

export function meProblems(x: unknown): string[] {
  const p = x as Partial<MeParticipant>;
  const errs: string[] = [];
  if (!p || typeof p !== 'object') return ['참여자 기록이 아니에요'];
  if (p.schema !== ME_SCHEMA) errs.push('형식(schema)이 달라요');
  if (typeof p.id !== 'string' || !p.id) errs.push('id가 없어요');
  if (p.origin !== 'human' && p.origin !== 'synthetic-test') errs.push('출처(origin)가 틀려요');
  if (!CONDITIONS.includes(p.condition as MeCondition)) errs.push('조건이 틀려요');
  for (const [k, t] of [['A', p.a], ['C', p.c]] as const) {
    if (!t) continue;
    if (!Array.isArray(t.order) || t.order.length !== ITEM_IDS.size || new Set(t.order).size !== ITEM_IDS.size || t.order.some((o) => !ITEM_IDS.has(o))) errs.push(`${k} 문항 순서가 틀려요`);
    const seen = new Set<string>();
    for (const a of t.answers ?? []) {
      if (!ITEM_IDS.has(a?.itemId) || seen.has(a.itemId)) errs.push(`${k} 답 문항이 틀려요`);
      seen.add(a?.itemId);
      if (!VALID_GUESS.has(a?.guess)) errs.push(`${k} 답 형식이 틀려요`);
      if (![1, 2, 3].includes(a?.confidence)) errs.push(`${k} 확신 정도가 틀려요`);
      if (k === 'C' && a.recall !== undefined && !RECALL_OPTIONS.some((r) => r.id === a.recall)) errs.push('C 회상 답이 틀려요');
    }
  }
  for (const k of ['priorA', 'priorC'] as const) if (p[k] !== undefined && !['no', 'yes', 'unsure'].includes(p[k] as string)) errs.push('사전 노출 답이 틀려요');
  if (p.c && !p.b?.completedAt) errs.push('체험(B) 없이 C를 했어요');
  if (p.b && !p.a?.completedAt) errs.push('첫인상(A) 없이 B를 했어요');
  return [...new Set(errs)];
}

export function parseParticipants(text: string): MeParticipant[] {
  const t = text.trim();
  if (!t) return [];
  const data = JSON.parse(t) as unknown;
  const list = Array.isArray(data) ? data : [data];
  for (const [i, x] of list.entries()) {
    const pr = meProblems(x);
    if (pr.length) throw new Error(`${i + 1}번째 참여자: ${pr.join(', ')}`);
  }
  return list as MeParticipant[];
}

export function meExclusion(p: MeParticipant): string | null {
  if (meProblems(p).length) return '형식·일관성 오류';
  if (p.origin !== 'human') return '테스트용(화면 시험)';
  if (!p.a?.completedAt || !p.b?.completedAt || !p.c?.completedAt) return '세 단계를 다 하지 않음';
  if (p.a.answers.length < p.a.order.length || p.c.answers.length < p.c.order.length) return '답이 모자람';
  if (p.a.blindBreach || p.c.blindBreach) return '평가 도중 정답 화면이 열려 있었음';
  return null;
}

export function meCounted(ps: MeParticipant[]): MeParticipant[] {
  const seen = new Set<string>();
  return ps.filter((p) => {
    if (meExclusion(p) || seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

/** 정답 노출이 의심되는 기록(평가 전 도감·결과를 봤거나, 체험 뒤 찾아봤다고 답함). 진행자 확인용 */
export function priorExposure(p: MeParticipant): string | null {
  const why: string[] = [];
  if (p.priorA === 'yes') why.push('평가 전에 도감·결과를 봄');
  if (p.priorC === 'yes') why.push('체험 뒤 도감·앱을 찾아봄');
  return why.length ? why.join(', ') : null;
}

/** 체험 장면을 본 시간 요약(빠른 통과 구분용) */
export function viewStats(p: MeParticipant): { n: number; meanMs: number; quick: number } {
  const xs = (p.b?.records ?? []).map((r) => r.viewMs).filter((x): x is number => typeof x === 'number');
  return { n: xs.length, meanMs: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0, quick: xs.filter((x) => x < ME_CRITERIA.noticeMinMs).length };
}

const truthOf = new Map(meItems().map((i) => [i.id, i.truth]));
const isSymbol = (itemId: string) => !!truthOf.get(itemId);

export interface MeTestStats { n: number; correct: number; unsure: number; confidence: number; controlEmotion: number; controlN: number }
export function testStats(t: MeTest | undefined): MeTestStats {
  const s: MeTestStats = { n: 0, correct: 0, unsure: 0, confidence: 0, controlEmotion: 0, controlN: 0 };
  for (const a of t?.answers ?? []) {
    const truth = truthOf.get(a.itemId);
    if (truth) {
      s.n += 1;
      if (a.guess === truth) s.correct += 1;
      if (a.guess === UNSURE) s.unsure += 1;
      s.confidence += a.confidence;
    } else {
      s.controlN += 1;
      if (a.guess !== UNSURE) s.controlEmotion += 1;
    }
  }
  return s;
}

const rate = (a: number, b: number) => (b ? a / b : 0);

export interface MeGroupSummary {
  condition: MeCondition;
  participants: number;
  aAccuracy: number;
  cAccuracy: number;
  aUnsure: number;
  cUnsure: number;
  /** 상징 문항 평균 확신(1~3) */
  aConfidence: number;
  cConfidence: number;
  /** C에서 대조 그림에 감정을 고른 비율 */
  cControlEmotion: number;
  /** C 회상 분포(상징 문항만) */
  recall: Record<MeRecall, number>;
  meanElapsedHours: number | null;
}

export function groupSummary(ps: MeParticipant[]): MeGroupSummary[] {
  const counted = meCounted(ps);
  return CONDITIONS.map((condition) => {
    const g = counted.filter((p) => p.condition === condition);
    const A = g.map((p) => testStats(p.a));
    const C = g.map((p) => testStats(p.c));
    const sum = (xs: MeTestStats[], k: keyof MeTestStats) => xs.reduce((a, x) => a + x[k], 0);
    const recall: Record<MeRecall, number> = { clear: 0, vague: 0, none: 0, 'not-seen': 0 };
    for (const p of g) for (const a of p.c!.answers) if (isSymbol(a.itemId) && a.recall) recall[a.recall] += 1;
    const hs = g.map(elapsedHours).filter((h): h is number => h !== null);
    return {
      condition, participants: g.length,
      aAccuracy: rate(sum(A, 'correct'), sum(A, 'n')), cAccuracy: rate(sum(C, 'correct'), sum(C, 'n')),
      aUnsure: rate(sum(A, 'unsure'), sum(A, 'n')), cUnsure: rate(sum(C, 'unsure'), sum(C, 'n')),
      aConfidence: rate(sum(A, 'confidence'), sum(A, 'n')), cConfidence: rate(sum(C, 'confidence'), sum(C, 'n')),
      cControlEmotion: rate(sum(C, 'controlEmotion'), sum(C, 'controlN')),
      recall, meanElapsedHours: hs.length ? hs.reduce((a, b) => a + b, 0) / hs.length : null,
    };
  });
}

/** 상징 단위: 체험으로 직접 생겼던 상징 vs 아니었던 상징의 C 정답률·회상(같은 사람 안에서 비교) */
export interface MeExposureSplit { label: string; n: number; correct: number; clearOrVague: number }
export function exposureSplit(ps: MeParticipant[]): MeExposureSplit[] {
  const rows = { exp: { label: '체험으로 생겼던 상징', n: 0, correct: 0, clearOrVague: 0 }, no: { label: '체험에서 안 생긴 상징', n: 0, correct: 0, clearOrVague: 0 } };
  for (const p of meCounted(ps)) {
    if (p.condition !== 'experience' && p.condition !== 'both') continue;
    const ex = exposureOf(p);
    for (const a of p.c!.answers) {
      const truth = truthOf.get(a.itemId);
      if (!truth) continue;
      const r = ex[a.itemId]!.experienced > 0 ? rows.exp : rows.no;
      r.n += 1;
      if (a.guess === truth) r.correct += 1;
      if (a.recall === 'clear' || a.recall === 'vague') r.clearOrVague += 1;
    }
  }
  return [rows.exp, rows.no];
}

/** C에서 반복된 혼동(정답 → 고른 감정), 2번 이상만 */
export function confusions(ps: MeParticipant[], phase: 'a' | 'c' = 'c'): Array<{ itemId: string; truth: string; guess: string; n: number }> {
  const m = new Map<string, number>();
  for (const p of meCounted(ps)) for (const a of p[phase]!.answers) {
    const truth = truthOf.get(a.itemId);
    if (!truth || a.guess === truth || a.guess === UNSURE) continue;
    const k = `${a.itemId}|${truth}|${a.guess}`;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].filter(([, n]) => n >= 2).map(([k, n]) => {
    const [itemId, truth, guess] = k.split('|') as [string, string, string];
    return { itemId, truth, guess, n };
  }).sort((x, y) => y.n - x.n || x.itemId.localeCompare(y.itemId));
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function formatMeReport(ps: MeParticipant[], nameOf: (itemId: string) => string, emotionName: (id: string) => string): string {
  const counted = meCounted(ps);
  const groups = groupSummary(ps).filter((g) => g.participants > 0);
  const L: string[] = [];
  L.push(`# 감정 상징 기억 평가(24시간) — 엔진 ${ENGINE_VERSION}`);
  L.push('');
  L.push(`세 단계를 마친 유효한 참여자 기록 ${counted.length}건, 판정에서 뺀 기록 ${ps.length - counted.length}건. ${counted.length < ME_CRITERIA.minParticipants ? `**${ME_CRITERIA.minParticipants}건 미만이라 보류.** ` : ''}탐색용 결과예요.`);
  L.push('');
  L.push('> 집계 단위는 참여자 기록(코드)이에요. 같은 사람이 다른 코드로 다시 했는지는 자동으로 알 수 없어서 진행자가 확인해요.');
  L.push('> 조건별 인원이 1~2명이면 차이를 효과로 판단할 수 없어요. 반복되는 혼동과 화면 이해 문제를 찾는 데만 써요.');
  L.push('> 회상은 스스로 느낀 떠오름 정도예요. 실제 기록 내용을 맞게 떠올렸는지 확인한 값이 아니에요.');
  L.push('');
  L.push('> 정답률이 올라도 같은 그림을 두 번 본 효과일 수 있어요. 노출 없음(대조) 조건과 비교해서 봐요. 회상은 정답률과 따로 봐요.');
  const off = counted.filter((p) => { const h = elapsedHours(p); return h !== null && (h < ME_CRITERIA.idealHours[0] || h > ME_CRITERIA.idealHours[1]); });
  const contaminated = counted.filter((p) => priorExposure(p));
  if (contaminated.length) L.push(`> ⚠️ 정답 노출이 의심되는 기록 ${contaminated.length}건(${contaminated.map((p) => `${p.code}: ${priorExposure(p)}`).join('; ')}). 빼고도 결론이 같은지 확인해 주세요.`);
  const quick = counted.filter((p) => viewStats(p).quick > 0);
  if (quick.length) L.push(`> 체험 장면을 ${ME_CRITERIA.noticeMinMs / 1000}초 미만 본 기록이 있는 참여자 ${quick.length}명.`);
  if (off.length) L.push(`> 경과 시간이 ${ME_CRITERIA.idealHours[0]}~${ME_CRITERIA.idealHours[1]}시간을 벗어난 참여자 ${off.length}명(${off.map((p) => `${p.code} ${elapsedHours(p)!.toFixed(1)}h`).join(', ')}).`);
  L.push('');
  L.push('## 정답률 (상징 12종)');
  L.push('| 조건 | 인원 | 첫인상 A | 다음 날 C | 모르겠어요 A→C | 확신 A→C | C 대조에 감정 | 평균 경과 |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const g of groups) L.push(`| ${CONDITION_LABEL[g.condition]} | ${g.participants} | ${pct(g.aAccuracy)} | ${pct(g.cAccuracy)} | ${pct(g.aUnsure)}→${pct(g.cUnsure)} | ${g.aConfidence.toFixed(1)}→${g.cConfidence.toFixed(1)} | ${pct(g.cControlEmotion)} | ${g.meanElapsedHours === null ? '—' : `${g.meanElapsedHours.toFixed(1)}h`} |`);
  L.push('');
  L.push('## 회상 (다음 날, 상징 12종) — 정답률과 별도');
  L.push('| 조건 | 또렷 | 어렴풋 | 안 떠오름 | 못 본 듯 |');
  L.push('|---|---|---|---|---|');
  for (const g of groups) {
    const t = Object.values(g.recall).reduce((a, b) => a + b, 0);
    L.push(`| ${CONDITION_LABEL[g.condition]} | ${(['clear', 'vague', 'none', 'not-seen'] as MeRecall[]).map((k) => `${g.recall[k]} (${pct(rate(g.recall[k], t))})`).join(' | ')} |`);
  }
  L.push('');
  L.push('## 체험으로 생겼던 상징 vs 아니었던 상징 (체험·체험+도감 조건, C)');
  for (const r of exposureSplit(ps)) L.push(`- ${r.label}: 정답 ${r.correct}/${r.n}${r.n ? ` (${pct(rate(r.correct, r.n))})` : ''}, 또렷·어렴풋 회상 ${r.clearOrVague}/${r.n}`);
  const cf = confusions(ps, 'c');
  L.push('');
  L.push('## 다음 날에도 반복된 혼동 (2번 이상)');
  if (!cf.length) L.push('- 없음');
  for (const x of cf) L.push(`- ${nameOf(x.itemId)}(${emotionName(x.truth)}) → ${emotionName(x.guess)} ×${x.n}`);
  L.push('');
  L.push('## 참여자');
  L.push('| 코드 | 조건 | A 정답 | C 정답 | 경과 | 체험 기록(평균 본 시간) | 도감 열람 | 사전 노출 |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const p of counted) {
    const a = testStats(p.a); const c = testStats(p.c); const h = elapsedHours(p);
    const v = viewStats(p);
    L.push(`| ${p.code} | ${CONDITION_LABEL[p.condition]} | ${a.correct}/${a.n} | ${c.correct}/${c.n} | ${h === null ? '—' : `${h.toFixed(1)}h`} | ${p.b!.records.length}${v.n ? ` (${(v.meanMs / 1000).toFixed(1)}초)` : ''} | ${p.b!.guideOpens}회 ${Math.round(p.b!.guideMs / 1000)}초 | ${priorExposure(p) ?? '—'} |`);
  }
  return L.join('\n');
}
