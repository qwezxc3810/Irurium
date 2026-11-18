import { describe, expect, it } from 'vitest';
import { SCHOOL_MEMBERS, memberPosition, schoolExtraHalfWidth, schoolSize } from '../school';

const BOUNDS = { left: 70, right: 930 }; // FishView와 같은 값

describe('신남 물고기 떼 대열 (리뷰 반영: 이끄는 물고기 하나가 경로·방향을 정함)', () => {
  it('단계 1→3 = 3→5마리', () => {
    expect([1, 2, 3, undefined].map(schoolSize)).toEqual([3, 4, 5, 3]);
  });

  it('따르는 물고기는 늘 이끄는 물고기 뒤에 온다(방향이 바뀌면 거울처럼 돈다)', () => {
    const L = { x: 500, y: 330 };
    for (let k = 1; k < 5; k++) {
      expect(memberPosition(L, 1, k).x).toBeLessThan(L.x); // 오른쪽을 보면 왼쪽(뒤)에
      expect(memberPosition(L, -1, k).x).toBeGreaterThan(L.x); // 왼쪽을 보면 오른쪽(뒤)에
      expect(memberPosition(L, 0, k).x).toBe(L.x); // 도는 한가운데서는 이끄는 물고기 줄로 모였다가 반대편으로
      expect(memberPosition(L, 1, k).y).toBe(L.y + SCHOOL_MEMBERS[k]![1]);
    }
  });

  it('대열 폭을 벽 판정에 더하므로, 이끄는 물고기가 벽 끝에서 돌아도 모든 물고기가 벽 안에 있다(낮은 x 슬롯 포함)', () => {
    for (const size of [3, 4, 5]) {
      const extra = schoolExtraHalfWidth(size);
      for (const leaderX of [BOUNDS.left + extra, BOUNDS.right - extra]) {
        for (let f = -1; f <= 1.0001; f += 0.1) {
          for (let k = 0; k < size; k++) {
            const x = memberPosition({ x: leaderX, y: 0 }, f, k).x;
            expect(x).toBeGreaterThanOrEqual(BOUNDS.left - 1e-9);
            expect(x).toBeLessThanOrEqual(BOUNDS.right + 1e-9);
          }
        }
      }
    }
  });

  it('시간이 지나도·벽에서 돌아도 대열이 갈라지지 않는다(이끄는 물고기 경로 흉내: 벽에서 회전)', () => {
    const extra = schoolExtraHalfWidth(5);
    let x = 45; // 왼쪽 끝 슬롯에서 시작해도 벽 안으로
    x = Math.max(BOUNDS.left + extra, x);
    let dir = 1;
    let turning = 0;
    for (let step = 0; step < 20000; step++) {
      const facing = turning > 0 ? dir * Math.cos(Math.PI * Math.min(1, turning)) : dir;
      if (turning > 0) {
        turning += 0.016 / 0.55;
        if (turning >= 1) { dir = -dir; turning = 0; }
      }
      x = Math.max(BOUNDS.left + extra, Math.min(BOUNDS.right - extra, x + dir * 40 * 0.016 * (turning > 0 ? 0.25 : 1)));
      if (turning === 0 && ((dir === 1 && x + 30 + extra >= BOUNDS.right) || (dir === -1 && x - 30 - extra <= BOUNDS.left))) turning = 0.0001;
      const ps = [0, 1, 2, 3, 4].map((k) => memberPosition({ x, y: 330 }, facing, k));
      // 대열: 모든 물고기가 이끄는 물고기에서 정해진 거리 안(갈라지지 않음), 벽 안
      for (const [k, p] of ps.entries()) {
        expect(Math.abs(p.x - x)).toBeLessThanOrEqual(Math.abs(SCHOOL_MEMBERS[k]![0]) + 1e-9);
        expect(p.x).toBeGreaterThanOrEqual(BOUNDS.left - 1e-9);
        expect(p.x).toBeLessThanOrEqual(BOUNDS.right + 1e-9);
      }
    }
  });

  it('마리가 늘면 새 물고기는 지금 무리 자리(이끄는 물고기 기준)에서 합류한다', () => {
    const leaderNow = { x: 812, y: 300 };
    const joined = memberPosition(leaderNow, -1, 3);
    expect(joined.x).toBe(812 + 64);
    expect(joined.y).toBe(302);
  });
});
