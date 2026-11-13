import { addDays, weekday } from '../engine/dates';
import { seedFromString } from '../engine/random';
import { littlePrinceConfig, littlePrinceEntries } from '../engine/scenarios';
import type { TankConfig } from '../engine/types';
import { SAMPLE_PREFIX, type SampleScenario, type SampleTank, type ScriptedEntry } from './types';

/**
 * 검증용 샘플(가상 관장) 기록. 모두 임의로 만든 데이터이고 실제 사용자 기록이 아니다.
 * 근거: v0.3.1 수정 노트 6.2 검증 사례 A~F, 6.1 가설 H1~H11.
 * 같은 책(140쪽, 하루 목표 10쪽)·같은 기간(14일)을 기본으로 두고, 한 번에 한 가지만 바꾼다.
 */

export const LAB_START = '2026-11-13';
const BOOK_TOTAL = 140;
const BOOK_DAILY = 10;
const TIMES_BY_COUNT: Record<number, string[]> = {
  1: ['21:00'],
  2: ['08:10', '22:40'],
  3: ['08:00', '12:30', '22:30'],
  5: ['08:00', '11:00', '14:00', '18:00', '22:00'],
};

function timesFor(n: number): string[] {
  return TIMES_BY_COUNT[n] ?? Array.from({ length: n }, (_, i) => `${String(8 + i * 2).padStart(2, '0')}:00`);
}

export function bookCfg(key: string, seedText: string, total = BOOK_TOTAL, daily = BOOK_DAILY): TankConfig {
  return {
    tankId: `${SAMPLE_PREFIX}${key}`,
    seed: seedFromString(seedText),
    themeId: 'starlit-desert',
    goal: { type: 'amount', totalUnits: total, dailyTarget: daily },
    startDate: LAB_START,
  };
}

export function freeCfg(key: string, seedText: string): TankConfig {
  return {
    tankId: `${SAMPLE_PREFIX}${key}`,
    seed: seedFromString(seedText),
    themeId: 'starlit-desert',
    goal: { type: 'free', totalUnits: null, dailyTarget: null },
    startDate: LAB_START,
  };
}

/** 하루치 기록 계획. records마다 감정 칩·한마디. */
interface DayPlan {
  day: number;
  records: Array<{ chips: string[]; note?: string; pages?: number }>;
}

/** 분량형(독서) 기록 만들기. pages를 안 주면 그날 pagesPerDay를 기록 수로 나눈다. 진행은 총 쪽수에서 멈춘다. */
function bookEntries(key: string, plans: DayPlan[], pagesPerDay: number, total = BOOK_TOTAL): ScriptedEntry[] {
  const out: ScriptedEntry[] = [];
  let progress = 0;
  for (const p of plans) {
    const times = timesFor(p.records.length);
    const each = Math.floor(pagesPerDay / p.records.length);
    p.records.forEach((r, i) => {
      if (progress >= total) return;
      const want = r.pages ?? (i === p.records.length - 1 ? pagesPerDay - each * (p.records.length - 1) : each);
      const pages = Math.min(want, total - progress);
      progress += pages;
      out.push({
        clientId: `${SAMPLE_PREFIX}${key}:${out.length + 1}`,
        localDate: addDays(LAB_START, p.day - 1),
        time: times[i] ?? '21:00',
        amount: pages,
        progressValue: progress,
        moodChips: r.chips,
        note: r.note ?? '',
      });
    });
  }
  return out;
}

/** 자유형 기록(분량 = 분). 쪽수가 없다. */
function freeEntries(key: string, plans: DayPlan[], minutes = 30): ScriptedEntry[] {
  const out: ScriptedEntry[] = [];
  for (const p of plans) {
    const times = timesFor(p.records.length);
    p.records.forEach((r, i) => {
      out.push({
        clientId: `${SAMPLE_PREFIX}${key}:${out.length + 1}`,
        localDate: addDays(LAB_START, p.day - 1),
        time: times[i] ?? '21:00',
        amount: r.pages ?? minutes,
        progressValue: null,
        moodChips: r.chips,
        note: r.note ?? '',
      });
    });
  }
  return out;
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const daily = (days: number, chipsFor: (day: number) => string[]): DayPlan[] => range(1, days).map((day) => ({ day, records: [{ chips: chipsFor(day) }] }));

const EMOTIONS = ['따뜻함', '쓸쓸함', '유쾌함', '답답함', '차분함'] as const;
const DAYS_14 = range(1, 14);

// ───────────────────────── 사례 A~F ─────────────────────────

function caseA(): SampleScenario {
  const tanks: SampleTank[] = range(1, 5).map((i) => {
    const key = `A${i}`;
    const plans = daily(14, (day) => {
      if ((day + i) % 4 === 0) return ['차분함'];
      if ((day * 3 + i) % 7 === 0) return ['설렘'];
      return ['따뜻함'];
    });
    return {
      key, label: `관장 ${i} · 따뜻함 중심`, cfg: bookCfg(key, `sample:A:${i}`), days: 14,
      entries: bookEntries(key, plans, BOOK_DAILY), finishOnLastPage: true, tags: { group: 'similar' },
    };
  });
  return {
    id: 'case-A', group: 'case', origin: 'sample', title: 'A. 감정이 비슷한 5명',
    summary: '같은 책 14일. 모두 따뜻함 중심에 차분함·설렘을 조금씩 섞음. 시드만 다름.',
    watch: '분위기(물빛·물고기 종류)는 비슷하고 배치·형태는 달라야 해요. 다섯 어항이 서로 "내 것"처럼 구별되나요?',
    hypotheses: ['H7', 'H6'], tanks, checkpoints: DAYS_14,
  };
}

function caseB(): SampleScenario {
  const tanks: SampleTank[] = EMOTIONS.map((emo, i) => {
    const key = `B${i + 1}`;
    return {
      key, label: `관장 ${i + 1} · ${emo}만`, cfg: bookCfg(key, `sample:B:${i + 1}`), days: 14,
      entries: bookEntries(key, daily(14, () => [emo]), BOOK_DAILY), finishOnLastPage: true, tags: { group: 'extreme', emotion: emo },
    };
  });
  return {
    id: 'case-B', group: 'case', origin: 'sample', title: 'B. 감정이 극단적으로 다른 5명',
    summary: '같은 책 14일. 각자 따뜻함 / 쓸쓸함 / 유쾌함 / 답답함 / 차분함 한 가지만. 시드도 다름.',
    watch: '한눈에 달라 보여야 해요. "짝짓기 테스트" 탭에서 그림만 보고 감정을 맞혀 보세요(5개 중 4개 이상이 기준).',
    hypotheses: ['H1', 'H3', 'H7'], tanks, checkpoints: DAYS_14,
  };
}

function caseC(): SampleScenario {
  const src = littlePrinceEntries(LAB_START);
  const perDate = new Map<string, number>();
  for (const e of src) perDate.set(e.localDate, (perDate.get(e.localDate) ?? 0) + 1);
  const seen = new Map<string, number>();
  const entries: ScriptedEntry[] = src.map((e, i) => {
    const n = seen.get(e.localDate) ?? 0;
    seen.set(e.localDate, n + 1);
    return { ...e, clientId: `${SAMPLE_PREFIX}C:${i + 1}`, time: timesFor(perDate.get(e.localDate) ?? 1)[n] ?? '21:00' };
  });
  const cfg: TankConfig = { ...littlePrinceConfig(LAB_START), tankId: `${SAMPLE_PREFIX}C` };
  return {
    id: 'case-C', group: 'case', origin: 'sample', title: 'C. 14일 독서(어린왕자)',
    summary: 'v0.3 설계서 2장의 어린왕자 기록 그대로. 6일차 쉬고, 8일차에 두 번, 9일차 빠짐, 14일차 완독.',
    watch: '성장 7~10회, 특별 변화 3회, 14일 뒤에도 상한의 절반 이하인지.',
    hypotheses: ['H4', 'H5'],
    tanks: [{ key: 'C', label: '어린왕자 140쪽', cfg, entries, days: 14, finishOnLastPage: true }],
    checkpoints: DAYS_14,
  };
}

function caseD(): SampleScenario {
  const plans: DayPlan[] = range(1, 150)
    .filter((d) => d % 5 !== 0) // 150일 중 120일 기록
    .map((day) => {
      let chips: string[];
      if (day <= 50) chips = day % 3 === 0 ? ['답답함'] : ['막막함'];
      else if (day <= 100) chips = day % 4 === 0 ? ['그리움'] : ['차분함'];
      else chips = day % 3 === 0 ? ['설렘'] : ['뿌듯함'];
      return { day, records: [{ chips }] };
    });
  return {
    id: 'case-D', group: 'case', origin: 'sample', title: 'D. 150일 장기 기록(영어 공부)',
    summary: "자유형 '영어 공부' 150일, 기록 120회. 막막함 → 차분함 → 뿌듯함으로 감정이 천천히 바뀜.",
    watch: '상한에 언제 닿는지, 포화된 뒤에도 변화가 이어지는지, 오래 쓴 어항이 어색하지 않은지.',
    hypotheses: ['H5', 'H8', 'H9', 'H11'],
    tanks: [{ key: 'D', label: '영어 공부 150일', cfg: freeCfg('D', 'sample:D'), entries: freeEntries('D', plans), days: 150 }],
    checkpoints: [1, 7, 14, 30, 50, 75, 100, 125, 150],
  };
}

function caseE(): SampleScenario {
  const c = caseC().tanks[0]!;
  const entries = c.entries.map((e, i) => ({ ...e, clientId: `${SAMPLE_PREFIX}E:${i + 1}`, moodChips: [], note: '' }));
  return {
    id: 'case-E', group: 'case', origin: 'sample', title: 'E. 감정을 입력하지 않는 관장',
    summary: 'C와 같은 쪽수·같은 날짜·같은 시드로 14일. 칩·한마디 없이 쪽수만.',
    watch: '어항이 초라하지 않고 완성된 그림인지. 중립 분위기 + 활동량 성장만으로 만족스러운지(C와 나란히 보세요).',
    hypotheses: ['H4'],
    tanks: [
      { key: 'E', label: '쪽수만 기록', cfg: { ...c.cfg, tankId: `${SAMPLE_PREFIX}E` }, entries, days: 14, finishOnLastPage: true },
      { ...c, label: '비교: C(감정 있음)' },
    ],
    checkpoints: DAYS_14,
  };
}

export const CASE_F_MULTI_DAYS = [2, 4, 7, 9, 12];

function caseF(): SampleScenario {
  const plans: DayPlan[] = DAYS_14.map((day) =>
    CASE_F_MULTI_DAYS.includes(day)
      ? { day, records: [{ chips: ['설렘'], pages: 4 }, { chips: ['답답함'], pages: 3 }, { chips: ['쓸쓸함'], pages: 3 }] }
      : { day, records: [{ chips: ['따뜻함'] }] },
  );
  return {
    id: 'case-F', group: 'case', origin: 'sample', title: 'F. 같은 날 여러 번 다른 감정',
    summary: '14일 중 5일(2·4·7·9·12일차)은 하루 3번: 아침 설렘, 점심 답답함, 밤 쓸쓸함. 나머지 날은 따뜻함 1번.',
    watch: '새 오브젝트 하루 1개 이하, 조명 하루 30% 이내, 밤 분위기가 마지막 감정 쪽으로 움직이는지, 확정 순서가 맞는지.',
    hypotheses: ['H3', 'H10'],
    tanks: [{ key: 'F', label: '하루 3번 다른 감정', cfg: bookCfg('F', 'sample:F'), entries: bookEntries('F', plans, BOOK_DAILY), days: 14, finishOnLastPage: true }],
    checkpoints: DAYS_14,
  };
}

// ───────────────────────── 비교 실험(같은 책·같은 기간, 한 가지만 바꿈) ─────────────────────────

const BASE_SEED = 'sample:compare:base';
const COMPARE_DAYS = [1, 3, 5, 7, 10, 14];

function compareEmotion(): SampleScenario {
  const variants: Array<[string, string[]]> = [...EMOTIONS.map((e) => [e, [e]] as [string, string[]]), ['감정 없음', []]];
  return {
    id: 'cmp-emotion', group: 'compare', origin: 'sample', title: '감정만 다르게',
    summary: '같은 책·같은 14일·같은 쪽수(매일 10쪽)·같은 시드. 감정만 바꿈.',
    watch: '감정이 물빛·물고기 종류·수초를 얼마나 바꾸는지. 시드가 같아도 감정이 다르면 다른 어항이어야 해요.',
    hypotheses: ['H7'],
    tanks: variants.map(([name, chips], i) => {
      const key = `CE${i + 1}`;
      return { key, label: name, cfg: bookCfg(key, BASE_SEED), entries: bookEntries(key, daily(14, () => chips), BOOK_DAILY), days: 14, finishOnLastPage: true, tags: { emotion: name } };
    }),
    checkpoints: COMPARE_DAYS,
  };
}

function compareFrequency(): SampleScenario {
  const patterns: Array<[string, number[]]> = [
    ['매일 (14일)', DAYS_14],
    ['평일만 (주 5일)', DAYS_14.filter((d) => { const w = weekday(addDays(LAB_START, d - 1)); return w >= 1 && w <= 5; })],
    ['격일 (7일)', DAYS_14.filter((d) => d % 2 === 1)],
    ['주말만 (4일)', DAYS_14.filter((d) => { const w = weekday(addDays(LAB_START, d - 1)); return w === 0 || w === 6; })],
  ];
  return {
    id: 'cmp-frequency', group: 'compare', origin: 'sample', title: '기록 빈도만 다르게',
    summary: '같은 책 140쪽을 같은 14일 동안 읽음. 기록하는 날 수만 다르고(쪽수는 나눠서 같게), 감정은 모두 따뜻함, 시드 같음.',
    watch: '자주 기록한 어항이 더 풍성한지, 드물게 기록해도 어항이 초라하지 않은지. 쉰 날에는 이끼가 보여요.',
    hypotheses: ['H4', 'H5'],
    tanks: patterns.map(([name, days], i) => {
      const key = `CF${i + 1}`;
      const per = Math.ceil(BOOK_TOTAL / days.length);
      return { key, label: name, cfg: bookCfg(key, BASE_SEED), entries: bookEntries(key, days.map((day) => ({ day, records: [{ chips: ['따뜻함'] }] })), per), days: 14, finishOnLastPage: true };
    }),
    checkpoints: COMPARE_DAYS,
  };
}

function compareActivity(): SampleScenario {
  const amounts: Array<[string, number]> = [['하루 5쪽 (목표 미달)', 5], ['하루 10쪽 (목표)', 10], ['하루 20쪽 (7일 완독)', 20]];
  return {
    id: 'cmp-activity', group: 'compare', origin: 'sample', title: '활동량만 다르게',
    summary: '같은 책·같은 14일·매일 기록·따뜻함·같은 시드. 하루 읽은 쪽수만 다름.',
    watch: '하루 목표(10쪽) 달성 보너스와 진행률 특별 변화(25·50·75%)가 차이를 만드는지. 20쪽은 7일째 완독해 완성돼요.',
    hypotheses: ['H4', 'H5'],
    tanks: amounts.map(([name, pages], i) => {
      const key = `CA${i + 1}`;
      return { key, label: name, cfg: bookCfg(key, BASE_SEED), entries: bookEntries(key, daily(14, () => ['따뜻함']), pages), days: 14, finishOnLastPage: true };
    }),
    checkpoints: COMPARE_DAYS,
  };
}

function compareSeed(): SampleScenario {
  return {
    id: 'cmp-seed', group: 'compare', origin: 'sample', title: '개인 시드만 다르게',
    summary: '같은 책·같은 14일·매일 10쪽·따뜻함. 어항을 만들 때 정해지는 개인 시드만 다름.',
    watch: '분위기는 같고 배치·형태만 달라야 해요(시드는 개성만 더함).',
    hypotheses: ['H7'],
    tanks: range(1, 5).map((i) => {
      const key = `CS${i}`;
      return { key, label: `시드 ${i}`, cfg: bookCfg(key, `sample:seed:${i}`), entries: bookEntries(key, daily(14, () => ['따뜻함']), BOOK_DAILY), days: 14, finishOnLastPage: true };
    }),
    checkpoints: COMPARE_DAYS,
  };
}

// ───────────────────────── 장기(14·30·100·200일) ─────────────────────────

function steadyChips(day: number): string[] {
  if (day <= 40) return day % 3 === 0 ? ['답답함'] : ['막막함'];
  if (day <= 80) return ['차분함'];
  if (day <= 120) return day % 2 === 0 ? ['뿌듯함'] : ['따뜻함'];
  if (day <= 160) return day % 3 === 0 ? ['그리움'] : ['쓸쓸함'];
  return day % 2 === 0 ? ['설렘'] : ['유쾌함'];
}

export const LONG_DURATIONS = [14, 30, 100, 200] as const;
export const LONG_CHECKPOINTS: Record<number, number[]> = {
  14: [1, 3, 5, 7, 10, 14],
  30: [1, 5, 10, 15, 20, 25, 30],
  100: [1, 10, 20, 30, 50, 70, 100],
  200: [1, 14, 30, 50, 100, 150, 200],
};

function longSteady(): SampleScenario {
  const plans = range(1, 200).filter((d) => (d * 7) % 20 >= 3).map((day) => ({ day, records: [{ chips: steadyChips(day) }] }));
  return {
    id: 'long-steady', group: 'long', origin: 'sample', title: '꾸준형 200일 (기록률 85%)',
    summary: "자유형 '영어 공부'. 200일 중 170일 기록. 막막함 → 차분함 → 뿌듯함 → 쓸쓸함(슬럼프) → 설렘.",
    watch: '14·30·100·200일에 어항이 어떻게 달라지는지, 포화 뒤에도 기대할 변화가 남아 있는지.',
    hypotheses: ['H5', 'H6', 'H8', 'H9', 'H11'],
    tanks: [{ key: 'LS', label: '꾸준형', cfg: freeCfg('LS', 'sample:long:steady'), entries: freeEntries('LS', plans), days: 200 }],
    checkpoints: LONG_CHECKPOINTS[200]!,
  };
}

function longSparse(): SampleScenario {
  const plans = range(1, 200).filter((d) => d % 30 < 10).map((day) => ({ day, records: [{ chips: day % 2 === 0 ? ['뿌듯함'] : ['답답함'] }] }));
  return {
    id: 'long-sparse', group: 'long', origin: 'sample', title: '띄엄형 200일 (10일 하고 20일 쉼)',
    summary: "자유형 '운동'. 30일마다 10일 기록하고 20일 쉼(200일 중 70일 기록). 답답함·뿌듯함 번갈아.",
    watch: '오래 쉬면 이끼가 끼고 돌아오면 닦이는지, 띄엄띄엄 해도 어항이 자라는 기쁨이 남는지.',
    hypotheses: ['H5', 'H4'],
    tanks: [{ key: 'LP', label: '띄엄형', cfg: freeCfg('LP', 'sample:long:sparse'), entries: freeEntries('LP', plans), days: 200 }],
    checkpoints: LONG_CHECKPOINTS[200]!,
  };
}

// ───────────────────────── 가설 실험 ─────────────────────────

/** H3: 10일 따뜻함 뒤 쓸쓸함으로 바꿨을 때 몇 번째 기록에서 눈에 띄게 바뀌나 */
export const H3_SWITCH_DAY = 11;

function expH3(): SampleScenario {
  const plans = daily(20, (d) => (d < H3_SWITCH_DAY ? ['따뜻함'] : ['쓸쓸함']));
  return {
    id: 'exp-h3', group: 'experiment', origin: 'sample', title: 'H3 감정 전환 실험',
    summary: '10일 동안 따뜻함, 11일차부터 쓸쓸함으로 바꿈(하루 1번, 자유형, 20일).',
    watch: '11일차부터 몇 번째 기록에서 물빛이 "눈에 띄게" 바뀌었다고 느끼는지 직접 판단해 주세요.',
    hypotheses: ['H3'],
    tanks: [{ key: 'H3', label: '따뜻함 → 쓸쓸함', cfg: freeCfg('H3', 'sample:h3'), entries: freeEntries('H3', plans), days: 20 }],
    checkpoints: [10, 11, 12, 13, 14, 15, 16, 18, 20],
  };
}

export const H10_LONELY_DAYS = [3, 6, 9, 12];

function expH10(): SampleScenario {
  const one = DAYS_14.map((day) => ({ day, records: [{ chips: H10_LONELY_DAYS.includes(day) ? ['쓸쓸함'] : ['따뜻함'] }] }));
  const five = DAYS_14.map((day) => ({
    day,
    records: H10_LONELY_DAYS.includes(day) ? Array.from({ length: 5 }, () => ({ chips: ['쓸쓸함'] })) : [{ chips: ['따뜻함'] }],
  }));
  const seedTanks: SampleTank[] = range(2, 5).map((i) => {
    const key = `H10S${i}`;
    return { key, label: `기준선: 1번 · 시드 ${i}`, cfg: bookCfg(key, `sample:h10:${i}`), entries: bookEntries(key, one, BOOK_DAILY), days: 14, finishOnLastPage: true, tags: { role: 'baseline' } };
  });
  return {
    id: 'exp-h10', group: 'experiment', origin: 'sample', title: 'H10 하루 1일치 무게 실험',
    summary: '14일 중 4일(3·6·9·12일차) 쓸쓸함. 한 관장은 그날 1번, 다른 관장은 그날 5번 기록(쪽수 합은 같음). 시드 같음.',
    watch: '5번 기록한 날이 어항의 성장 방향을 독차지하지 않는지. 두 어항 차이가 "시드만 바꿨을 때"보다 작아야 해요.',
    hypotheses: ['H10'],
    tanks: [
      { key: 'H10a', label: '쓸쓸한 날 1번 기록', cfg: bookCfg('H10a', 'sample:h10:1'), entries: bookEntries('H10a', one, BOOK_DAILY), days: 14, finishOnLastPage: true, tags: { role: 'one' } },
      { key: 'H10b', label: '쓸쓸한 날 5번 기록', cfg: bookCfg('H10b', 'sample:h10:1'), entries: bookEntries('H10b', five, BOOK_DAILY), days: 14, finishOnLastPage: true, tags: { role: 'five' } },
      ...seedTanks,
    ],
    checkpoints: [1, 3, 6, 9, 12, 14],
  };
}

/** 모든 샘플 시나리오. 호출할 때마다 새로 만든다(공유 객체를 고쳐 다른 결과가 나오는 일을 막기 위해). */
export function allScenarios(): SampleScenario[] {
  return [
    caseA(), caseB(), caseC(), caseD(), caseE(), caseF(),
    compareEmotion(), compareFrequency(), compareActivity(), compareSeed(),
    longSteady(), longSparse(),
    expH3(), expH10(),
  ];
}
