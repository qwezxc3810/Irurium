import { MOSS } from './config';
import { addDays, weekday } from './dates';
import type { ISODate, Lifecycle, RestRule } from './types';

/**
 * 유리 이끼 계산(v0.3.2 보완서 4장). 저장하지 않는 계산값이고 생태계와 무관하다.
 * 쉬는 날은 변경 이력으로 들어오며, 각 날짜는 그날 적용되던 규칙으로 판정한다.
 */

export interface MossResult {
  missedDays: number;
  stage: 0 | 1 | 2 | 3;
  resting: boolean;
}

/** effectiveFrom 오름차순으로 정렬된 규칙에서 d에 적용되는 것. */
export function ruleFor(rules: RestRule[], d: ISODate): RestRule | undefined {
  let found: RestRule | undefined;
  for (const r of rules) if (r.effectiveFrom <= d) found = r;
  return found;
}

export function isRestDay(rules: RestRule[], d: ISODate): boolean {
  const r = ruleFor(rules, d);
  return !!r && ((r.weekdays >> weekday(d)) & 1) === 1;
}

/**
 * 쉬는 날 바꾸기. 오늘 날짜 규칙이 이미 있으면 그것만 바꾸고, 없으면 새로 추가한다.
 * 지난 규칙은 고치지 않는다. 일주일 전부를 쉬는 날로 고를 수 없다(최대 6일).
 */
export function setRestDays(rules: RestRule[], today: ISODate, weekdays: number): RestRule[] {
  const days = [0, 1, 2, 3, 4, 5, 6].filter((i) => (weekdays >> i) & 1).length;
  if (days > 6) throw new Error('rest_days_max_6');
  const sorted = [...rules].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const last = sorted[sorted.length - 1];
  if (last && last.effectiveFrom === today) return [...sorted.slice(0, -1), { weekdays, effectiveFrom: today }];
  if (last && last.effectiveFrom > today) throw new Error('rule_in_future');
  return [...sorted, { weekdays, effectiveFrom: today }];
}

export function computeMoss(p: {
  lifecycle: Lifecycle;
  /** 기록들의 가장 늦은 localDate(숨긴 기록 포함). 없으면 어항 시작일. */
  lastActivityDate: ISODate;
  /** 현재 시간대 기준 오늘 */
  today: ISODate;
  rules: RestRule[];
}): MossResult {
  if (p.lifecycle !== 'active') return { missedDays: 0, stage: 0, resting: false };
  const rules = [...p.rules].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  let missed = 0;
  // 마지막 활동일과 오늘 사이의 날만 센다(양쪽 제외). 오늘은 아직 기록할 수 있으므로 제외.
  let guard = 0;
  for (let d = addDays(p.lastActivityDate, 1); d < p.today && guard < 4000; d = addDays(d, 1), guard++) {
    if (!isRestDay(rules, d)) missed++;
    if (missed >= MOSS.stage3) break;
  }
  const stage = missed >= MOSS.stage3 ? 3 : missed >= MOSS.stage2 ? 2 : missed >= MOSS.stage1 ? 1 : 0;
  return { missedDays: missed, stage, resting: missed >= MOSS.stage3 };
}

export function weekdayMask(days: number[]): number {
  return days.reduce((m, d) => m | (1 << d), 0);
}
