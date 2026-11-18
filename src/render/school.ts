import type { FishView } from './FishView';
import type { PlacedObject, TankState } from '../engine/types';

/**
 * 신남 물고기 떼(0.3.0 감정 흔적)의 대열. 렌더러 전용, 엔진과 무관.
 * 이끄는 물고기(0번) 하나가 경로·방향·회전을 정하고, 나머지는 이끄는 물고기 기준 상대 자리에서 따른다.
 * 방향(facing)이 -1 ~ 1로 부드럽게 바뀌면 대열의 앞뒤도 그만큼 거울처럼 돌아, 회전할 때 무리가 함께 돈다.
 */
export const SCHOOL_MEMBERS: Array<[number, number]> = [[0, 0], [-34, -16], [-30, 18], [-64, 2], [-62, -26]];

/** 단계(1~3) → 마리 수 3~5 */
export function schoolSize(stage: number | undefined): number {
  return Math.min(SCHOOL_MEMBERS.length, 2 + (stage ?? 1));
}

/** k번째 물고기 자리. dx는 '뒤쪽' 기준(-)이라 바라보는 방향을 곱해 늘 이끄는 물고기 뒤에 온다 */
export function memberPosition(leader: { x: number; y: number }, facing: number, k: number): { x: number; y: number } {
  const [dx, dy] = SCHOOL_MEMBERS[k] ?? [0, 0];
  return { x: leader.x + dx * facing, y: leader.y + dy };
}

/** 대열이 이끄는 물고기 좌우로 차지하는 폭(벽 판정에 더함). 지금 마리 수 기준 */
export function schoolExtraHalfWidth(size: number): number {
  return Math.max(0, ...SCHOOL_MEMBERS.slice(0, size).map(([dx]) => Math.abs(dx)));
}

/**
 * 무리 하나를 관리한다(렌더러가 쓰고, 테스트는 실제 FishView로 돌린다).
 * - 0번(이끄는 물고기)만 경로·벽 판정·회전, 나머지는 follow()로 0번 기준 자리·방향을 따름
 * - 단계가 오르면: 모든 멤버의 크기를 새 단계로(각자 id·꼬리 박자는 유지), 대열 폭을 넓히고 0번을 새 안전 범위로 옮긴 뒤
 *   새 멤버는 보정된 무리 자리에서 합류. 움직임 줄이기면 즉시, 아니면 0번이 부드럽게 들어옴
 */
export class School {
  readonly members: FishView[] = [];

  /** make(obj, laneY, extraHalfWidth): 화면에 붙은 FishView를 만든다(누르기·레이어는 만드는 쪽이 처리) */
  constructor(private make: (obj: PlacedObject, laneY: number, extraHalfWidth: number) => FishView, private laneY: number) {}

  /** 논리 오브젝트(감정 흔적)에 맞춘다. 새로 만든 멤버 수를 돌려준다 */
  sync(obj: PlacedObject, reducedMotion: boolean): number {
    const want = schoolSize(obj.stage);
    const fishObj: PlacedObject = { ...obj, kind: 'fish', tint: 0 };
    if (this.members.length > want) this.destroy();
    if (this.members.length === 0) {
      this.members.push(this.make(fishObj, this.laneY, schoolExtraHalfWidth(want)));
    } else {
      // 기존 멤버 모두 새 크기로(각자 id·자리는 유지 → 꼬리 박자·기억 카드 연결 그대로)
      this.members.forEach((f, k) => f.update(k === 0 ? fishObj : { ...fishObj, id: f.obj.id, x: f.obj.x }, k === 0 ? this.laneY : f.laneY));
      if (this.members.length < want) this.members[0]!.setExtraHalfWidth(schoolExtraHalfWidth(want), reducedMotion);
    }
    const leader = this.members[0]!;
    let added = 0;
    for (let k = this.members.length; k < want; k++) {
      const pos = memberPosition(leader.root.position, leader.facing, k);
      const f = this.make({ ...fishObj, id: `${obj.id}#${k}`, x: pos.x }, pos.y, 0);
      f.root.position.set(pos.x, pos.y);
      this.members.push(f);
      added += 1;
    }
    return added;
  }

  tick(dt: number, state: TankState, reducedMotion: boolean) {
    const leader = this.members[0];
    if (!leader) return;
    leader.tick(dt, state, reducedMotion);
    this.place(dt, state, reducedMotion);
  }

  settle(state: TankState) {
    const leader = this.members[0];
    if (!leader) return;
    leader.settle(state);
    for (const f of this.members.slice(1)) f.settle(state);
    this.place(0, state, true);
  }

  private place(dt: number, state: TankState, reducedMotion: boolean) {
    const leader = this.members[0]!;
    for (let k = 1; k < this.members.length; k++) {
      const pos = memberPosition(leader.root.position, leader.facing, k);
      this.members[k]!.follow(dt, state, reducedMotion, pos.x, pos.y, leader.facing);
    }
  }

  destroy() {
    for (const f of this.members) f.destroy();
    this.members.length = 0;
  }
}
