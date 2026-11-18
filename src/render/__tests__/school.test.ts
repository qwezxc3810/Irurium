import './nodeGlobals'; // 반드시 pixi.js보다 먼저
import { describe, expect, it } from 'vitest';
import { Texture } from 'pixi.js';
import { FishView } from '../FishView';
import { SCHOOL_MEMBERS, School, memberPosition, schoolExtraHalfWidth, schoolSize } from '../school';
import type { PlacedObject, TankState } from '../../engine/types';

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

// ───────── 실제 FishView로 돌리는 무리(리뷰 반영: 성장 순간·벽 인접·움직임 줄이기) ─────────
const SPEC = { src: '', displayWidth: 58, swim: { amplitude: 0.11, frequency: 1.6 } };
const STATE = { behavior: { speed: 1.2, depth: 0 } } as unknown as TankState;
const trace = (stage: number, x = 500): PlacedObject => ({ id: 'o7', el: 'emotion.fish-school', kind: 'emotion', layer: 'floor', x, y: 548, scale: 1 + (stage - 1) * 0.15, tint: 0, bornSeq: 1, stage });
const newSchool = () => new School((o, laneY, extra) => new FishView(o, Texture.WHITE, SPEC, laneY, { extraHalfWidth: extra }), 330);
const run = (sc: School, seconds: number, rm = false) => { for (let t = 0; t < seconds; t += 1 / 60) sc.tick(1 / 60, STATE, rm); };

describe('무리 + 실제 FishView', () => {
  it('리뷰 회귀 1: 3→4→5마리로 자라면 기존 멤버도 모두 같은 크기가 된다(id·꼬리 박자 유지)', () => {
    const sc = newSchool();
    sc.sync(trace(1), false);
    run(sc, 3);
    const ids = sc.members.map((f) => f.obj.id);
    for (const stage of [2, 3]) {
      sc.sync(trace(stage), false);
      run(sc, 2); // 크기 변화(tween) 끝날 때까지
      const scales = sc.members.map((f) => f.root.scale.x);
      expect(sc.members).toHaveLength(2 + stage);
      expect(Math.max(...scales) - Math.min(...scales)).toBeLessThan(1e-6);
      expect(sc.members.every((f) => f.obj.scale === 1 + (stage - 1) * 0.15)).toBe(true);
    }
    expect(sc.members.slice(0, 3).map((f) => f.obj.id)).toEqual(ids);
    expect(new Set(sc.members.map((f) => f.obj.id)).size).toBe(5);
  });

  it('리뷰 회귀 2: 왼쪽 벽 가까이서 1→2단계로 커져도(대열 폭 34→64) 무리가 새 안전 범위로 부드럽게 들어오고, 이후 벽 안에 머문다', () => {
    const sc = newSchool();
    sc.sync(trace(1, 104), false);
    const leader = sc.members[0]!;
    leader.root.x = 70 + 34; // 단계1 안전 범위의 왼쪽 끝
    sc.sync(trace(2), false);
    const xs: number[] = [];
    for (let t = 0; t < 3; t += 1 / 60) {
      sc.tick(1 / 60, STATE, false);
      xs.push(leader.root.x);
    }
    // 한 프레임에 크게 튀지 않음(부드럽게), 결국 새 범위(70 + 64) 안
    for (let i = 1; i < xs.length; i++) expect(Math.abs(xs[i]! - xs[i - 1]!)).toBeLessThan(6);
    expect(leader.root.x).toBeGreaterThanOrEqual(70 + 64 - 1);
    run(sc, 120);
    for (const f of sc.members) {
      expect(f.root.x).toBeGreaterThanOrEqual(70 - 1e-6);
      expect(f.root.x).toBeLessThanOrEqual(930 + 1e-6);
    }
  });

  it('리뷰 회귀 2: 움직임 줄이기에서 커지면 바로 새 안전 범위로 옮기고, 새 멤버도 그 자리 기준(벽 안)', () => {
    const sc = newSchool();
    sc.sync(trace(1, 104), true);
    sc.members[0]!.root.x = 70 + 34;
    sc.sync(trace(3), true);
    expect(sc.members[0]!.root.x).toBe(70 + 64);
    run(sc, 1, true);
    for (const f of sc.members) {
      expect(f.root.x).toBeGreaterThanOrEqual(70 - 1e-6);
      expect(f.root.x).toBeLessThanOrEqual(930 + 1e-6);
    }
  });

  it('오래 헤엄쳐도 대열이 유지된다(실제 벽 회전 포함)', () => {
    const sc = newSchool();
    sc.sync(trace(3, 45), false);
    for (let t = 0; t < 300; t += 1 / 60) {
      sc.tick(1 / 60, STATE, false);
      const L = sc.members[0]!;
      sc.members.forEach((f, k) => {
        expect(Math.abs(f.root.x - L.root.x)).toBeLessThanOrEqual(Math.abs(SCHOOL_MEMBERS[k]![0]) + 1e-6);
        expect(f.root.x).toBeGreaterThanOrEqual(70 - 1e-6);
        expect(f.root.x).toBeLessThanOrEqual(930 + 1e-6);
      });
    }
  });
});
