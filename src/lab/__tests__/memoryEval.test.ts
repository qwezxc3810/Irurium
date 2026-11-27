import { describe, expect, it } from 'vitest';
import { EMOTIONS } from '../../engine/mood';
import {
  confusions, elapsedHours, exposureOf, exposureSplit, formatMeReport, groupSummary, ME_CRITERIA, meCounted, meExclusion, meItems, meProblems,
  newParticipant, newTest, nextCondition, parseParticipants, stageOf, testStats, type MeCondition, type MeParticipant, type MeRecall,
} from '../memoryEval';
import { UNSURE } from '../symbolEval';

const H = 3_600_000;
const T0 = Date.UTC(2026, 10, 27, 6);
const truth = new Map(meItems().map((i) => [i.id, i.truth]));

/** 화면 시험용 가상 참여자(사람 평가 데이터가 아님): correctIds의 상징만 맞히고 나머지는 모르겠어요 */
function fake(condition: MeCondition, seed: number, opts: { aCorrect?: string[]; cCorrect?: string[]; hours?: number; recall?: MeRecall; exp?: string[]; origin?: 'human' | 'synthetic-test' } = {}): MeParticipant {
  const p = newParticipant(condition, seed, new Date(T0), 'vitest', opts.origin ?? 'human');
  const fill = (start: number, ok: string[], withRecall: boolean) => {
    const t = newTest(seed + start, new Date(start));
    t.answers = t.order.map((id) => ({ itemId: id, guess: ok.includes(id) ? truth.get(id)! : UNSURE, confidence: ok.includes(id) ? 3 : 1, ms: 1000, ...(withRecall ? { recall: opts.recall ?? 'none' } : {}) }));
    t.completedAt = new Date(start + 60_000).toISOString();
    return t;
  };
  p.a = fill(T0, opts.aCorrect ?? [], false);
  const bAt = new Date(T0 + 5 * 60_000).toISOString();
  p.b = { startedAt: bAt, completedAt: bAt, guideOpens: condition === 'guide' || condition === 'both' ? 1 : 0, guideMs: 30_000,
    records: (opts.exp ?? []).map((sym) => ({ emotionId: EMOTIONS.find((e) => e.symbol === sym)!.id, symbolId: sym, at: bAt, noted: false })) };
  p.c = fill(T0 + 5 * 60_000 + (opts.hours ?? 24) * H, opts.cCorrect ?? [], true);
  return p;
}

describe('기억 평가: 단계 흐름', () => {
  it('A → B → (최소 시간 대기) → C → 끝', () => {
    const p = newParticipant('experience', 7, new Date(T0), 'ua');
    expect(p.code).toMatch(/^M[0-9A-Z]{3}$/);
    expect(stageOf(p, T0)).toBe('a');
    p.a = { ...newTest(1, new Date(T0)), completedAt: new Date(T0).toISOString() };
    expect(stageOf(p, T0)).toBe('b');
    p.b = { startedAt: new Date(T0).toISOString(), completedAt: new Date(T0).toISOString(), records: [], guideOpens: 0, guideMs: 0 };
    expect(stageOf(p, T0 + 2 * H)).toBe('wait');
    expect(stageOf(p, T0 + ME_CRITERIA.minHours * H)).toBe('c');
    p.c = newTest(2, new Date(T0 + 25 * H));
    expect(stageOf(p, T0 + 25 * H)).toBe('c');
    p.c.completedAt = new Date(T0 + 25 * H).toISOString();
    expect(stageOf(p, T0 + 25 * H)).toBe('done');
    expect(elapsedHours(p)).toBeCloseTo(25);
  });

  it('조건은 인원이 가장 적은 쪽으로 자동 배정(화면 시험은 세지 않음)', () => {
    const ps = [fake('experience', 1), fake('guide', 2), fake('both', 3, { origin: 'synthetic-test' })];
    expect(nextCondition(ps)).toBe('both');
    expect(nextCondition([...ps, fake('both', 4)])).toBe('none');
  });

  it('형식 검사: C는 B 없이 할 수 없고, 확신·회상 값이 맞아야 한다', () => {
    const p = fake('guide', 5);
    expect(meProblems(p)).toEqual([]);
    expect(parseParticipants(JSON.stringify([p]))).toHaveLength(1);
    const bad = { ...p, b: undefined };
    expect(meProblems(bad)).toContain('체험(B) 없이 C를 했어요');
    const bad2 = structuredClone(p);
    bad2.c!.answers[0]!.confidence = 9 as 1;
    expect(meProblems(bad2).join()).toMatch(/확신/);
    expect(() => parseParticipants(JSON.stringify([bad2]))).toThrow(/1번째 참여자/);
  });

  it('판정 제외: 화면 시험·미완료·블라인드 위반', () => {
    expect(meExclusion(fake('none', 6, { origin: 'synthetic-test' }))).toMatch(/테스트/);
    const half = fake('none', 7);
    delete half.c;
    expect(meExclusion(half)).toMatch(/세 단계/);
    const br = fake('none', 8);
    br.c!.blindBreach = true;
    expect(meExclusion(br)).toMatch(/정답 화면/);
    expect(meCounted([fake('none', 9), fake('none', 9)])).toHaveLength(1); // 같은 id는 한 번
  });
});

describe('기억 평가: 집계(정답률과 회상 분리, 노출 조건별)', () => {
  const sym = EMOTIONS.map((e) => e.symbol);
  const ps = [
    fake('experience', 11, { aCorrect: sym.slice(0, 1), cCorrect: sym.slice(0, 4), exp: sym.slice(0, 4), recall: 'clear', hours: 23 }),
    fake('none', 12, { aCorrect: sym.slice(0, 1), cCorrect: sym.slice(0, 2), recall: 'not-seen', hours: 40 }),
  ];

  it('조건별 A·C 정답률, 모르겠어요, 확신, 회상 분포, 경과 시간', () => {
    const g = groupSummary(ps);
    const ex = g.find((x) => x.condition === 'experience')!;
    expect(ex.participants).toBe(1);
    expect(ex.aAccuracy).toBeCloseTo(1 / 12);
    expect(ex.cAccuracy).toBeCloseTo(4 / 12);
    expect(ex.cUnsure).toBeCloseTo(8 / 12);
    expect(ex.recall.clear).toBe(12); // 상징 12개만 센다(대조 2개 제외)
    expect(ex.meanElapsedHours).toBeCloseTo(23);
    const none = g.find((x) => x.condition === 'none')!;
    expect(none.recall['not-seen']).toBe(12);
    expect(g.find((x) => x.condition === 'guide')!.participants).toBe(0);
  });

  it('체험으로 생겼던 상징 vs 아닌 상징을 같은 사람 안에서 나눠 본다', () => {
    const [exp, no] = exposureSplit(ps);
    expect(exp!.n).toBe(4);
    expect(exp!.correct).toBe(4);
    expect(no!.n).toBe(8);
    expect(no!.correct).toBe(0);
    expect(exposureOf(ps[0]!)[sym[0]!]!.experienced).toBe(1);
  });

  it('대조 그림 답은 정답률에 넣지 않고 따로 센다', () => {
    const s = testStats(ps[0]!.c);
    expect(s.n).toBe(12);
    expect(s.controlN).toBe(2);
  });

  it('반복된 혼동은 2번 이상만', () => {
    const a = fake('none', 21); const b = fake('none', 22);
    for (const p of [a, b]) p.c!.answers = p.c!.answers.map((x) => (x.itemId === 'emotion.bottle-letter' ? { ...x, guess: 'emo.flutter' } : x));
    expect(confusions([a, b])).toEqual([{ itemId: 'emotion.bottle-letter', truth: 'emo.longing', guess: 'emo.flutter', n: 2 }]);
    expect(confusions([a])).toEqual([]);
  });

  it('보고서: 탐색용·대조 비교 안내, 경과 시간 벗어남 표시, 회상 표는 정답률 표와 따로', () => {
    const r = formatMeReport(ps, (id) => id, (id) => id);
    expect(r).toMatch(/2명 미만|3명 미만이라 보류/);
    expect(r).toMatch(/노출 없음\(대조\)/);
    expect(r).toMatch(/벗어난 참여자 1명/);
    expect(r.indexOf('## 회상')).toBeGreaterThan(r.indexOf('## 정답률'));
  });
});
