import type { ISODate } from './types';

/**
 * 날짜는 시간대가 없는 'YYYY-MM-DD' 문자열로만 계산한다.
 * Date의 현지 시각 메서드(getDate 등)는 쓰지 않는다(시간대·서머타임 오류 방지).
 */

function toUTC(d: ISODate): number {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, day);
}

function fromUTC(ms: number): ISODate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(d: ISODate, n: number): ISODate {
  return fromUTC(toUTC(d) + n * 86_400_000);
}

/** 0 = 일요일 … 6 = 토요일 */
export function weekday(d: ISODate): number {
  return new Date(toUTC(d)).getUTCDay();
}

export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((toUTC(b) - toUTC(a)) / 86_400_000);
}

/** 특정 IANA 시간대에서 그 순간의 날짜. */
export function localDateIn(ms: number, timeZone: string): ISODate {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
  return parts;
}

export function maxDate(a: ISODate | null, b: ISODate): ISODate {
  if (!a) return b;
  return a > b ? a : b;
}
