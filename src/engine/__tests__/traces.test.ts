import { describe, expect, it } from 'vitest';
import { SLOTS, TRACE } from '../config';
import { addDays } from '../dates';
import { EMOTIONS, analyzeMood, emotionOf, representativeEmotion } from '../mood';
import { seedFromString } from '../random';
import { TankSession, type NewEntry } from '../session';
import type { PlacedObject, TankConfig } from '../types';

const START = '2026-01-01';
function cfg(total: number | null, seed = 'trace'): TankConfig {
  return { tankId: 't', seed: seedFromString(seed), themeId: 'starlit-desert', goal: total ? { type: 'pages', totalUnits: total, dailyTarget: null } : { type: 'free', totalUnits: null, dailyTarget: null }, startDate: START } as TankConfig;
}
let n = 0;
function e(day: number, amount: number, chips: string[], note = '', progress?: number): NewEntry {
  n += 1;
  return { clientId: `c${n}`, localDate: addDays(START, day), amount, progressValue: progress ?? null, moodChips: chips, note };
}
const traces = (s: TankSession, el?: string): PlacedObject[] => s.head.state.objects.filter((o) => o.kind === 'emotion' && (!el || o.el === el));
const sym = (word: string) => emotionOf(word)!.symbol;

/** 하루 한 번씩 기록(쪽수·감정 순환) */
function readBook(total: number | null, days: number, perDay: number, chips: string[][], seed = 'trace') {
  const s = new TankSession(cfg(total, seed));
  let p = 0;
  let t = Date.UTC(2026, 0, 1, 12);
  for (let d = 0; d < days; d++) {
    p += perDay;
    s.addEntry(e(d, perDay, chips[d % chips.length]!, '', total ? Math.min(total, p) : p), (t = Date.UTC(2026, 0, 1 + d, 12)));
  }
  return { s, t };
}

describe('감정 사전(0.3.0): 고정 id·표시명·옛 이름', () => {
  it('12개 감정, 옛 칩 이름은 같은 감정으로 읽는다', () => {
    expect(EMOTIONS).toHaveLength(12);
    expect(emotionOf('따뜻함')!.id).toBe('emo.joy');
    expect(emotionOf('쓸쓸함')!.id).toBe('emo.lonely');
    expect(emotionOf('유쾌함')!.name).toBe('신남');
    expect(emotionOf('없는말')).toBeUndefined();
  });

  it('대표 감정 = 처음 고른 칩. 칩이 없으면 한마디(확신도 기준 이상), 알 수 없으면 없음', () => {
    expect(representativeEmotion(['그리움', '기쁨'], analyzeMood(['그리움', '기쁨'], ''))!.name).toBe('그리움');
    expect(representativeEmotion([], analyzeMood([], '너무 슬펐다'))!.name).toBe('슬픔');
    expect(representativeEmotion([], analyzeMood([], '그냥 읽음'))).toBeNull();
  });

  it('0.2.0 어항의 "슬프다"는 쓸쓸함 그대로(다시 분류하지 않음), 0.3.0 어항에서만 슬픔', () => {
    expect(analyzeMood([], '슬펐다', '0.2.0').labels).toEqual(['쓸쓸함']);
    expect(analyzeMood([], '슬펐다', '0.3.0').labels).toEqual(['슬픔']);
  });
});

describe('감정 흔적: 읽은 쪽수에 비례', () => {
  it('15쪽마다 1개, 나머지 쪽은 다음 기록으로 이어진다', () => {
    const s = new TankSession(cfg(null));
    s.addEntry(e(0, 14, ['기쁨']), 1);
    expect(traces(s)).toHaveLength(0);
    s.addEntry(e(1, 1, ['기쁨']), 2); // 누적 15쪽
    expect(traces(s)).toHaveLength(1);
    expect(s.head.ledger.trace!.pages).toBe(0);
    s.addEntry(e(2, 44, ['그리움']), 3); // 44쪽 → 2개, 14쪽 남음
    expect(traces(s, sym('그리움'))).toHaveLength(2);
    expect(s.head.ledger.trace!.pages).toBe(14);
  });

  it('하루 최대 3개, 넘친 몫은 쌓아 두었다가 다음 날 쓴다', () => {
    const s = new TankSession(cfg(null));
    s.addEntry(e(0, 100, ['설렘']), 1); // 6개 몫 → 3개 + 3개 쌓임
    expect(traces(s)).toHaveLength(3);
    expect(s.head.ledger.trace!.owed).toBe(3);
    s.addEntry(e(0, 15, ['설렘']), 2); // 같은 날: 더 안 생김
    expect(traces(s)).toHaveLength(3);
    s.addEntry(e(1, 0, ['설렘']), 3); // 다음 날: 쌓인 몫에서 3개
    expect(traces(s, sym('설렘')).length + traces(s, sym('설렘')).reduce((a, o) => a + (o.stage! - 1), 0)).toBe(6);
  });

  it('같은 감정은 최대 4개까지 다른 자리에, 그다음부터 자람(같은 흔적은 3일에 한 번, 최대 3단계)', () => {
    const { s } = readBook(null, 12, 45, [['그리움']]);
    const list = traces(s, sym('그리움'));
    expect(list).toHaveLength(TRACE.perEmotionMax);
    expect(new Set(list.map((o) => `${o.x},${o.y}`)).size).toBe(list.length);
    expect(list.every((o) => (o.stage ?? 1) <= TRACE.maxStage)).toBe(true);
    expect(list.some((o) => (o.stage ?? 1) > 1)).toBe(true);
    // 쿨다운: 같은 흔적이 연달아 이틀 자라지 않는다
    const grown = s.snapshots.flatMap((x) => x.changes.filter((c) => c.text.includes('한 단계 자랐어요')).map((c) => ({ id: c.objectId!, date: x.input!.localDate })));
    for (const id of new Set(grown.map((g) => g.id))) {
      const ds = grown.filter((g) => g.id === id).map((g) => g.date).sort();
      for (let i = 1; i < ds.length; i++) expect(new Date(ds[i]!).getTime() - new Date(ds[i - 1]!).getTime()).toBeGreaterThanOrEqual(TRACE.growCooldownDays * 86_400_000);
    }
  });

  it('감정을 고르지 않은 기록은 흔적을 만들지 않고 몫만 쌓는다', () => {
    const s = new TankSession(cfg(null));
    s.addEntry(e(0, 30, []), 1);
    expect(traces(s)).toHaveLength(0);
    expect(s.head.ledger.trace!.owed).toBe(2);
    s.addEntry(e(1, 0, ['평온']), 2);
    expect(traces(s, sym('평온'))).toHaveLength(2);
  });

  it('흔적 변화 문구는 감정과 그날 한마디로, 기억 보기와 이어진다(objectId)', () => {
    const s = new TankSession(cfg(null));
    s.addEntry(e(0, 15, ['외로움'], '혼자 읽은 밤'), 1);
    const c = s.head.changes.find((x) => x.objectId && traces(s).some((o) => o.id === x.objectId))!;
    expect(c.text).toContain('외로움에서');
    expect(c.text).toContain('등불 물고기');
  });
});

describe('완독 채움: 쪽수만큼 풍성하게', () => {
  // 하루 45쪽(=15쪽 × 하루 최대 3개)보다 빨리 읽거나 한 감정에 몰리면 기록 중엔 목표보다 적게 쌓인다 → 완독 때 채움
  for (const [total, days] of [[140, 2], [300, 5], [500, 7]] as const) {
    it(`${total}쪽을 ${days}일 만에 읽어도 완성 때 목표(쪽수 ÷ 15, 최소 8)만큼, 기록한 감정 비율대로`, () => {
      const per = Math.ceil(total / days);
      const { s, t } = readBook(total, days, per, days >= 4 ? [['그리움'], ['그리움'], ['그리움'], ['기쁨']] : [['그리움'], ['기쁨']]);
      const before = s.head.ledger.trace!.made;
      s.finalize('completed', t + 3_600_000);
      const target = Math.max(TRACE.targetMin, Math.floor(total / TRACE.targetDivisor));
      const tr = s.head.ledger.trace!;
      expect(before).toBeLessThan(target);
      expect(tr.made).toBe(target);
      const fill = s.head.changes.filter((c) => c.level === 'finale' && c.text.startsWith('그동안의'));
      expect(fill.length).toBe(target - before);
      const longing = fill.filter((c) => c.text.includes('그리움')).length;
      const joy = fill.filter((c) => c.text.includes('기쁨')).length;
      if (days >= 4) expect(longing).toBeGreaterThanOrEqual(joy); // 기록 비율이 그리움 쪽이 많음
      expect(longing + joy).toBe(fill.length); // 기록하지 않은 감정은 채우지 않는다
      expect(s.checkInvariants({ deep: true })).toEqual([]);
    });
  }

  it('꾸준히 읽어 이미 목표만큼 있으면 더 채우지 않는다', () => {
    const { s, t } = readBook(140, 28, 5, [['평온']]);
    s.addEntry(e(28, 0, ['평온'], '', 140), t + 86_400_000);
    const before = s.head.ledger.trace!.made;
    s.finalize('completed', t + 2 * 86_400_000);
    if (before >= 9) expect(s.head.changes.filter((c) => c.text.startsWith('그동안의'))).toHaveLength(0);
  });

  it('200일 꾸준형(12가지 감정 순환)도 자리가 넘치지 않고 겹치지 않는다', () => {
    const { s } = readBook(null, 200, 20, EMOTIONS.map((x) => [x.name]));
    const tr = traces(s);
    expect(tr.length).toBeLessThanOrEqual(12 * TRACE.perEmotionMax);
    const nonFish = s.head.state.objects.filter((o) => o.kind !== 'fish');
    for (const a of tr) for (const b of nonFish) if (a !== b) expect(Math.abs(a.y - b.y) >= SLOTS.emotion.nearDy || Math.abs(a.x - b.x) >= SLOTS.emotion.minDist, `${a.id}-${b.id}`).toBe(true);
    expect(s.checkInvariants({ deep: true })).toEqual([]);
  });
});
