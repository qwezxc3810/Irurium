import { describe, expect, it } from 'vitest';
import { computeMoss, setRestDays, weekdayMask } from '../moss';
import type { RestRule } from '../types';

// 2026-11-01은 일요일. 표의 번호는 v0.3.2 보완서 4.4의 테스트 사례 번호.
const NONE = 0;
const WEEKEND = weekdayMask([0, 6]);
const WED = weekdayMask([3]);

function moss(last: string, today: string, rules: RestRule[], lifecycle: 'active' | 'completed' = 'active') {
  return computeMoss({ lifecycle, lastActivityDate: last, today, rules });
}

describe('이끼 계산', () => {
  it('T1 빠진 날 2 → 0단계', () => {
    expect(moss('2026-11-02', '2026-11-05', [{ weekdays: NONE, effectiveFrom: '2026-10-01' }])).toMatchObject({ missedDays: 2, stage: 0 });
  });
  it('T2 빠진 날 3 → 1단계', () => {
    expect(moss('2026-11-02', '2026-11-06', [{ weekdays: NONE, effectiveFrom: '2026-10-01' }]).stage).toBe(1);
  });
  it('T3 주말 휴식은 세지 않는다', () => {
    expect(moss('2026-11-06', '2026-11-10', [{ weekdays: WEEKEND, effectiveFrom: '2026-10-01' }]).missedDays).toBe(1);
  });
  it('T4 오래 쉬면 3단계 + 쉬는 중', () => {
    expect(moss('2026-10-01', '2026-11-13', [{ weekdays: NONE, effectiveFrom: '2026-10-01' }])).toMatchObject({ stage: 3, resting: true });
  });
  it('T5 쉬는 날 이력: 그날 적용되던 규칙으로 계산한다', () => {
    const rules = [{ weekdays: WEEKEND, effectiveFrom: '2026-10-01' }, { weekdays: NONE, effectiveFrom: '2026-11-09' }];
    expect(moss('2026-10-30', '2026-11-15', rules)).toMatchObject({ missedDays: 11, stage: 2 });
  });
  it('T6 같은 날 두 번 바꾸면 규칙은 하나, 마지막 값', () => {
    let rules: RestRule[] = [{ weekdays: NONE, effectiveFrom: '2026-10-01' }];
    rules = setRestDays(rules, '2026-11-10', WED);
    rules = setRestDays(rules, '2026-11-10', WEEKEND);
    expect(rules).toHaveLength(2);
    expect(rules[1]).toEqual({ weekdays: WEEKEND, effectiveFrom: '2026-11-10' });
  });
  it('T7 여러 번 바꾼 이력', () => {
    const rules = [
      { weekdays: NONE, effectiveFrom: '2026-10-01' },
      { weekdays: WED, effectiveFrom: '2026-11-03' },
      { weekdays: WEEKEND, effectiveFrom: '2026-11-09' },
    ];
    expect(moss('2026-11-02', '2026-11-12', rules)).toMatchObject({ missedDays: 8, stage: 2 });
  });
  it('T8 오늘이 마지막 기록보다 이르면(서쪽 이동) 0', () => {
    expect(moss('2026-11-12', '2026-11-11', [{ weekdays: NONE, effectiveFrom: '2026-10-01' }]).stage).toBe(0);
  });
  it('T11 완성 어항은 항상 0단계', () => {
    expect(moss('2026-10-01', '2026-11-13', [{ weekdays: NONE, effectiveFrom: '2026-10-01' }], 'completed')).toMatchObject({ stage: 0, resting: false });
  });
  it('T14 기록 없는 새 어항은 시작일 기준', () => {
    expect(moss('2026-11-08', '2026-11-13', [{ weekdays: NONE, effectiveFrom: '2026-11-08' }]).missedDays).toBe(4);
  });
  it('T16 아주 오래 쉬어도 14에서 계산을 멈춘다', () => {
    expect(moss('2025-01-01', '2026-11-13', [{ weekdays: weekdayMask([0, 1, 2, 3, 4, 5]), effectiveFrom: '2025-01-01' }]).stage).toBe(3);
  });
  it('일주일 전부를 쉬는 날로 고를 수 없다', () => {
    expect(() => setRestDays([], '2026-11-13', weekdayMask([0, 1, 2, 3, 4, 5, 6]))).toThrow();
  });
});
