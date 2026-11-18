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
