import { describe, expect, it } from 'vitest';
import { addDays } from '../../engine/dates';
import { EMOTIONS } from '../../engine/mood';
import { seedFromString } from '../../engine/random';
import { TankSession, type NewEntry } from '../../engine/session';
import type { TankConfig } from '../../engine/types';
import { GUIDE, guideOfSymbol, stageScaleFor, traceCountsOf, traceNoticesOf } from '../encyclopedia';

const START = '2026-01-01';
const cfg = (total: number | null): TankConfig => ({
  tankId: 't', seed: seedFromString('guide'), themeId: 'starlit-desert', startDate: START,
  goal: total ? { type: 'pages', totalUnits: total, dailyTarget: null } : { type: 'free', totalUnits: null, dailyTarget: null },
} as TankConfig);
let n = 0;
const e = (day: number, amount: number, chips: string[], progress: number | null = null): NewEntry => {
  n += 1;
  return { clientId: `g${n}`, localDate: addDays(START, day), amount, progressValue: progress, moodChips: chips, note: '' };
};
const at = (day: number) => Date.UTC(2026, 0, 1 + day, 12);
const noticesOfHead = (s: TankSession) => traceNoticesOf(s.head.changes, s.head.state.objects, s.head.seq);

const publicFiles = Object.keys(import.meta.glob('../../../public/assets/emotions/*.webp'));

describe('감정 도감', () => {
  it('12가지 감정 모두 상징·한 줄 의미·그림·표시 크기가 있다', () => {
    expect(GUIDE).toHaveLength(EMOTIONS.length);
    expect(new Set(GUIDE.map((g) => g.symbolId)).size).toBe(12);
    for (const g of GUIDE) {
      expect(g.meaning.length).toBeGreaterThan(5);
      expect(publicFiles).toContain(`../../../public/assets/${g.src}`);
      expect(g.displayHeight).toBeGreaterThan(20);
      expect(g.aspect).toBeGreaterThan(0);
    }
  });

  it('실제 크기 비율은 어항 폭(논리 1000)에 맞춘다', () => {
    expect(stageScaleFor(500)).toBe(0.5);
    expect(stageScaleFor(1000)).toBe(1);
    expect(stageScaleFor(0)).toBe(0.2);
  });

  it('검증실(평가 화면)은 도감을 가져오지 않는다(평가 중 정답 노출 방지)', () => {
    const lab = import.meta.glob('../../lab/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.keys(lab).length).toBeGreaterThan(3);
    for (const [path, src] of Object.entries(lab)) {
      expect(src, path).not.toMatch(/ui\/encyclopedia|EmotionGuide/);
      for (const g of GUIDE) expect(src, path).not.toContain(g.meaning);
    }
  });
});

describe('흔적 생성 안내', () => {
  it('흔적이 생긴 기록에만 안내가 붙고, 문장에 시간 표현(오늘·그동안)이 없다', () => {
    const s = new TankSession(cfg(null));
    s.addEntry(e(0, 10, ['그리움']), at(0));
    expect(noticesOfHead(s)).toEqual([]);
    s.addEntry(e(1, 5, ['그리움']), at(1)); // 그리움 누적 15쪽 → 1개(여러 기록이 모여 생김)
    const [nt] = noticesOfHead(s);
    expect(nt).toBeDefined();
    expect(nt!.kind).toBe('new');
    expect(nt!.guide.symbolName).toBe('유리병 편지');
    expect(nt!.headline).toBe('그리움이 유리병 편지가 되었어요');
    expect(nt!.headline).not.toMatch(/오늘|그동안|일부터/);
    // 출처는 엔진 문장이 정책대로 말한다(여러 날이 모였으면 "○월 ○일부터 모인")
    expect(nt!.why).toMatch(/1월 1일부터 모인 그리움에서/);
    expect(guideOfSymbol(nt!.guide.symbolId)).toBe(nt!.guide);
  });

  it('흔적이 자라면 "더해져 자랐어요", 감정 없는 기록·다른 생물 변화에는 안내가 없다', () => {
    const s = new TankSession(cfg(null));
    let grown = null;
    for (let d = 0; d < 30 && !grown; d++) {
      s.addEntry(e(d, 45, ['기쁨']), at(d));
      grown = noticesOfHead(s).find((x) => x.kind === 'grown') ?? null;
    }
    expect(grown).not.toBeNull();
    expect(grown!.headline).toBe('기쁨이 더해져 노을빛 꽃산호가 자랐어요');
    expect(grown!.stage).toBeGreaterThanOrEqual(2);
    const s2 = new TankSession(cfg(null));
    s2.addEntry(e(0, 40, []), at(0));
    expect(noticesOfHead(s2)).toEqual([]);
    expect(s2.head.changes.length).toBeGreaterThan(0);
  });

  it('완독 채움 흔적도 같은 안내 형식(시간 표현은 엔진 문장 "그동안의 …"에만)', () => {
    const s = new TankSession(cfg(400));
    for (let d = 0; d < 9; d++) s.addEntry(e(d, 15, ['평온'], 15 * (d + 1)), at(d));
    s.addEntry(e(9, 15, ['평온'], 400), at(9));
    s.answerCompletion('finished', at(9) + 1000);
    const ns = noticesOfHead(s);
    expect(ns.length).toBeGreaterThan(0);
    for (const x of ns) expect(x.headline).not.toMatch(/오늘|그동안/);
    expect(ns.some((x) => /그동안의 평온이 모여/.test(x.why))).toBe(true);
    expect(traceCountsOf(s.head.state.objects)['emotion.star-jelly']).toBeGreaterThan(0);
  });
});
