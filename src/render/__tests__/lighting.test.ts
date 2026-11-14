import { describe, expect, it } from 'vitest';
import { applyGrade, chroma, gradedWater, legacyWater, lightGrade } from '../lighting';

/** 감정 조명 색 보정(덧칠 대신). 엔진과 무관한 표시 규칙 */
const WATER = [0x04, 0x38, 0x77] as const;

describe('감정 조명 색 보정', () => {
  it('중립이면 색이 그대로다', () => {
    expect(applyGrade(WATER, lightGrade({ temp: 0, energy: 0 }))).toEqual([...WATER]);
    expect(lightGrade({ temp: 0, energy: 0 }).glow.alpha).toBe(0);
  });

  it('따뜻하면 붉은기가 늘고 푸른기가 줄며, 차가우면 반대', () => {
    const warm = lightGrade({ temp: 0.8, energy: 0 }).gains;
    const cool = lightGrade({ temp: -0.6, energy: 0 }).gains;
    expect(warm[0]).toBeGreaterThan(1);
    expect(warm[2]).toBeLessThan(1);
    expect(cool[0]).toBeLessThan(1);
    expect(cool[2]).toBeGreaterThan(1);
  });

  it('따뜻한 물빛이 이전(덧칠)보다 탁해지지 않는다: 채도가 유지된다', () => {
    for (const temp of [0.4, 0.6, 0.8, 1]) {
      const light = { temp, energy: 0 };
      const water = chroma(applyGrade(WATER, lightGrade(light))); // 빛이 닿지 않은 물
      const screen = chroma(gradedWater(WATER, light)); // 왼쪽 위 빛까지 섞은 화면 평균
      const before = chroma(legacyWater(WATER, light));
      expect(water, `temp ${temp}`).toBeGreaterThan(chroma(WATER) * 0.8); // 물 자체는 원래 채도의 80% 이상
      expect(screen - before, `temp ${temp}`).toBeGreaterThan(0.2); // 화면 평균도 이전 덧칠보다 확실히 선명(채도 +0.2 이상)
    }
  });

  it('행렬 값이 안전한 범위(밝기·채도 제한)', () => {
    for (const temp of [-1, -0.5, 0, 0.5, 1]) for (const energy of [-1, 0, 1]) {
      const g = lightGrade({ temp, energy });
      expect(g.matrix).toHaveLength(20);
      expect(g.brightness).toBeGreaterThanOrEqual(0.85);
      expect(g.brightness).toBeLessThanOrEqual(1.15);
      expect(g.saturation).toBeGreaterThanOrEqual(0.7);
      expect(g.saturation).toBeLessThanOrEqual(1.25);
    }
  });
});
