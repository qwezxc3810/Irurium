import { describe, expect, it } from 'vitest';
import { EMOTIONS } from '../../engine/mood';
import {
  formatSeReport, GUESS_OPTIONS, newSeSession, parseSeSessions, SE_CRITERIA, seCounted, seExclusion, seItems, seOverview, seProblems, seSummary, shuffleItems, UNSURE,
  type SeSession,
} from '../symbolEval';
import evalTabSource from '../ui/SymbolEvalTab.tsx?raw';

const T = new Date('2026-11-27T01:00:00Z');
function finished(id: string, pick: (truth: string | null, itemId: string) => string, origin: SeSession['origin'] = 'human'): SeSession {
  const s = newSeSession(id, id.length * 7919, T, 'test', origin);
  const items = new Map(seItems().map((i) => [i.id, i]));
  return { ...s, id: `se-${id}`, answers: s.order.map((itemId) => ({ itemId, guess: pick(items.get(itemId)!.truth, itemId) })), completedAt: '2026-11-27T01:03:00Z' };
}
const right = (truth: string | null) => truth ?? UNSURE;

describe('감정 상징 평가: 문항', () => {
  it('상징 12종 + 대조 2개(감정과 무관), 답은 12개 감정 + 모르겠어요', () => {
    const items = seItems();
    expect(items).toHaveLength(14);
    expect(items.filter((i) => i.truth)).toHaveLength(12);
    expect(new Set(items.filter((i) => i.truth).map((i) => i.truth))).toEqual(new Set(EMOTIONS.map((e) => e.id)));
    expect(items.filter((i) => !i.truth).map((i) => i.el)).toEqual(['fish.medaka', 'rock.round']);
    expect(GUESS_OPTIONS).toHaveLength(13);
  });

  it('순서는 세션마다 무작위(같은 시드면 같음), 모든 문항이 한 번씩', () => {
    const a = shuffleItems(seItems(), 1);
    expect(shuffleItems(seItems(), 1)).toEqual(a);
    expect(shuffleItems(seItems(), 2)).not.toEqual(a);
    expect([...a].sort()).toEqual(seItems().map((i) => i.id).sort());
  });

  it('블라인드: 평가 화면은 그림만 보여 주고 이름·정답을 그리지 않는다', () => {
    const step = evalTabSource.slice(evalTabSource.indexOf('function EvalStep'), evalTabSource.indexOf('function Results'));
    expect(step).not.toMatch(/item\.name|item\.truth|guessLabel/);
    expect(evalTabSource).toMatch(/alt="평가 그림"/);
  });
});

describe('감정 상징 평가: 세션·집계', () => {
  it('형식 검사와 제외 사유(테스트용·미완료·블라인드 위반)', () => {
    const ok = finished('a', right);
    expect(seProblems(ok)).toEqual([]);
    expect(seExclusion(ok)).toBeNull();
    expect(seExclusion(finished('b', right, 'synthetic-test'))).toBe('테스트용(화면 시험)');
    expect(seExclusion({ ...ok, completedAt: undefined })).toBe('끝까지 하지 않음');
    expect(seExclusion({ ...ok, blindBreach: true })).toBe('평가 도중 정답 화면이 열려 있었음');
    expect(seProblems({ ...ok, answers: [...ok.answers, ok.answers[0]!] })).toContain('같은 문항에 두 번 답했어요');
    expect(seProblems({ ...ok, answers: [{ itemId: ok.order[0]!, guess: 'emo.nope' }] })).toContain('답 형식이 틀려요');
    expect(() => parseSeSessions('{"schema":"x"}')).toThrow();
    expect(parseSeSessions(JSON.stringify([ok]))).toHaveLength(1);
  });

  it('같은 세션을 두 번 합쳐도 한 번만 센다', () => {
    const s = finished('a', right);
    expect(seCounted([s, s])).toHaveLength(1);
  });

  it('맞힘·모르겠어요·가장 많이 고른 다른 감정·탐색 판정', () => {
    // 3명: 그리움 상징은 모두 맞힘, 외로움 상징은 모두 슬픔으로, 나머지는 모르겠어요
    const pick = (truth: string | null) => (truth === 'emo.longing' ? 'emo.longing' : truth === 'emo.lonely' ? 'emo.sad' : UNSURE);
    const sessions = ['a', 'bb', 'ccc'].map((id) => finished(id, pick));
    const rows = new Map(seSummary(sessions).map((r) => [r.item.truth ?? r.item.id, r]));
    expect(rows.get('emo.longing')!).toMatchObject({ n: 3, correct: 3, label: 'readable' });
    expect(rows.get('emo.lonely')!).toMatchObject({ correct: 0, label: 'unreadable', topWrong: { guess: 'emo.sad', n: 3 } });
    expect(rows.get('emo.joy')!).toMatchObject({ unsure: 3, label: 'unreadable' });
    expect(rows.get('control.rock')!.label).toBe('control');
    const o = seOverview(sessions);
    expect(o.evaluators).toBe(3);
    expect(o.enough).toBe(true);
    expect(o.accuracy).toBeCloseTo(1 / 12);
    expect(o.controlEmotionRate).toBe(0);
    expect(o.counts.readable).toBe(1);
    const rep = formatSeReport(sessions);
    expect(rep).toContain('탐색용 결과');
    expect(rep).toContain('| 등불 물고기 | 외로움 | 0/3 (0%) | 0/3 | 슬픔 3 | 안 읽힘 |');
  });

  it(`${SE_CRITERIA.minEvaluators}명 미만이면 보류`, () => {
    const o = seOverview([finished('a', right), finished('bb', right)]);
    expect(o.enough).toBe(false);
    expect(formatSeReport([finished('a', right)])).toContain('3명 미만이라 보류');
  });

  it('대조 그림에 감정을 고르면 그 비율이 잡힌다', () => {
    const o = seOverview(['a', 'bb', 'ccc'].map((id) => finished(id, (t) => t ?? 'emo.joy')));
    expect(o.controlEmotionRate).toBe(1);
    expect(o.accuracy).toBe(1);
  });
});
