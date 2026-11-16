import { describe, expect, it } from 'vitest';
import { AUTO, autoStart, autoStep, initialQuality, isSlow, loadDecision, loadPref, type AutoState } from '../autoQuality';
import { computeFrameStats } from '../frameStats';

const fps = (f: number, n = Math.round((AUTO.windowMs / 1000) * f)) => computeFrameStats(Array(n).fill(1000 / f));
const step = (s: AutoState, f: number, visible = true) => autoStep(s, { dtMs: 1000, stats: fps(f), visible });
const run = (s: AutoState, f: number, times: number) => {
  for (let i = 0; i < times; i++) s = step(s, f);
  return s;
};

describe('버거움 판정', () => {
  it('목표는 60fps 고정: 120Hz 기기가 60fps로 그려도 버겁지 않고(폴드7 실측 120fps도 아님), 30fps는 버거움', () => {
    expect(AUTO.targetFps).toBe(60);
    expect(isSlow(fps(60))).toBe(false);
    expect(isSlow(fps(120))).toBe(false);
    // 그리기가 느려 브라우저 갱신까지 30으로 떨어진 기기도 놓치지 않는다
    expect(isSlow(fps(30))).toBe(true);
  });

  it('평균이 목표의 80% 아래면 버거움, 1% 느린 프레임이 50% 아래여도 버거움', () => {
    expect(isSlow(fps(50))).toBe(false);
    expect(isSlow(fps(45))).toBe(true);
    const spiky = computeFrameStats([...Array(170).fill(1000 / 60), ...Array(10).fill(80)]);
    expect(spiky.avgFps).toBeGreaterThan(48);
    expect(isSlow(spiky)).toBe(true);
  });

  it('프레임이 아예 없으면 판단하지 않고, 아주 적으면 버거움', () => {
    expect(isSlow(computeFrameStats([]))).toBeNull();
    expect(isSlow(fps(5))).toBe(true);
  });
});

describe('자동 전환', () => {
  it('부드러우면 계속 일반', () => {
    expect(run(autoStart('normal'), 60, 60).quality).toBe('normal');
  });

  it('시작 직후 2초는 보지 않고, 그 뒤 3초 연속 버거우면 저사양', () => {
    const s = run(autoStart('normal'), 20, 4); // 1·2초 워밍업, 3·4초 버거움 2번
    expect(s.quality).toBe('normal');
    const t = step(s, 20);
    expect(t.quality).toBe('low');
    expect(t.reason).toContain('시작할 때');
    expect(t.reason).toContain('목표 60fps');
  });

  it('잠깐 버벅이고 회복하면 내리지 않는다(연속으로만 셈)', () => {
    let s = run(autoStart('normal'), 60, 3);
    s = run(s, 20, 2);
    s = run(s, 60, 1);
    s = run(s, 20, 2);
    expect(s.quality).toBe('normal');
  });

  it('처음 10초가 지나면 8초 연속 버거워야 내린다(발열 등)', () => {
    let s = run(autoStart('normal'), 60, 15);
    s = run(s, 30, 7);
    expect(s.quality).toBe('normal');
    s = step(s, 30);
    expect(s.quality).toBe('low');
    expect(s.reason).toContain('쓰는 중에');
  });

  it('저사양이 되면 자동으로 다시 올리지 않는다', () => {
    const s = run(autoStart('low'), 120, 30);
    expect(s.quality).toBe('low');
  });

  it('화면이 숨겨진 동안은 세지 않고 연속 기록도 끊는다', () => {
    let s = run(autoStart('normal'), 20, 4);
    expect(s.slowSteps).toBe(2);
    s = autoStep(s, { dtMs: 1000, stats: fps(20), visible: false });
    expect(s.slowSteps).toBe(0);
    expect(s.quality).toBe('normal');
  });
});

describe('시작 모드와 저장', () => {
  const now = 1_800_000_000_000;
  const strong = { memoryGb: 8, cores: 8 };

  it('직접 고른 모드는 그대로', () => {
    expect(initialQuality('low', null, now, strong).quality).toBe('low');
    expect(initialQuality('normal', { quality: 'low', at: now, reason: 'x' }, now, { memoryGb: 1, cores: 1 }).quality).toBe('normal');
  });

  it('자동: 7일 안의 저사양 판정은 기억, 지나면 다시 일반으로 시험', () => {
    const d = { quality: 'low' as const, at: now - 1000, reason: '버거움' };
    expect(initialQuality('auto', d, now, strong)).toEqual({ quality: 'low', reason: '지난 자동 판정: 버거움' });
    expect(initialQuality('auto', { ...d, at: now - AUTO.rememberMs - 1 }, now, strong).quality).toBe('normal');
  });

  it('자동: 사양이 아주 낮으면(메모리 2GB 이하·코어 2개 이하) 저사양부터, 모르면 일반', () => {
    expect(initialQuality('auto', null, now, { memoryGb: 2, cores: 8 }).quality).toBe('low');
    expect(initialQuality('auto', null, now, { memoryGb: null, cores: 2 }).quality).toBe('low');
    expect(initialQuality('auto', null, now, { memoryGb: null, cores: null }).quality).toBe('normal');
    expect(initialQuality('auto', null, now, strong).quality).toBe('normal');
  });

  it('"일반으로 다시 시험하기"는 기억한 판정과 사양 추정을 건너뛴다', () => {
    const d = { quality: 'low' as const, at: now - 1000, reason: '버거움' };
    expect(initialQuality('auto', d, now, { memoryGb: 1, cores: 1 }, true)).toEqual({ quality: 'normal', reason: null });
    expect(initialQuality('low', d, now, strong, true).quality).toBe('low');
  });

  it('저장소 값이 이상하거나 막혀 있으면 기본값', () => {
    expect(loadPref(null)).toBe('auto');
    expect(loadPref({ getItem: () => 'weird' })).toBe('auto');
    expect(loadPref({ getItem: () => 'low' })).toBe('low');
    expect(loadPref({ getItem: () => { throw new Error('blocked'); } })).toBe('auto');
    expect(loadDecision({ getItem: () => '{bad json' })).toBeNull();
    expect(loadDecision({ getItem: () => JSON.stringify({ quality: 'low', at: 1, reason: 'r' }) })).toEqual({ quality: 'low', at: 1, reason: 'r' });
  });
});
