import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION } from '../../engine/config';
import { GOLDEN_REPLAY } from '../../engine/__tests__/golden';
import { littlePrinceConfig, littlePrinceEntries } from '../../engine/scenarios';
import { TankSession } from '../../engine/session';
import { runVisualSet, waterGaps } from '../../lab/visualEval';
import { atmosphere, MAX_FILTER_ALPHA, MAX_GLOW_ALPHA, MAX_WATER_ALPHA, MIN_FILTER_LUMA, moodSpreadOf, RENDER_STYLE, SPREAD_FULL, SPREAD_START, TEMP_FULL } from '../atmosphere';
import { QUALITY } from '../quality';
import rendererSource from '../AquariumRenderer.ts?raw';

const rgb = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const dist = (a: number, b: number) => { const x = rgb(a); const y = rgb(b); return Math.hypot(x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!); };
const warmness = (c: number) => { const [r, , b] = rgb(c); return r! - b!; };

describe('감정 분위기(렌더링 전용)', () => {
  it('따뜻한 감정은 위층 물색이 붉은 쪽, 차가운 감정은 파란 쪽', () => {
    const w = atmosphere({ temp: 0.6, energy: 0.5, spread: 0.05 });
    const c = atmosphere({ temp: -0.25, energy: -0.4, spread: 0.05 });
    expect(warmness(w.waterTop.color)).toBeGreaterThan(30);
    expect(warmness(c.waterTop.color)).toBeLessThan(-30);
    expect(w.particles.warmShare).toBeGreaterThan(0.9);
    expect(c.particles.warmShare).toBeLessThan(0.1);
  });

  it('감정 변화가 크면 위는 따뜻한 빛, 아래는 차가운 빛이 함께(반반 나누지 않고 그라데이션 두 층)', () => {
    const s = atmosphere({ temp: 0, energy: 0.2, spread: SPREAD_FULL });
    expect(s.contrast).toBe(1);
    expect(warmness(s.waterTop.color)).toBeGreaterThan(0);
    expect(warmness(s.waterBottom.color)).toBeLessThan(0);
    expect(s.particles.warmShare).toBeGreaterThan(0.3);
    expect(s.particles.warmShare).toBeLessThan(0.7);
    expect(s.glowWarm.alpha).toBeGreaterThan(0.1); // 기존 조명과 겹쳐 뿌예지지 않게 따뜻한 보조 빛은 약하게;
    expect(s.glowCool.alpha).toBeGreaterThan(0.15);
  });

  it('같은 계열 감정끼리 오가는 흔들림(차분·쓸쓸·그리움 정도)은 대비로 보지 않는다', () => {
    expect(atmosphere({ temp: -0.22, energy: -0.45, spread: 0.32 }).contrast).toBe(0);
    expect(SPREAD_START).toBeGreaterThan(0.33);
  });

  it('고정 테마가 아니라 연속값: 감정이 조금 바뀌면 색도 조금만 바뀐다', () => {
    let prev = atmosphere({ temp: -0.6, energy: 0, spread: 0.1 });
    for (let t = -0.58; t <= 0.6; t += 0.02) {
      const a = atmosphere({ temp: t, energy: 0, spread: 0.1 });
      expect(dist(a.waterTop.color, prev.waterTop.color)).toBeLessThan(25);
      expect(Math.abs(a.waterTop.alpha - prev.waterTop.alpha)).toBeLessThan(0.05);
      prev = a;
    }
    // 중간값은 양 끝과 다르다(세 단계로 딱 끊기지 않음)
    const mid = atmosphere({ temp: TEMP_FULL / 2, energy: 0, spread: 0 });
    const full = atmosphere({ temp: TEMP_FULL, energy: 0, spread: 0 });
    const none = atmosphere({ temp: 0, energy: 0, spread: 0 });
    expect(dist(mid.waterTop.color, full.waterTop.color)).toBeGreaterThan(5);
    expect(dist(mid.waterTop.color, none.waterTop.color)).toBeGreaterThan(5);
  });

  it('어둡거나 탁해지지 않게 덧칠·빛 알파에 상한이 있다(극단값에서도)', () => {
    for (const temp of [-1, -0.5, 0, 0.5, 1]) for (const energy of [-1, 1]) for (const spread of [0, 1]) {
      const a = atmosphere({ temp, energy, spread });
      expect(a.waterTop.alpha).toBeLessThanOrEqual(MAX_WATER_ALPHA);
      expect(a.waterBottom.alpha).toBeLessThanOrEqual(MAX_FILTER_ALPHA);
      for (const t of [a.glowWarm, a.glowCool]) expect(t.alpha).toBeLessThanOrEqual(MAX_GLOW_ALPHA);
      // 아래층은 곱하기라 색이 밝아야 어두워지지 않는다
      const [r, g, b] = rgb(a.waterBottom.color);
      expect(0.2126 * r! + 0.7152 * g! + 0.0722 * b!).toBeGreaterThan(MIN_FILTER_LUMA);
    }
    expect(atmosphere({ temp: NaN, energy: NaN, spread: NaN }).waterTop.alpha).toBeGreaterThan(0);
  });

  it('감정 이력 흔들림은 최근 14일 온도의 표준편차', () => {
    expect(moodSpreadOf([])).toBe(0);
    expect(moodSpreadOf([{ temp: 0.5 }, { temp: 0.5 }])).toBe(0);
    expect(moodSpreadOf([{ temp: 0.5 }, { temp: -0.5 }])).toBeCloseTo(0.5);
    expect(moodSpreadOf([...Array(30).fill({ temp: 1 }), ...Array(14).fill({ temp: 0 })])).toBe(0);
  });
});

describe('렌더러 연결과 보호', () => {
  it('뿌옇지 않게 위층은 가산(add), 아래층은 곱하기(multiply)로 섞는다', () => {
    expect(rendererSource).toMatch(/top\.blendMode = 'add'/);
    expect(rendererSource).toMatch(/bottom\.blendMode = 'multiply'/);
  });

  it('물색 덧칠은 배경 바로 위·생물 뒤 레이어(atmos)에 둔다(생물 색을 덮지 않음)', () => {
    const order = [...rendererSource.matchAll(/^\s{4}(\w+): new Container\(\),/gm)].map((m) => m[1]);
    expect(order.slice(0, 3)).toEqual(['background', 'atmos', 'back']);
    expect(order.indexOf('atmos')).toBeLessThan(order.indexOf('mid'));
  });

  it('저사양은 입자만 줄이고(일반 40 → 저사양 12) 물색 덧칠은 그대로', () => {
    expect(QUALITY.normal.maxParticles).toBe(40);
    expect(QUALITY.low.maxParticles).toBeLessThan(QUALITY.normal.maxParticles);
    // atmosphere()는 품질을 받지 않는다 → 저사양에서도 같은 물색
    expect(atmosphere.length).toBe(1);
  });

  it('기본 렌더링은 분위기(atmos-1), 엔진 버전·골든 해시는 그대로', () => {
    expect(RENDER_STYLE).toBe('atmos-1');
    expect(ENGINE_VERSION).toBe('0.2.0');
    expect(TankSession.replay(littlePrinceConfig(), littlePrinceEntries())).toBe(GOLDEN_REPLAY[ENGINE_VERSION]);
  });

  it('자동 비교: 감정 쌍 물색 차이는 분위기 렌더링에서 커지고, 시드 쌍(같은 감정)은 0 그대로', () => {
    const g = waterGaps(runVisualSet());
    for (const day of [14, 100, 200] as const) {
      const v0 = g.find((x) => x.day === day && x.style === 'v0')!;
      const at = g.find((x) => x.day === day && x.style === 'atmos-1')!;
      expect(at.emotionMean).toBeGreaterThan(v0.emotionMean); // 자동 참고값: 커지기만 확인(사람 평가로 판단)
      expect(at.seedMean).toBe(0);
      expect(v0.seedMean).toBe(0);
    }
  });
});
