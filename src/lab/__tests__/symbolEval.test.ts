import { describe, expect, it } from 'vitest';
import { EMOTIONS } from '../../engine/mood';
import {
  formatSeReport, GUESS_OPTIONS, newSeSession, parseSeSessions, SE_CRITERIA, seCounted, seExclusion, seItems, seOverview, seProblems, seSummary, shuffleItems, UNSURE,
  type SeSession,
} from '../symbolEval';
import evalTabSource from '../ui/SymbolEvalTab.tsx?raw';
import { closeCollection, mayStartEval, reopenCollection, resultsVisible, SE_COLLECTION_OPEN, startedAfterReveal } from '../symbolEval';

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
    expect(formatSeReport([finished('a', right)])).toContain('세션 3개 미만이라 보류');
  });

  it('대조 그림에 감정을 고르면 그 비율이 잡힌다', () => {
    const o = seOverview(['a', 'bb', 'ccc'].map((id) => finished(id, (t) => t ?? 'emo.joy')));
    expect(o.controlEmotionRate).toBe(1);
    expect(o.accuracy).toBe(1);
  });
});

describe('리뷰 반영(PR #27)', () => {
  it('집계 단위는 세션: 같은 별칭이 다른 세션으로 두 번 하면 "세션 2개"로 세고 사람 수라고 말하지 않는다', () => {
    const a = { ...finished('a', right), evaluator: '민' };
    const b = { ...finished('bb', right), evaluator: '민' };
    const o = seOverview([a, b]);
    expect(o.evaluators).toBe(2);
    const rep = formatSeReport([a, b]);
    expect(rep).toContain('유효한 평가 세션 2개');
    expect(rep).not.toMatch(/실제 평가 \d+명/);
    expect(rep).toContain('서로 다른 사람이 한 번씩 했는지는 진행자가 확인');
    expect(evalTabSource).not.toMatch(/실제 평가 \$\{/);
  });

  it('12종 한눈에 보기: 결과 화면에서만(평가 화면엔 없음), 상징 12종과 대조 2종을 나눠 보여 준다', () => {
    const results = evalTabSource.slice(evalTabSource.indexOf('function Results'));
    const step = evalTabSource.slice(evalTabSource.indexOf('function EvalStep'), evalTabSource.indexOf('function Results'));
    expect(results).toMatch(/<Gallery rows=\{rows\} \/>/);
    expect(step).not.toMatch(/Gallery/);
    expect(evalTabSource).toMatch(/rows\.filter\(\(r\) => r\.item\.truth\)\.map\(card\)/);
    expect(evalTabSource).toMatch(/rows\.filter\(\(r\) => !r\.item\.truth\)\.map\(card\)/);
    // 결과(정답) 화면은 수집이 끝났을 때만, 평가 중에는 꺼진다
    expect(evalTabSource).toMatch(/\{resultsVisible\(collection\) && <button[^>]*disabled=\{!!current\} onClick=\{\(\) => setMode\('results'\)\}/);
    expect(seSummary([]).filter((r) => r.item.truth)).toHaveLength(12);
  });

  it('그림이 뜨기 전·실패하면 답할 수 없다(다시 불러오기)', () => {
    expect(evalTabSource).toMatch(/disabled=\{state !== 'ok'\}/);
    // 큰 그림·휴대폰 크기 그림 둘 다 떠야 답할 수 있다(재리뷰 참고 반영)
    expect(evalTabSource).toMatch(/big === 'ok' && small === 'ok' \? 'ok'/);
    expect(evalTabSource).toMatch(/size="phone" retry=\{retry\} onLoad=\{\(\) => setSmall\('ok'\)\} onError=\{\(\) => setSmall\('error'\)\}/);
  });
});

describe('리뷰 반영(PR #27 재리뷰): 정답은 진행자가 수집을 끝낸 뒤에만', () => {
  it('처음(완료 0개): 결과·정답을 볼 수 없고 평가는 시작할 수 있다', () => {
    expect(resultsVisible(SE_COLLECTION_OPEN)).toBe(false);
    expect(mayStartEval(SE_COLLECTION_OPEN)).toBe(true);
  });

  it('1번째 평가 끝 → 2번째 시작 전에도 수집 중이면 결과를 볼 수 없다(완료 세션 수와 무관)', () => {
    const done = [finished('a', right)];
    expect(done).toHaveLength(1);
    expect(resultsVisible(SE_COLLECTION_OPEN)).toBe(false);
  });

  it('진행자가 수집을 끝내면 결과·갤러리를 볼 수 있고 새 평가는 막힌다. 다시 열면 결과가 다시 닫힌다', () => {
    const closed = closeCollection(SE_COLLECTION_OPEN, new Date('2026-11-27T02:00:00Z'));
    expect(resultsVisible(closed)).toBe(true);
    expect(mayStartEval(closed)).toBe(false);
    const reopened = reopenCollection(closed);
    expect(resultsVisible(reopened)).toBe(false);
    expect(mayStartEval(reopened)).toBe(true);
    expect(reopened.firstRevealAt).toBe('2026-11-27T02:00:00.000Z');
  });

  it('정답이 공개된 뒤 시작한 세션은 표시하고 보고서에서 확인을 요청한다(자동으로 빼지는 않음)', () => {
    const c = reopenCollection(closeCollection(SE_COLLECTION_OPEN, new Date('2026-11-27T02:00:00Z')));
    const before = finished('a', right); // 01:00 시작
    const after = { ...finished('bb', right), startedAt: '2026-11-27T03:00:00Z' };
    expect(startedAfterReveal(before, c)).toBe(false);
    expect(startedAfterReveal(after, c)).toBe(true);
    expect(formatSeReport([before, after], c)).toContain('정답이 공개된 뒤 시작한 세션 1개');
    expect(seCounted([before, after])).toHaveLength(2);
  });

  it('화면 연결: 결과 화면은 수집이 끝났을 때만 그리고, 수집이 끝나면 평가 시작이 막힌다', () => {
    expect(evalTabSource).toMatch(/mode === 'results' && resultsVisible\(collection\) && <Results/);
    expect(evalTabSource).toMatch(/if \(!mayStartEval\(collection\)\)/);
    expect(evalTabSource).toMatch(/네, 수집 끝내고 결과 보기/);
  });
});
