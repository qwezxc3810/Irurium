import { CAPS, EFFECT_CAP, GROWTH, SLOTS } from '../engine/config';
import { themeOf } from '../engine/catalog';
import { analyzeMood, analyzeNote, BASE_CHIPS, CHIP_VECTORS, MOOD_WEIGHTS } from '../engine/mood';
import type { TankState } from '../engine/types';
import { compositionDistance, fmt, layoutDistance, lightDistance, mean, moodCompositionDistance, pairwise } from './metrics';
import { finalState, frameAt, type SuiteResult } from './runner';
import { H3_SWITCH_DAY } from './samples';
import type { RunResult } from './types';

/**
 * 가설 H1~H11 판정(v0.3.1 수정 노트 6.1).
 * - 통과(자동 기준): 시뮬레이터로 잴 수 있는 기준을 넘었다. 다음 단계(지인 테스트)로 갈 수 있다는 뜻이지 확정이 아니다.
 * - 조정 필요: 자동 기준을 못 넘었거나, 문서의 초깃값과 구현이 다르다.
 * - 보류(사람 평가 필요): 실제 사용자 평가·실기기 측정이 있어야 판단할 수 있다. 자동 측정이 좋아도 통과로 올리지 않는다.
 */

export type Verdict = 'pass' | 'adjust' | 'hold';

export const VERDICT_LABEL: Record<Verdict, string> = {
  pass: '통과(자동 기준)',
  adjust: '조정 필요',
  hold: '보류(사람 평가 필요)',
};

export interface Measure {
  label: string;
  value: string;
  /** 이 측정이 기준을 넘었는지. 참고용이면 null */
  ok: boolean | null;
}

export interface HypothesisResult {
  id: string;
  title: string;
  initial: string;
  question: string;
  criterion: string;
  measures: Measure[];
  needsHuman: boolean;
  /** 사람이 해야 하는 평가 */
  humanPart: string | null;
  /** 자동 기준만 본 결과(자동 기준이 없으면 null) */
  autoVerdict: Verdict | null;
  verdict: Verdict;
  reason: string;
  scenarios: string[];
}

const SHIFT_TEXT = '마음의 흐름이 바뀌어';

function runs(s: SuiteResult, id: string): RunResult[] {
  const r = s.runs[id];
  if (!r) throw new Error(`시나리오 없음: ${id}`);
  return r;
}

const growthCount = (r: RunResult) => r.events.filter((e) => e.level === 'growth').length;
const specials = (r: RunResult) => r.events.filter((e) => e.level === 'special');
const shiftCount = (r: RunResult) => r.events.filter((e) => e.level === 'special' && e.text.includes(SHIFT_TEXT)).length;

/** 사람 평가가 필요한 가설: 자동 측정이 기준을 못 넘으면 조정 필요, 넘었거나 자동 기준이 없으면 보류 */
function humanVerdict(auto: Verdict | null): Verdict {
  return auto === 'adjust' ? 'adjust' : 'hold';
}

export function evaluateHypotheses(s: SuiteResult): HypothesisResult[] {
  return [h1(), h2(s), h3(s), h4(s), h5(s), h6(s), h7(s), h8(s), h9(s), h10(s), h11(s)];
}

// H1 감정 합성
function h1(): HypothesisResult {
  const words: Record<string, string> = { 따뜻함: '따뜻', 설렘: '설레', 유쾌함: '재밌', 차분함: '차분', 그리움: '그립', 쓸쓸함: '쓸쓸', 답답함: '답답', 막막함: '막막' };
  let kept = 0;
  let reflected = 0;
  let total = 0;
  for (const chip of BASE_CHIPS) {
    const cv = CHIP_VECTORS[chip]!;
    for (const other of BASE_CHIPS) {
      if (other === chip) continue;
      const m = analyzeMood([chip], `오늘은 ${words[other]}`);
      total++;
      if (Math.sign(m.temp) === Math.sign(cv.temp)) kept++;
      if (Math.hypot(m.temp - cv.temp, m.energy - cv.energy) >= 0.05) reflected++;
    }
  }
  return {
    id: 'H1', title: '감정 합성', initial: `칩 ${MOOD_WEIGHTS.chips} + 한마디 ${MOOD_WEIGHTS.note}`,
    question: '한마디가 칩을 뒤집거나 무시되지 않는지', criterion: '사람이 라벨링한 기록 100개와 엔진 결과의 방향(온도 부호) 일치 80% 이상',
    measures: [
      { label: '[참고] 칩과 반대 감정의 한마디를 붙였을 때 칩 방향 유지', value: `${kept}/${total} (${Math.round((kept / total) * 100)}%)`, ok: null },
      { label: '[참고] 한마디가 결과를 0.05 이상 움직인 비율(무시되지 않음)', value: `${reflected}/${total}`, ok: null },
      { label: '사람 라벨 100개와의 일치율', value: '아직 없음', ok: null },
    ],
    needsHuman: true, humanPart: '지인 기록 100개를 사람이 감정 라벨링해서 엔진 결과와 비교',
    autoVerdict: null, verdict: 'hold',
    reason: '기준이 "사람이 라벨링한 기록"과의 일치율이라 샘플만으로는 판단할 수 없어요. 칩과 한마디가 부딪칠 때 칩 방향이 유지되고 한마디도 반영되는 것만 참고로 확인했어요.',
    scenarios: [],
  };
}

// H2 한마디 신뢰도
function h2(s: SuiteResult): HypothesisResult {
  const notes = s.scenarios.flatMap((sc) => sc.tanks.flatMap((t) => t.entries.map((e) => e.note))).filter((n) => n.trim());
  const uniq = [...new Set(notes)];
  const used = uniq.filter((n) => analyzeNote(n).confidence >= MOOD_WEIGHTS.minNoteConfidence);
  return {
    id: 'H2', title: '한마디 신뢰도', initial: `신뢰도 ${MOOD_WEIGHTS.minNoteConfidence} 미만이면 무시`,
    question: '엉뚱한 분석이 얼마나 나오는지', criterion: "S07 '고치기' 사용률이 기록의 15% 미만",
    measures: [
      { label: '[참고] 샘플 한마디 중 감정으로 읽힌 것', value: `${used.length}/${uniq.length}`, ok: null },
      { label: '[참고] 감정으로 읽히지 않아 무시된 한마디', value: uniq.filter((n) => !used.includes(n)).map((n) => `"${n}"`).join(', ') || '없음', ok: null },
      { label: "실제 사용자의 '고치기' 사용률", value: '아직 없음', ok: null },
    ],
    needsHuman: true, humanPart: "지인 테스트에서 S07 '고치기' 사용률을 잰다",
    autoVerdict: null, verdict: 'hold',
    reason: "기준이 실제 사용자의 '고치기' 사용률이라 샘플로는 측정할 수 없어요.",
    scenarios: ['case-C'],
  };
}

// H3 조명 이동
function h3(s: SuiteResult): HypothesisResult {
  const r = runs(s, 'exp-h3')[0]!;
  const before = frameAt(r, H3_SWITCH_DAY - 1).state.light;
  const rows: string[] = [];
  let small: number | null = null;
  let flip: number | null = null;
  for (let k = 1; k <= 8; k++) {
    const f = frameAt(r, H3_SWITCH_DAY - 1 + k);
    const d = before.temp - f.state.light.temp;
    rows.push(`${k}번째 ${fmt(f.state.light.temp)}`);
    if (small === null && d >= 0.3) small = k;
    if (flip === null && f.state.light.temp < 0) flip = k;
  }
  const fF = runs(s, 'case-F')[0]!;
  const usedMax = Math.max(...fF.frames.map((f) => f.lightUsed));
  const auto: Verdict = flip !== null && flip >= 3 && flip <= 5 ? 'pass' : 'adjust';
  return {
    id: 'H3', title: '조명 이동', initial: '첫 기록 15%, 추가 10%, 하루 최대 30%',
    question: '분위기가 너무 느리거나 튀지 않는지', criterion: '감정을 바꾼 뒤 3~5번째 기록에서 눈에 띄게 바뀜',
    measures: [
      { label: `바꾸기 전 물빛 온도(10일 따뜻함)`, value: fmt(before.temp), ok: null },
      { label: '바꾼 뒤 물빛 온도', value: rows.join(' → '), ok: null },
      { label: '[가정 1] 온도가 0.3 이상 움직인 기록', value: small === null ? '8번 안에 없음' : `${small}번째`, ok: null },
      { label: '[가정 2] 따뜻한 쪽에서 푸른 쪽으로 뒤집힌 기록(자동 기준으로 사용)', value: flip === null ? '8번 안에 없음' : `${flip}번째`, ok: auto === 'pass' },
      { label: '사례 F: 하루 조명 이동 최대', value: `${Math.round(usedMax * 100)}%`, ok: usedMax <= 0.3 + 1e-9 },
    ],
    needsHuman: true, humanPart: '"눈에 띈다"는 체감 기준. H3 실험 갤러리(10→20일)를 보고 몇 번째에서 달라 보이는지 직접 판단',
    autoVerdict: auto, verdict: humanVerdict(auto),
    reason: `"눈에 띈다"의 기준을 어떻게 잡느냐에 따라 ${small ?? '-'}번째(조금 달라짐) ~ ${flip ?? '-'}번째(분위기 뒤집힘)로 갈려요. 뒤집힘 기준으로는 3~5번째 안이지만, 체감은 사람이 봐야 해서 보류로 둡니다. 하루 30% 상한은 지켜졌어요.`,
    scenarios: ['exp-h3', 'case-F'],
  };
}

// H4 성장점
function h4(s: SuiteResult): HypothesisResult {
  const c = runs(s, 'case-C')[0]!;
  const n = growthCount(c);
  const ok = n >= 7 && n <= 10;
  const avg = (id: string) => mean(runs(s, id).map(growthCount));
  const e = runs(s, 'case-E')[0]!;
  const freq = runs(s, 'cmp-frequency').map((r) => `${r.label} ${growthCount(r)}`).join(', ');
  return {
    id: 'H4', title: '성장점', initial: `첫 기록 ${GROWTH.firstEntryPoint} + 목표 달성 ${GROWTH.dailyTargetBonus}, ${GROWTH.threshold}점마다 성장`,
    question: '14일에 성장이 너무 적거나 많지 않은지', criterion: '사례 C(14일 독서)의 성장 횟수 7~10회',
    measures: [
      { label: '사례 C 성장 횟수', value: `${n}회`, ok },
      { label: '[참고] 매일 기록한 사례 A·B 평균', value: `${fmt(avg('case-A'), 1)}회 · ${fmt(avg('case-B'), 1)}회`, ok: null },
      { label: '[참고] 감정 없이 쪽수만(E)', value: `${growthCount(e)}회`, ok: null },
      { label: '[참고] 빈도별(같은 140쪽)', value: freq, ok: null },
    ],
    needsHuman: false, humanPart: null,
    autoVerdict: ok ? 'pass' : 'adjust', verdict: ok ? 'pass' : 'adjust',
    reason: ok
      ? `사례 C는 ${n}회로 기준 안이에요. 다만 14일을 하루도 빠짐없이 기록하면 ${fmt(avg('case-A'), 0)}회(특별 변화 3회를 더하면 매일 주요 변화)라 기준을 넘어요. 기준을 "사례 C" 기준으로 둘지, 매일 기록자 기준으로 둘지 정해야 해요.`
      : `사례 C가 ${n}회로 7~10회를 벗어났어요.`,
    scenarios: ['case-C', 'case-A', 'case-B', 'case-E', 'cmp-frequency'],
  };
}

// H5 특별 변화
function h5(s: SuiteResult): HypothesisResult {
  const c = runs(s, 'case-C')[0]!;
  const cs = specials(c).length;
  const long = runs(s, 'long-steady')[0]!;
  const windows = [[101, 130], [131, 160], [161, 190]] as const;
  const counts = windows.map(([a, b]) => specials(long).filter((e) => e.day >= a && e.day <= b).length);
  const longOk = counts.every((n) => n >= 1);
  const ok14 = cs === 3;
  const sp = runs(s, 'long-sparse')[0]!;
  const auto: Verdict = ok14 && longOk ? 'pass' : 'adjust';
  return {
    id: 'H5', title: '특별 변화', initial: '진행률 25·50·75%, 누적 10·20·30·50·75·100·150·200·365회 + 감정 전환',
    question: '장기 사용에서 기대감이 유지되는지', criterion: '14일에 3회, 100일 이후에도 한 달(30일)에 1회 이상',
    measures: [
      { label: '사례 C 14일 특별 변화', value: `${cs}회 (${specials(c).map((e) => `${e.day}일`).join(', ')})`, ok: ok14 },
      { label: '꾸준형 200일: 101~130 / 131~160 / 161~190일', value: counts.map((n) => `${n}회`).join(' / '), ok: longOk },
      { label: '[참고] 꾸준형 특별 변화 날짜', value: specials(long).map((e) => e.day).join(', '), ok: null },
      { label: '[참고] 띄엄형 특별 변화 날짜', value: specials(sp).map((e) => e.day).join(', ') || '없음', ok: null },
    ],
    needsHuman: false, humanPart: null,
    autoVerdict: auto, verdict: auto,
    reason: longOk
      ? '14일과 100일 이후 모두 기준을 넘었어요.'
      : `100일 이후 ${windows.map(([a, b], i) => (counts[i] === 0 ? `${a}~${b}일` : '')).filter(Boolean).join(', ')}에 특별 변화가 없어요. 누적 횟수 마일스톤(100 → 150 → 200회) 간격이 기록 50회라, 기록률 85%면 두 달 가까이 비어요. 100회 이후 마일스톤을 더 촘촘하게(예: 25회마다) 하거나 계절·기간 마일스톤을 더하는 조정이 필요해요.`,
    scenarios: ['case-C', 'long-steady', 'long-sparse'],
  };
}

// H6 감정 전환
function h6(s: SuiteResult): HypothesisResult {
  const similar = runs(s, 'case-A').map(shiftCount);
  const single = runs(s, 'case-B').map(shiftCount);
  const changed = [runs(s, 'case-D')[0]!, runs(s, 'long-steady')[0]!, runs(s, 'exp-h3')[0]!];
  const changedCounts = changed.map(shiftCount);
  const okSimilar = similar.every((n) => n === 0) && single.every((n) => n === 0);
  const okChanged = changedCounts.every((n) => n >= 1);
  const auto: Verdict = okSimilar && okChanged ? 'pass' : 'adjust';
  return {
    id: 'H6', title: '감정 전환', initial: '최근 5기록(일) 평균과 이전 5기록 차이 0.6 이상',
    question: '진짜 변화만 잡는지', criterion: '비슷한 감정 사용자 0회, 흐름이 바뀐 사용자 1회 이상',
    measures: [
      { label: '비슷한 감정 5명(A)', value: similar.map((n) => `${n}회`).join(', '), ok: similar.every((n) => n === 0) },
      { label: '한 감정만 5명(B)', value: single.map((n) => `${n}회`).join(', '), ok: single.every((n) => n === 0) },
      { label: '흐름이 바뀐 사용자(D · 꾸준형 200일 · H3 실험)', value: changedCounts.map((n) => `${n}회`).join(', '), ok: okChanged },
    ],
    needsHuman: false, humanPart: null,
    autoVerdict: auto, verdict: auto,
    reason: auto === 'pass' ? '비슷한 감정에서는 한 번도 나오지 않고, 흐름이 바뀐 사용자에게는 나왔어요.' : '전환이 잘못 잡히거나 놓친 사례가 있어요.',
    scenarios: ['case-A', 'case-B', 'case-D', 'long-steady', 'exp-h3'],
  };
}

// H7 요소 점수
export interface H7Detail { within: number; extreme: number; layoutA: number; seedOnly: number }

export function h7Detail(s: SuiteResult): H7Detail {
  const A = runs(s, 'case-A').map(finalState);
  const B = runs(s, 'case-B').map(finalState);
  const seeds = runs(s, 'cmp-seed').map(finalState);
  return {
    within: mean(pairwise(A, moodCompositionDistance)),
    extreme: mean(pairwise(B, moodCompositionDistance)),
    layoutA: mean(pairwise(A, layoutDistance)),
    seedOnly: mean(pairwise(seeds, moodCompositionDistance)),
  };
}

function h7(s: SuiteResult): HypothesisResult {
  const d = h7Detail(s);
  const ok = d.within < d.extreme * 0.5;
  return {
    id: 'H7', title: '요소 점수', initial: '감정 0.6 + 이력 0.25 + 시드 0.15',
    question: '감정이 결과를 정하고 시드는 개성만 더하는지', criterion: '비슷한 그룹(A) 안 차이 < 극단 그룹(B) 안 차이의 절반',
    measures: [
      { label: 'A 안 평균 차이(물빛+구성)', value: fmt(d.within, 3), ok: null },
      { label: 'B 안 평균 차이(물빛+구성)', value: fmt(d.extreme, 3), ok: null },
      { label: 'A ÷ B (0.5 미만이면 통과)', value: fmt(d.within / d.extreme, 2), ok },
      { label: '[참고] A 안 배치 차이(시드가 만드는 개성, 1에 가까울수록 다름)', value: fmt(d.layoutA, 2), ok: null },
      { label: '[참고] 같은 기록·시드만 다름(비교 실험) 물빛+구성 차이', value: fmt(d.seedOnly, 3), ok: null },
    ],
    needsHuman: false, humanPart: '사례 A의 "내 것" 느낌과 사례 B 짝짓기(4/5 이상)는 지인 테스트에서 확인',
    autoVerdict: ok ? 'pass' : 'adjust', verdict: ok ? 'pass' : 'adjust',
    reason: ok
      ? `비슷한 감정끼리는 분위기·구성 차이가 ${fmt(d.within, 3)}, 극단 감정끼리는 ${fmt(d.extreme, 3)}로 절반 기준을 넘었어요. 배치는 시드마다 ${fmt(d.layoutA, 2)}만큼 달라 개성이 남아요.`
      : `비슷한 그룹 차이(${fmt(d.within, 3)})가 극단 그룹(${fmt(d.extreme, 3)})의 절반 이상이에요. 시드 비중이 크거나 감정이 구성에 덜 반영돼요.`,
    scenarios: ['case-A', 'case-B', 'cmp-seed', 'cmp-emotion'],
  };
}

// H8 개수 상한
function h8(s: SuiteResult): HypothesisResult {
  const all = Object.values(s.runs).flat();
  const max = { fish: 0, plant: 0, rock: 0, symbol: 0, total: 0, effects: 0 };
  for (const r of all) for (const f of r.frames) {
    const m = f.metrics;
    max.fish = Math.max(max.fish, m.fish); max.plant = Math.max(max.plant, m.plant); max.rock = Math.max(max.rock, m.rock);
    max.symbol = Math.max(max.symbol, m.symbol); max.total = Math.max(max.total, m.total); max.effects = Math.max(max.effects, m.effects.length);
  }
  const capsOk = max.fish <= CAPS.fish && max.plant <= CAPS.plant && max.rock <= CAPS.rock && max.symbol <= CAPS.symbol && max.effects <= EFFECT_CAP;
  return {
    id: 'H8', title: '개수 상한', initial: `물고기 ${CAPS.fish}, 수초 ${CAPS.plant}, 수석 ${CAPS.rock}, 상징 ${CAPS.symbol}, 효과 ${EFFECT_CAP} (작은 생물은 아직 없음)`,
    question: '복잡해지거나 느려지지 않는지', criterion: '저사양 폰 30fps, "복잡하다" 응답 20% 미만',
    measures: [
      { label: '전체 샘플에서 나온 최대 개수', value: `물고기 ${max.fish} · 수초 ${max.plant} · 수석 ${max.rock} · 상징 ${max.symbol} · 효과 ${max.effects} (합계 ${max.total})`, ok: capsOk },
      { label: '저사양 폰 fps', value: '실기기 측정 필요(검증실 "움직임 보기"에 화면 fps 표시)', ok: null },
      { label: '"복잡하다" 응답', value: '아직 없음', ok: null },
    ],
    needsHuman: true, humanPart: '저사양 안드로이드 실기기에서 가득 찬 어항 fps 측정 + 지인 인터뷰',
    autoVerdict: capsOk ? null : 'adjust', verdict: capsOk ? 'hold' : 'adjust',
    reason: capsOk
      ? `상한은 모든 샘플에서 지켜졌어요(200일에도 합계 ${max.total}개, 상한 32개). 기준이 실기기 fps와 인터뷰라 보류예요.`
      : '상한을 넘은 어항이 있어요.',
    scenarios: ['long-steady', 'case-D'],
  };
}

// H9 반복 방지
function h9(s: SuiteResult): HypothesisResult {
  const ids = ['case-A', 'case-B', 'case-C', 'case-D', 'case-F', 'long-steady', 'long-sparse'];
  let pairs = 0;
  let same = 0;
  let newPairs = 0;
  let newSame = 0;
  for (const id of ids) for (const r of runs(s, id)) {
    const growth = r.events.filter((e) => e.level === 'growth' && e.kind);
    for (let i = 1; i < growth.length; i++) { pairs++; if (growth[i]!.kind === growth[i - 1]!.kind) same++; }
    const placed = growth.filter((e) => e.isNew);
    for (let i = 1; i < placed.length; i++) { newPairs++; if (placed[i]!.kind === placed[i - 1]!.kind) newSame++; }
  }
  const ratio = pairs ? same / pairs : 0;
  const ratioOk = ratio < 0.2;
  const maxPerEl = new Map<string, number>();
  for (const r of Object.values(s.runs).flat()) for (const f of r.frames) {
    const m = new Map<string, number>();
    for (const o of f.state.objects) m.set(o.el, (m.get(o.el) ?? 0) + 1);
    for (const [k, v] of m) maxPerEl.set(k, Math.max(maxPerEl.get(k) ?? 0, v));
  }
  const over = [...maxPerEl].filter(([, v]) => v > 2).sort((a, b) => b[1] - a[1]);
  const theme = themeOf('starlit-desert');
  const catalogOver = theme.elements.filter((e) => e.maxPerTank > 2).map((e) => `${e.name} ${e.maxPerTank}`);
  const auto: Verdict = ratioOk && over.length === 0 ? 'pass' : 'adjust';
  return {
    id: 'H9', title: '반복 방지', initial: '같은 요소 최대 2개, 직전과 같은 종류는 점수 ×0.7',
    question: '반복이 느껴지지 않는지', criterion: '연속 성장에서 같은 종류가 나온 비율 20% 미만',
    measures: [
      { label: '연속 성장에서 같은 종류 비율', value: `${same}/${pairs} (${Math.round(ratio * 100)}%)`, ok: ratioOk },
      { label: '[참고] 새로 놓인 것끼리만 보면', value: `${newSame}/${newPairs} (${Math.round((newPairs ? newSame / newPairs : 0) * 100)}%)`, ok: null },
      { label: '같은 요소가 3개 이상 나온 경우', value: over.length ? over.map(([k, v]) => `${theme.elements.find((e) => e.id === k)?.name ?? k} ${v}개`).join(', ') : '없음', ok: over.length === 0 },
      { label: '[구현 차이] 카탈로그의 같은 요소 최대 개수', value: catalogOver.join(', ') || '모두 2 이하', ok: catalogOver.length === 0 },
    ],
    needsHuman: false, humanPart: '반복이 "느껴지는지"는 장기 갤러리를 보고 판단',
    autoVerdict: auto, verdict: auto,
    reason: `${ratioOk ? `연속 같은 종류 비율은 ${Math.round(ratio * 100)}%로 기준 안이에요. ` : `연속 같은 종류 비율이 ${Math.round(ratio * 100)}%로 기준을 넘어요. 새로 놓는 요소에는 ×0.7 감점이 있지만(${Math.round((newPairs ? newSame / newPairs : 0) * 100)}%), 어항이 찬 뒤 "기존 요소 키우기"는 감정에 가장 잘 맞는 요소를 고르기만 해서 같은 종류가 이어져요. `}`
      + (catalogOver.length
        ? `또 현재 카탈로그는 같은 요소를 최대 ${Math.max(...theme.elements.map((e) => e.maxPerTank))}개까지 허용해서 H9 초깃값(2개)과 달라요. 별빛 사막 테마의 물고기가 3종뿐이라 2개로 막으면 물고기가 6마리에서 멈추기 때문이에요. 그래픽 작업에서 요소 종류를 늘리면서 맞추는 것을 제안해요(엔진 수치는 이번 PR에서 바꾸지 않음).`
        : ''),
    scenarios: ['case-D', 'long-steady'],
  };
}

// H10 하루 1일치 무게
export interface H10Detail { comp: number; light: number; baseline: number; trailDiff: number }

export function h10Detail(s: SuiteResult): H10Detail {
  const rs = runs(s, 'exp-h10');
  const one = rs.find((r) => r.tags.role === 'one')!;
  const five = rs.find((r) => r.tags.role === 'five')!;
  const baseStates = [one, ...rs.filter((r) => r.tags.role === 'baseline')].map(finalState);
  const base = pairwise(baseStates, compositionDistance).sort((a, b) => a - b);
  return {
    comp: compositionDistance(finalState(one), finalState(five)),
    light: lightDistance(finalState(one), finalState(five)),
    baseline: base[Math.floor(base.length / 2)] ?? 0,
    trailDiff: Math.hypot(one.trailAvg.temp - five.trailAvg.temp, one.trailAvg.energy - five.trailAvg.energy),
  };
}

function h10(s: SuiteResult): HypothesisResult {
  const d = h10Detail(s);
  const trailOk = d.trailDiff < 0.01;
  const compOk = d.comp <= d.baseline;
  const auto: Verdict = trailOk && compOk ? 'pass' : 'adjust';
  return {
    id: 'H10', title: '하루 1일치 무게', initial: '같은 날 기록들의 감정은 감정 이력에서 하루 1일치로 합침',
    question: '여러 번 기록한 날이 과대 반영되지 않는지', criterion: '같은 감정을 1번/5번 기록한 두 어항의 성장 방향 차이가 작음',
    measures: [
      { label: '감정 이력 평균 차이(1번 vs 5번)', value: fmt(d.trailDiff, 3), ok: trailOk },
      { label: '구성 차이(1번 vs 5번)', value: fmt(d.comp, 3), ok: compOk },
      { label: '기준선: 같은 기록·시드만 다를 때 구성 차이(중앙값)', value: fmt(d.baseline, 3), ok: null },
      { label: '[참고] 물빛 차이', value: `${fmt(d.light, 3)} (5번 기록한 날은 하루 상한 30%까지 움직여서 생기는 차이, H3 규칙)`, ok: null },
    ],
    needsHuman: false, humanPart: null,
    autoVerdict: auto, verdict: auto,
    reason: auto === 'pass'
      ? `감정 이력은 1번/5번이 같은 무게로 합쳐졌고, 구성 차이(${fmt(d.comp, 3)})도 시드만 바꿨을 때(${fmt(d.baseline, 3)}) 이하예요. 물빛만 조금 더 푸르러졌는데 이건 하루 조명 상한 규칙 범위 안이에요.`
      : `구성 차이(${fmt(d.comp, 3)})가 시드만 바꿨을 때(${fmt(d.baseline, 3)})보다 커요. 기록 순번이 바뀌며 무작위 값이 달라진 영향인지 확인이 필요해요.`,
    scenarios: ['exp-h10', 'case-F'],
  };
}

// H11 성장 크기
function h11(s: SuiteResult): HypothesisResult {
  let maxScale = 0;
  let overlaps = 0;
  let outside = 0;
  for (const r of Object.values(s.runs).flat()) {
    const st: TankState = finalState(r);
    for (const o of st.objects) {
      maxScale = Math.max(maxScale, o.scale);
      if (o.x < 0 || o.x > 1000 || o.y < 0 || o.y > 600) outside++;
    }
    const statics = st.objects.filter((o) => o.kind !== 'fish');
    for (let i = 0; i < statics.length; i++) for (let j = i + 1; j < statics.length; j++) {
      const a = statics[i]!;
      const b = statics[j]!;
      if (a.layer !== b.layer) continue;
      const gap = a.kind === 'rock' && b.kind === 'rock' ? SLOTS.rock.minGap : a.kind === 'symbol' || b.kind === 'symbol' ? 0 : SLOTS.plantBack.minGap;
      if (gap > 0 && a.kind === b.kind && Math.abs(a.x - b.x) < gap) overlaps++;
    }
  }
  const auto = maxScale <= GROWTH.maxScale + 1e-9 && outside === 0 && overlaps === 0;
  const d = runs(s, 'case-D')[0]!;
  const big = finalState(d).objects.filter((o) => o.scale >= 1.5).length;
  return {
    id: 'H11', title: '성장 크기', initial: `포화 뒤 성장 크기 최대 ${GROWTH.maxScale}배`,
    question: '오래 쓴 어항이 어색하지 않은지', criterion: '150일 시뮬레이션 그림 리뷰에서 거슬리는 요소 없음',
    measures: [
      { label: '전체 샘플 최대 크기', value: `${maxScale}배`, ok: maxScale <= GROWTH.maxScale + 1e-9 },
      { label: '같은 층 같은 종류 겹침 · 수조 밖', value: `${overlaps}건 · ${outside}건`, ok: overlaps === 0 && outside === 0 },
      { label: '[참고] 사례 D 150일차 1.5배 이상 요소', value: `${big}개`, ok: null },
    ],
    needsHuman: true, humanPart: '사례 D(150일)·꾸준형(200일) 갤러리를 보고 거슬리는 요소가 있는지 눈으로 판단',
    autoVerdict: auto ? null : 'adjust', verdict: auto ? 'hold' : 'adjust',
    reason: auto ? '크기 상한·겹침·수조 밖 배치는 문제없어요. 기준이 "그림 리뷰"라 보류예요. 지금 그림은 임시 SVG라 실제 그래픽으로 바꾼 뒤 다시 봐야 해요.' : '크기 상한을 넘거나 겹치는 요소가 있어요.',
    scenarios: ['case-D', 'long-steady'],
  };
}

// ───────────────────────── 요구 6: 재현성·감정 차이 ─────────────────────────

export interface DistinctnessResult {
  emotionMin: number;
  emotionMinPair: string;
  seedMax: number;
  ok: boolean;
  matrix: { labels: string[]; values: number[][] };
  extremeMin: number;
  similarMax: number;
  okAB: boolean;
}

/** 다른 감정에서 충분히 다른 어항이 나오는지: 감정만 다른 어항 쌍의 최소 차이 > 시드만 다른 어항 쌍의 최대 차이 */
export function distinctness(s: SuiteResult): DistinctnessResult {
  const emo = runs(s, 'cmp-emotion').filter((r) => r.tags.emotion !== '감정 없음');
  const states = emo.map(finalState);
  const labels = emo.map((r) => r.label);
  const values = states.map((a) => states.map((b) => moodCompositionDistance(a, b)));
  let emotionMin = Infinity;
  let emotionMinPair = '';
  for (let i = 0; i < states.length; i++) for (let j = i + 1; j < states.length; j++) {
    const v = values[i]![j]!;
    if (v < emotionMin) { emotionMin = v; emotionMinPair = `${labels[i]}–${labels[j]}`; }
  }
  const seedMax = Math.max(...pairwise(runs(s, 'cmp-seed').map(finalState), moodCompositionDistance));
  const extremeMin = Math.min(...pairwise(runs(s, 'case-B').map(finalState), moodCompositionDistance));
  const similarMax = Math.max(...pairwise(runs(s, 'case-A').map(finalState), moodCompositionDistance));
  return { emotionMin, emotionMinPair, seedMax, ok: emotionMin > seedMax, matrix: { labels, values }, extremeMin, similarMax, okAB: extremeMin > similarMax };
}
