import { describe, expect, it } from 'vitest';
import { turnScale } from '../util';

describe('물고기 방향 전환', () => {
  for (const dir of [1, -1] as const) {
    it(`${dir === 1 ? '오른쪽→왼쪽' : '왼쪽→오른쪽'}: 시작은 지금 방향, 끝은 새 방향`, () => {
      expect(turnScale(dir, 0)).toBeCloseTo(dir);
      expect(turnScale(dir, 1)).toBeCloseTo(-dir);
      expect(turnScale(dir, 0.5)).toBeCloseTo(0);
    });

    it(`${dir === 1 ? '오른쪽→왼쪽' : '왼쪽→오른쪽'}: 프레임 사이 값이 튀지 않는다`, () => {
      // 회전 직전 프레임(=dir) → 회전 중 → 회전 직후 프레임(=새 dir)까지 한 프레임 변화량이 작아야 한다
      const frames = [dir, ...Array.from({ length: 34 }, (_, i) => turnScale(dir, (i + 1) / 34)), -dir];
      for (let i = 1; i < frames.length; i++) {
        expect(Math.abs(frames[i]! - frames[i - 1]!)).toBeLessThan(0.1);
      }
    });
  }
});
