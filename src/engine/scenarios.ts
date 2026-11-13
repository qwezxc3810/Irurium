import { addDays } from './dates';
import { seedFromString } from './random';
import type { TankConfig } from './types';
import type { NewEntry } from './session';

/**
 * 시뮬레이션 사례(v0.3 설계서 2장, v0.3.1 수정 노트 6장).
 * 데모 버튼과 테스트가 같은 데이터를 쓴다.
 */

export function littlePrinceConfig(startDate = '2026-11-13', seedText = 'little-prince-7f3a'): TankConfig {
  return {
    tankId: 'tank-little-prince',
    seed: seedFromString(seedText),
    themeId: 'starlit-desert',
    goal: { type: 'amount', totalUnits: 140, dailyTarget: 10 },
    startDate,
  };
}

interface Day { day: number; pages: [number, number]; chips: string[]; note: string; time?: string }

const LITTLE_PRINCE_DAYS: Day[] = [
  { day: 1, pages: [1, 12], chips: ['설렘'], note: '어릴 때 읽던 그 책' },
  { day: 2, pages: [13, 22], chips: ['차분함'], note: '' },
  { day: 3, pages: [23, 30], chips: ['유쾌함'], note: '왕 너무 웃김ㅋㅋ' },
  { day: 4, pages: [31, 42], chips: ['답답함'], note: '장미 얄밉다 😤' },
  { day: 5, pages: [43, 58], chips: ['따뜻함'], note: '몽글몽글하다' },
  // 6일차: 쉬는 날
  { day: 7, pages: [59, 70], chips: ['그리움'], note: '여우가 길들인다는 말' },
  { day: 8, pages: [71, 78], chips: ['차분함'], note: '', time: '08:10' },
  { day: 8, pages: [79, 90], chips: ['쓸쓸함'], note: '어른이 된다는 것', time: '22:40' },
  // 9일차: 기록 없음
  { day: 10, pages: [91, 104], chips: ['쓸쓸함'], note: '장미한테 미안해졌다' },
  { day: 11, pages: [105, 112], chips: ['따뜻함'], note: '' },
  { day: 12, pages: [113, 126], chips: ['따뜻함'], note: '' },
  { day: 13, pages: [127, 134], chips: ['그리움'], note: '🥲' },
  { day: 14, pages: [135, 140], chips: ['따뜻함'], note: '결국 나를 길들인 건 이 책' },
];

export function littlePrinceEntries(startDate = '2026-11-13'): NewEntry[] {
  return LITTLE_PRINCE_DAYS.map((d, i) => ({
    clientId: `lp-${i + 1}`,
    localDate: addDays(startDate, d.day - 1),
    amount: d.pages[1] - d.pages[0] + 1,
    progressValue: d.pages[1],
    moodChips: d.chips,
    note: d.note,
  }));
}
