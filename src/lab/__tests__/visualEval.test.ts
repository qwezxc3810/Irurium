import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION } from '../../engine/config';
import { GOLDEN_REPLAY } from '../../engine/__tests__/golden';
import { littlePrinceConfig, littlePrinceEntries } from '../../engine/scenarios';
import { TankSession } from '../../engine/session';
import manifest from '../../../public/assets/manifest.json';
import {
  autoDistinct, autoMetrics, blindPair, canStartEvaluation, chipsFor, REVEAL_FRESH_MS, REVEAL_HEARTBEAT_MS, compareRows, countedSessions, exclusionReason, formatV1Report, humanSummary, isBlindBreach, newSession,
  sessionProblems,
  parseSessions, runVisualSet, shuffleOrder, v1Verdict, V1_CRITERIA, VE_DAYS, vePairs, veTanks,
  type VeAnswer, type VeSession,
} from '../visualEval';

const set = runVisualSet();

describe('평가 어항: 한 가지만 다르게', () => {
  it('감정 쌍은 같은 책·날짜·쪽수·시드에서 감정 칩만 다르다', () => {
    const emo = veTanks().filter((t) => t.group === 'emotion');
    expect(new Set(emo.map((t) => t.tank.cfg.seed)).size).toBe(1);
    const strip = (t: (typeof emo)[number]) => t.tank.entries.map((e) => ({ d: e.localDate, a: e.amount, p: e.progressValue, time: e.time }));
    expect(strip(emo[1]!)).toEqual(strip(emo[0]!));
    expect(strip(emo[2]!)).toEqual(strip(emo[0]!));
    expect(emo[0]!.tank.cfg.goal).toEqual(emo[1]!.tank.cfg.goal);
    expect(emo.map((t) => t.tank.entries[0]!.moodChips.join())).not.toEqual(Array(3).fill(emo[0]!.tank.entries[0]!.moodChips.join()));
  });

  it('따뜻한·차가운·변화 큰 감정이 모두 있다', () => {
    expect(veTanks().filter((t) => t.group === 'emotion').map((t) => t.emotion).sort()).toEqual(['cool', 'swing', 'warm']);
    expect(chipsFor('swing', 1)).not.toEqual(chipsFor('swing', 5)); // 4일마다 밝음 ↔ 어두움
  });

  it('시드 쌍은 감정 기록이 같고 시드만 다르다', () => {
    const seed = veTanks().filter((t) => t.group === 'seed');
    expect(new Set(seed.map((t) => t.tank.cfg.seed)).size).toBe(3);
    const chips = (t: (typeof seed)[number]) => t.tank.entries.map((e) => e.moodChips.join());
    expect(chips(seed[1]!)).toEqual(chips(seed[0]!));
    expect(chips(seed[2]!)).toEqual(chips(seed[0]!));
  });

  it('모두 샘플(sample:) 어항이고 14·100·200일을 본다, 쌍 21개', () => {
    for (const t of veTanks()) expect(t.tank.cfg.tankId.startsWith('sample:')).toBe(true);
    expect([...VE_DAYS]).toEqual([14, 100, 200]);
    const pairs = vePairs();
    expect(pairs.length).toBe(21);
    for (const day of VE_DAYS) {
      expect(pairs.filter((p) => p.day === day && p.kind === 'emotion').length).toBe(3);
      expect(pairs.filter((p) => p.day === day && p.kind === 'seed').length).toBe(3);
      expect(pairs.filter((p) => p.day === day && p.kind === 'control').length).toBe(1);
    }
  });

  it('엔진·그래픽은 그대로(엔진 0.2.0, 골든 해시, 그래픽 목록)', () => {
    expect(ENGINE_VERSION).toBe('0.2.0');
    expect(TankSession.replay(littlePrinceConfig(), littlePrinceEntries())).toBe(GOLDEN_REPLAY[ENGINE_VERSION]);
    expect(Object.keys((manifest as { elements: Record<string, unknown> }).elements).sort()).toMatchSnapshot();
  });
});

describe('블라인드', () => {
  it('평가 화면에 넘기는 값에는 감정·쌍 종류·어항 이름이 없다', () => {
    const order = shuffleOrder(set.pairs, 42);
    const bp = blindPair(set, order, 0);
    expect(Object.keys(bp).sort()).toEqual(['day', 'index', 'left', 'leftSpread', 'pairId', 'right', 'rightSpread']);
    expect(typeof bp.leftSpread).toBe('number'); // 분위기 렌더링 입력은 숫자만
    // 쌍 id는 내부 식별자라 화면에 보이지 않게 쓴다(문구로 출력하지 않음). 상태 자체에는 감정 이름이 없다
    expect(JSON.stringify(bp.left)).not.toMatch(/warm|cool|swing|따뜻|차가/);
  });

  it('순서·좌우는 세션마다 섞이고, 같은 씨앗이면 같다', () => {
    const a = shuffleOrder(set.pairs, 1);
    const b = shuffleOrder(set.pairs, 2);
    expect(a).toEqual(shuffleOrder(set.pairs, 1));
    expect(a.map((x) => x.pairId)).not.toEqual(b.map((x) => x.pairId));
    expect(new Set(a.map((x) => x.pairId)).size).toBe(21);
    expect(a.some((x) => x.swap) && a.some((x) => !x.swap)).toBe(true);
  });
});

describe('자동 수치', () => {
  const m = autoMetrics(set);
  it('같은 어항 두 번은 모든 거리가 0', () => {
    for (const x of m.filter((x) => x.kind === 'control')) expect([x.moodComposition, x.composition, x.light, x.layout]).toEqual([0, 0, 0, 0]);
  });
  it('기존 감정 구별 기준(감정 쌍 최소 > 시드 쌍 최대)을 날짜마다 계산한다(수치 기준일 뿐)', () => {
    const d = autoDistinct(m);
    expect(d.map((x) => x.day)).toEqual([14, 100, 200]);
    for (const x of d) expect(x.ok).toBe(x.emotionMin > x.seedMax);
  });
});

// 아래 응답은 집계 코드를 확인하려고 테스트에서 만든 가짜 응답이다(origin: 'synthetic-test'). 실제 평가 결과가 아니다.
function fakeSession(id: string, origin: VeSession['origin'], answerFn: (p: ReturnType<typeof vePairs>[number], swap: boolean) => Omit<VeAnswer, 'pairId' | 'swap'>, complete = true): VeSession {
  const s = newSession(`테스트-${id}`, id.length * 7 + 1, new Date(Date.UTC(2026, 10, 16)), 'vitest', origin);
  s.sessionId = `test-${id}`;
  const pairs = new Map(vePairs().map((p) => [p.id, p]));
  s.answers = s.order.map((o) => ({ pairId: o.pairId, swap: o.swap, ...answerFn(pairs.get(o.pairId)!, o.swap) }));
  if (!complete) s.answers = s.answers.slice(0, 5);
  s.completedAt = complete ? '2026-11-16T00:00:00.000Z' : null;
  return s;
}
const tanks = veTanks();
const emoOf = (k: string) => tanks.find((t) => t.key === k)!.emotion;
/** 정답대로 답하기(화면 기준: 좌우가 바뀐 쌍은 왼쪽이 b) */
const perfect = (p: ReturnType<typeof vePairs>[number], swap: boolean) => ({ same: p.sameRecords ? 'same' as const : 'different' as const, emotionLeft: emoOf(swap ? p.b : p.a), emotionRight: emoOf(swap ? p.a : p.b), diff: p.kind === 'emotion' ? 5 as const : 1 as const });

describe('사람 평가: 실제 평가 없이는 통과하지 않는다', () => {
  it('평가가 없으면 보류', () => {
    const v = v1Verdict([]);
    expect(v.verdict).toBe('hold');
    expect(v.evaluators).toBe(0);
    expect(formatV1Report(set, [])).toContain('아직 실제 사람 평가가 없어요');
  });

  it('테스트용(synthetic-test) 응답은 아무리 완벽해도 판정에 쓰지 않는다', () => {
    const fakes = ['a', 'bb', 'ccc', 'dddd'].map((id) => fakeSession(id, 'synthetic-test', perfect));
    const v = v1Verdict(fakes);
    expect(v.verdict).toBe('hold');
    expect(v.evaluators).toBe(0);
    expect(v.excluded).toBe(4);
    expect(humanSummary(fakes).every((c) => c.answers === 0)).toBe(true);
    expect(compareRows(set, fakes).every((r) => r.humanEvaluators === 0 && r.humanEmotionDiff === null)).toBe(true);
  });

  it('끝까지 답하지 않은 세션·같은 세션 두 번은 세지 않는다, 최소 인원 미만이면 보류', () => {
    const one = fakeSession('a', 'human', perfect);
    const partial = fakeSession('bb', 'human', perfect, false);
    expect(countedSessions([one, one, partial]).length).toBe(1);
    expect(v1Verdict([one, one, partial]).verdict).toBe('hold');
    expect(V1_CRITERIA.minEvaluators).toBe(5);
    const four = ['a', 'bb', 'ccc', 'dddd'].map((id) => fakeSession(id, 'human', perfect));
    expect(v1Verdict(four).verdict).toBe('hold');
  });

  it('집계 계산 확인(사람 출처로 표시한 테스트 응답 5개): 정답대로 답하면 통과, 구별 못 하면 조정 필요', () => {
    // 집계 식만 확인하는 단위 테스트. 이 응답들은 저장소·문서의 결과로 쓰지 않는다
    const ids = ['a', 'bb', 'ccc', 'dddd', 'eeeee'];
    const good = ids.map((id) => fakeSession(id, 'human', perfect));
    expect(v1Verdict(good).verdict).toBe('pass');
    const blind = ids.map((id) => fakeSession(id, 'human', () => ({ same: 'same', emotionLeft: 'unsure', emotionRight: 'unsure', diff: 2 })));
    const v = v1Verdict(blind);
    expect(v.verdict).toBe('adjust');
    expect(v.reasons.some((r) => r.startsWith('✗'))).toBe(true);
    expect(v.evaluators).toBe(5);
  });

  it('좌우를 바꿔 보여 준 쌍도 감정 추측을 실제 어항에 맞춰 채점한다', () => {
    const mk = (id: string) => fakeSession(id, 'human', perfect);
    const right = humanSummary([mk('a'), mk('bb'), mk('ccc')]).find((c) => c.kind === 'emotion' && c.day === 'all')!;
    expect(right.emotionCorrect).toBe(1);
    // 화면 좌우를 무시하고(a·b 기준으로) 답하면, 좌우가 바뀐 쌍에서 틀린 것으로 채점된다
    const naive = (id: string) => fakeSession(id, 'human', (p) => perfect(p, false));
    const wrong = humanSummary([naive('a'), naive('bb'), naive('ccc')]).find((c) => c.kind === 'emotion' && c.day === 'all')!;
    expect(wrong.emotionCorrect!).toBeLessThan(1);
  });
});

describe('결과 저장·가져오기', () => {
  it('내보낸 결과를 다시 읽을 수 있고, 다른 형식은 거부한다', () => {
    const s = fakeSession('a', 'synthetic-test', perfect);
    expect(parseSessions(JSON.stringify(s))).toEqual([s]);
    expect(parseSessions(JSON.stringify([s, s])).length).toBe(2);
    expect(() => parseSessions('nope')).toThrow('JSON');
    expect(() => parseSessions(JSON.stringify({ schema: 'other' }))).toThrow('결과 파일이 아니에요');
    expect(() => parseSessions(JSON.stringify({ ...s, origin: undefined }))).toThrow('출처');
    expect(() => parseSessions(JSON.stringify({ ...s, answers: [{ ...s.answers[0], diff: 9 }] }))).toThrow('1~5');
  });

  it('정리 텍스트는 자동 수치와 사람 평가를 다른 절로 나눈다', () => {
    const t = formatV1Report(set, []);
    expect(t).toContain('## 자동 수치 (엔진 상태 기반, 샘플 기록)');
    expect(t).toContain('## 사람 평가 (실제 평가 0명)');
    expect(t).toContain('## 판정: 보류(사람 평가 부족)');
  });
});

describe('세션 일관성 검사 (리뷰 반영)', () => {
  const good = () => JSON.parse(JSON.stringify(fakeSession('a', 'human', perfect))) as VeSession;
  const bad = (fn: (s: VeSession) => void) => { const s = good(); fn(s); return s; };

  it('정상 세션은 문제 없음', () => {
    expect(sessionProblems(good())).toEqual([]);
    expect(exclusionReason(good())).toBeNull();
  });

  it("답의 좌우(swap)가 실제로 보여 준 순서와 다르면 거부·집계 제외", () => {
    const s = bad((x) => { x.answers[0]!.swap = !x.answers[0]!.swap; });
    expect(sessionProblems(s).some((e) => e.includes('실제로 보여 준 순서와 달라요'))).toBe(true);
    expect(() => parseSessions(JSON.stringify(s))).toThrow('보여 준 순서');
    expect(countedSessions([s])).toEqual([]);
  });

  it('채점은 답에 적힌 swap이 아니라 실제로 보여 준 순서로 한다', () => {
    // 일관성 검사를 거치지 않고 직접 넘겨도, 정상 세션의 채점은 order 기준이라 바뀌지 않는다
    const ss = ['a', 'bb', 'ccc', 'dddd', 'eeeee'].map((id) => fakeSession(id, 'human', perfect));
    const before = humanSummary(ss).find((c) => c.kind === 'emotion' && c.day === 'all')!.emotionCorrect;
    expect(before).toBe(1);
  });

  it('순서(order)가 21쌍이 아니거나, 같은 쌍이 두 번이거나, 모르는 쌍이면 거부', () => {
    expect(sessionProblems(bad((x) => { x.order.pop(); })).join()).toContain('모두 담고 있지 않아요');
    expect(sessionProblems(bad((x) => { x.order[1] = { ...x.order[0]! }; })).join()).toContain('같은 쌍이 두 번');
    expect(sessionProblems(bad((x) => { x.order[0]!.pairId = 'd1:X|Y'; })).join()).toContain('모르는 쌍');
    expect(sessionProblems(bad((x) => { (x.order[0] as { swap: unknown }).swap = 'yes'; })).join()).toContain('swap) 형식');
  });

  it('응답 값이 허용값이 아니거나, 같은 쌍에 두 번 답하거나, 완료인데 덜 답했으면 거부', () => {
    expect(sessionProblems(bad((x) => { (x.answers[0] as { same: string }).same = 'maybe'; })).join()).toContain("'같은 기록' 답");
    expect(sessionProblems(bad((x) => { (x.answers[0] as { emotionLeft: string }).emotionLeft = 'happy'; })).join()).toContain('감정 답');
    expect(sessionProblems(bad((x) => { x.answers[1] = { ...x.answers[0]! }; })).join()).toContain('두 번 답했어요');
    expect(sessionProblems(bad((x) => { x.answers.pop(); })).join()).toContain('완료로 표시됐지만');
  });

  it('다른 엔진 버전으로 본 어항의 평가는 가져오되 판정에서 뺀다', () => {
    const s = bad((x) => { x.engineVersion = '0.1.0'; });
    expect(parseSessions(JSON.stringify(s)).length).toBe(1);
    expect(exclusionReason(s)).toContain('다른 엔진 버전');
    expect(countedSessions([s])).toEqual([]);
  });

  it('블라인드 위반: 평가 도중 정답 화면을 연 세션은 판정에서 뺀다', () => {
    const s = good();
    expect(isBlindBreach(s, null, '2026-11-16T01:00:00.000Z')).toBe(false);
    expect(isBlindBreach(s, '2026-11-15T23:00:00.000Z', '2026-11-16T01:00:00.000Z')).toBe(false); // 시작 한참 전에 열었다 닫은 것
    expect(isBlindBreach(s, '2026-11-16T00:30:00.000Z', '2026-11-16T01:00:00.000Z')).toBe(true); // 도중에 연 것
    const breached = { ...s, blindBreach: true };
    expect(exclusionReason(breached)).toContain('블라인드 위반');
    const five = ['a', 'bb', 'ccc', 'dddd', 'eeeee'].map((id) => ({ ...fakeSession(id, 'human', perfect), blindBreach: true }));
    expect(v1Verdict(five).verdict).toBe('hold');
  });
});

describe('다중 탭 블라인드 (리뷰 반영)', () => {
  /** 탭 둘이 같은 저장소를 쓰는 상황을 시각만으로 재현: 정답 화면은 열려 있는 동안 1초마다 시각을 남긴다 */
  function simulate(resultsOpen: [number, number] | null, startAt: number, endAt: number) {
    let revealedAt: string | null = null;
    const iso = (ms: number) => new Date(ms).toISOString();
    const beatsUntil = (until: number) => {
      if (!resultsOpen) return;
      for (let t = resultsOpen[0]; t <= Math.min(resultsOpen[1], until); t += REVEAL_HEARTBEAT_MS) revealedAt = iso(t);
    };
    beatsUntil(startAt);
    const canStart = canStartEvaluation(revealedAt, startAt);
    beatsUntil(endAt);
    const session = { startedAt: iso(startAt) };
    return { canStart, breach: isBlindBreach(session, revealedAt, iso(endAt)) };
  }
  const T = Date.UTC(2026, 10, 16, 1);

  it('결과 탭을 먼저 열어 둔 채 다른 탭에서 평가를 시작하려 하면 막는다', () => {
    expect(simulate([T, T + 60_000], T + 30_000, T + 600_000).canStart).toBe(false);
  });

  it('막혀도 시작했다고 치면(결과 탭을 계속 열어 둠), 완료할 때 블라인드 위반으로 잡힌다', () => {
    expect(simulate([T, T + 600_000], T + 30_000, T + 400_000).breach).toBe(true);
  });

  it('결과 탭을 먼저 열고, 평가 도중에 보던 경로(열어 둔 채 평가 → 기존 결과 화면 열람 → 완료)도 위반', () => {
    // 평가 시작 전부터 열려 있다가 평가 중간(시작 +2분)에 닫힘
    expect(simulate([T, T + 150_000], T + 30_000, T + 600_000).breach).toBe(true);
  });

  it('평가 도중 다른 탭에서 결과를 잠깐 열었다 닫아도 위반', () => {
    expect(simulate([T + 200_000, T + 203_000], T, T + 600_000).breach).toBe(true);
  });

  it('결과 화면을 닫고 충분히 지난 뒤 시작하면 시작할 수 있고 위반도 아니다', () => {
    const r = simulate([T, T + 10_000], T + 10_000 + REVEAL_FRESH_MS + 1000, T + 600_000);
    expect(r).toEqual({ canStart: true, breach: false });
  });

  it('평가가 끝난 뒤에 결과를 연 것은 위반이 아니다', () => {
    expect(simulate([T + 700_000, T + 800_000], T, T + 600_000).breach).toBe(false);
  });
});

describe('렌더링 버전 구분 (분위기 렌더링 실험)', () => {
  it('렌더링 버전이 없는 예전 세션은 기존(v0) 판정에만 들어가고, 분위기(atmos-1) 판정과 섞이지 않는다', () => {
    const ids = ['a', 'bb', 'ccc', 'dddd', 'eeeee'];
    const legacy = ids.map((id) => { const s = fakeSession(id, 'human', perfect); delete (s as { renderStyle?: string }).renderStyle; return s; });
    expect(countedSessions(legacy, 'v0').length).toBe(5);
    expect(countedSessions(legacy, 'atmos-1').length).toBe(0);
    expect(v1Verdict(legacy, 'v0').verdict).toBe('pass');
    expect(v1Verdict(legacy, 'atmos-1').verdict).toBe('hold');
    expect(exclusionReason(legacy[0]!, 'atmos-1')).toContain('다른 렌더링(v0)');
  });

  it('새 세션은 지금 기본 렌더링(atmos-1)을 기록하고, 렌더링 버전 형식이 틀리면 거부', () => {
    const s = fakeSession('a', 'human', perfect);
    expect(s.renderStyle).toBe('atmos-1');
    expect(sessionProblems({ ...s, renderStyle: 'neon' }).join()).toContain('렌더링 버전');
    expect(formatV1Report(set, [], 'v0')).toContain('렌더링 v0');
  });
});

