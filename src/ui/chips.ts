/**
 * 대표 감정 고르기(0.3.0): 처음 누른 칩이 대표(맨 앞). 고른 칩을 다시 누르면 대표가 되고, 대표를 다시 누르면 빠진다.
 * 엔진은 moodChips[0]을 대표 감정으로 읽는다(representativeEmotion).
 */
export function toggleChip(cs: readonly string[], c: string): string[] {
  if (!cs.includes(c)) return [...cs, c];
  if (cs[0] === c) return cs.slice(1);
  return [c, ...cs.filter((x) => x !== c)];
}
