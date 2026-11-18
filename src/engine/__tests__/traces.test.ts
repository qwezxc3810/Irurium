import { describe, expect, it } from 'vitest';
import { SLOTS, TRACE } from '../config';
import { addDays } from '../dates';
import { EMOTIONS, analyzeMood, emotionOf, representativeEmotion } from '../mood';
import { seedFromString } from '../random';
import { TankSession, type NewEntry } from '../session';
import { memoryOf } from '../../ui/memory';
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
  it('같은 감정 15쪽마다 1개, 나머지 쪽은 그 감정에 모여 다음 기록으로 이어진다', () => {
    const s = new TankSession(cfg(null));
    s.addEntry(e(0, 14, ['기쁨']), 1);
    expect(traces(s)).toHaveLength(0);
    s.addEntry(e(1, 1, ['기쁨']), 2); // 기쁨 누적 15쪽
    expect(traces(s)).toHaveLength(1);
    expect(s.head.ledger.trace!.buckets['emo.joy']).toBeUndefined();
    s.addEntry(e(2, 44, ['그리움']), 3); // 44쪽 → 2개, 그리움에 14쪽 남음
    expect(traces(s, sym('그리움'))).toHaveLength(2);
    expect(s.head.ledger.trace!.buckets['emo.longing']).toEqual([{ seq: 3, date: '2026-01-03', pages: 14 }]);
  });

  it('리뷰 회귀 A: 슬픔 14쪽 → 기쁨 1쪽은 감정을 섞지 않아 흔적이 생기지 않는다', () => {
    const s = new TankSession(cfg(null));
    s.addEntry(e(0, 14, ['슬픔']), 1);
    s.addEntry(e(1, 1, ['기쁨']), 2);
    expect(traces(s)).toHaveLength(0);
    expect(s.head.ledger.trace!.buckets['emo.sad']![0]!.pages).toBe(14);
    expect(s.head.ledger.trace!.buckets['emo.joy']![0]!.pages).toBe(1);
  });

  it('리뷰 회귀 B: 감정 없음 14쪽 → 기쁨 1쪽이면 기쁨 흔적이 생기지 않는다(감정 없는 쪽수는 모으지 않음)', () => {
    const s = new TankSession(cfg(null));
    s.addEntry(e(0, 14, []), 1);
    s.addEntry(e(1, 1, ['기쁨']), 2);
    expect(traces(s)).toHaveLength(0);
    expect(Object.keys(s.head.ledger.trace!.buckets)).toEqual(['emo.joy']);
  });

  it('리뷰 회귀: 같은 날 다른 감정 7쪽 + 8쪽은 섞이지 않고, 같은 감정 7쪽 + 8쪽은 모여 1개(출처 = 더 많이 낸 기록)', () => {
    const a = new TankSession(cfg(null));
    a.addEntry(e(0, 7, ['설렘']), 1);
    a.addEntry(e(0, 8, ['평온']), 2);
    expect(traces(a)).toHaveLength(0);
    const b = new TankSession(cfg(null));
    b.addEntry(e(0, 7, ['설렘'], '앞부분'), 1);
    b.addEntry(e(0, 8, ['설렘'], '뒷부분'), 2);
    expect(traces(b)).toHaveLength(1);
    const c = b.head.changes.find((x) => traces(b).some((o) => o.id === x.objectId))!;
    expect(c.text).toBe('1월 1일부터 모인 설렘에서 반짝이 진주조개가 생겼어요');
    expect(c.sourceSeq).toBeUndefined(); // 출처 = 8쪽을 낸 이 기록
    const m = memoryOf(b.snapshots, b.entries, b.head.id, c.objectId!)!;
    expect(m.born!.note).toBe('뒷부분');
  });

  it('리뷰 회귀: 14쪽 + 1쪽 → 출처는 14쪽 기록. 그 기록을 고치면 생길 때의 한마디, 지우면 날짜만', () => {
    const run = () => {
      const s = new TankSession(cfg(null));
      s.addEntry(e(0, 14, ['그리움'], '편지를 읽다가'), Date.UTC(2026, 0, 1, 12));
      s.addEntry(e(1, 1, ['그리움'], '조금'), Date.UTC(2026, 0, 2, 12));
      return s;
    };
    const s = run();
    const c = s.head.changes.find((x) => traces(s).some((o) => o.id === x.objectId))!;
    expect(c.sourceSeq).toBe(1);
    expect(c.text.startsWith('1월 1일부터 모인 그리움에서')).toBe(true);
    let m = memoryOf(s.snapshots, s.entries, s.head.id, c.objectId!)!;
    expect(m.born!.date).toBe('2026-01-01');
    expect(m.born!.note).toBe('편지를 읽다가');
    expect(m.born!.appearedOn).toBe('2026-01-02');
    // 확정된 첫 기록의 한마디를 고침 → 카드는 생길 때의 한마디 + 고침 표시
    const first = s.entries[0]!;
    s.editEntry(first.id, { note: '고친 말' }, first.rev, Date.UTC(2026, 0, 3));
    m = memoryOf(s.snapshots, s.entries, s.head.id, c.objectId!)!;
    expect(m.born!.note).toBe('편지를 읽다가');
    expect(m.born!.entryState).toBe('edited');
    // 지움(숨김) → 날짜만
    const s2 = run();
    s2.addEntry(e(2, 0, ['그리움']), Date.UTC(2026, 0, 3, 12));
    s2.deleteEntry(s2.entries[0]!.id, Date.UTC(2026, 0, 3, 13));
    m = memoryOf(s2.snapshots, s2.entries, s2.head.id, c.objectId!)!;
    expect(m.born!.entryState).toBe('hidden');
    expect(m.born!.note).toBe('');
    expect(m.born!.chips).toEqual([]);
  });

  it('하루 최대 3개, 넘친 몫은 원래 감정·기록과 함께 미뤄 두었다가 다음 날 먼저 놓는다', () => {
    const s = new TankSession(cfg(null));
    s.addEntry(e(0, 100, ['슬픔']), 1); // 6개 몫 → 3개 + 3개 미룸
    expect(traces(s)).toHaveLength(3);
    expect(s.head.ledger.trace!.queue.map((q) => q.emotion)).toEqual(['emo.sad', 'emo.sad', 'emo.sad']);
    s.addEntry(e(0, 15, ['슬픔']), 2); // 같은 날: 더 안 생김(미룸)
    expect(traces(s)).toHaveLength(3);
    expect(s.head.ledger.trace!.queue).toHaveLength(4);
  });

  it('리뷰 회귀: 100쪽 슬픔 → 다음 날 0쪽 기쁨이면, 미룬 흔적은 기쁨이 아니라 슬픔이고 출처는 첫날 기록', () => {
    const s = new TankSession(cfg(null));
    s.addEntry(e(0, 100, ['슬픔'], '울면서 읽음'), 1);
    s.addEntry(e(1, 0, ['기쁨']), 2);
    expect(traces(s, sym('기쁨'))).toHaveLength(0);
    const sad = traces(s, sym('슬픔'));
    expect(sad.length + sad.reduce((a, o) => a + (o.stage! - 1), 0)).toBe(6);
    const late = s.head.changes.filter((c) => c.sourceSeq !== undefined);
    expect(late).toHaveLength(3);
    expect(late.every((c) => c.sourceSeq === 1 && c.text.startsWith('1월 1일의 슬픔이 이어져'))).toBe(true);
    // 기억 보기: 미뤄졌다 놓인 흔적도 첫날 기록(100쪽·슬픔·한마디)을 보여 준다
    const born = late.find((c) => c.text.endsWith('생겼어요'));
    if (born) {
      const m = memoryOf(s.snapshots, s.entries, s.head.id, born.objectId!)!;
      expect(m.born!.date).toBe('2026-01-01');
      expect(m.born!.chips).toEqual(['슬픔']);
      expect(m.born!.note).toBe('울면서 읽음');
      expect(m.born!.pages).toBeNull(); // 진행 쪽(progressValue)이 없는 자유형 기록
    }
  });

  it('리뷰 회귀: 같은 날 여러 번 기록하면 기록마다 자기 감정으로 쌓이고, 먼저 미룬 것부터 놓인다', () => {
    const s = new TankSession(cfg(null));
    s.addEntry(e(0, 45, ['그리움']), 1); // 3개(오늘 상한)
    s.addEntry(e(0, 30, ['기쁨']), 2); // 2개 미룸(기쁨)
    s.addEntry(e(1, 15, ['외로움']), 3); // 다음 날: 기쁨 2개(미룬 것) + 외로움 1개
    expect(traces(s, sym('그리움'))).toHaveLength(3);
    expect(traces(s, sym('기쁨'))).toHaveLength(2);
    expect(traces(s, sym('외로움'))).toHaveLength(1);
    expect(s.head.changes.filter((c) => c.sourceSeq === 2)).toHaveLength(2);
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

  it('리뷰 회귀: 감정을 고르지 않은 기록은 흔적을 만들지 않고, 그 몫이 나중 다른 감정으로 바뀌지도 않는다(완독 목표에만 반영)', () => {
    const s = new TankSession(cfg(null));
    s.addEntry(e(0, 30, []), 1);
    expect(traces(s)).toHaveLength(0);
    expect(s.head.ledger.trace!.queue).toHaveLength(0);
    s.addEntry(e(1, 0, ['평온']), 2);
    expect(traces(s, sym('평온'))).toHaveLength(0);
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
      // 완독 때 생긴 흔적 = 미뤄 둔 흔적(원래 출처, '…이 이어져') + 비율 채움('그동안의 …')
      const fill = s.head.changes.filter((c) => c.level === 'finale' && c.objectId && (c.text.startsWith('그동안의') || c.text.includes('이 이어져') || c.text.includes('가 이어져') || c.text.includes('부터 모인')));
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

describe('리뷰 회귀: 완독 채움과 기억 연결', () => {
  it('미뤄 둔 흔적은 완독 때 원래 감정·출처로 먼저 놓이고, 남은 몫만 비율 채움', () => {
    const s = new TankSession(cfg(300));
    s.addEntry(e(0, 150, ['슬픔'], '', 150), 1); // 10개 몫: 3개 + 7개 미룸
    s.addEntry(e(0, 150, ['기쁨'], '', 300), 2); // 같은 날 10개 더 미룸(기쁨)
    s.finalize('completed', Date.UTC(2026, 0, 1, 15));
    const fin = s.head.changes;
    const fromQueue = fin.filter((c) => c.sourceSeq !== undefined);
    expect(fromQueue.filter((c) => c.sourceSeq === 1).every((c) => c.text.includes('슬픔이 이어져'))).toBe(true);
    expect(fromQueue.filter((c) => c.sourceSeq === 2).every((c) => c.text.includes('기쁨이 이어져'))).toBe(true);
    expect(s.head.ledger.trace!.made).toBeGreaterThanOrEqual(20); // 목표 300 ÷ 15
    expect(s.checkInvariants({ deep: true })).toEqual([]);
    // 기억 카드: 완독 때 미뤄 둔 흔적은 원래 기록(그날 마음)으로, 완독 때 여러 단계 자라면 변화마다
    for (const o of traces(s)) {
      const m = memoryOf(s.snapshots, s.entries, s.head.id, o.id)!;
      expect(m.born).not.toBeNull();
      const all = [m.born!, ...m.grew];
      expect(all.length).toBe((o.stage ?? 1)); // 생김 1 + 자람(단계 - 1)
    }
  });

  it('리뷰 회귀: 15쪽 경계 이월·완독에서도 같은 귀속 — 상한으로 미룬 "모인" 흔적은 출처 그대로, 감정별 나머지는 섞지 않고 "그동안의"로만 채움', () => {
    const s = new TankSession(cfg(150));
    s.addEntry(e(0, 45, ['외로움'], '', 45), 1); // 오늘 3개(상한)
    s.addEntry(e(0, 7, ['평온'], '', 52), 2);
    s.addEntry(e(0, 8, ['평온'], '', 60), 3); // 평온 15쪽 → 1개 몫, 상한이라 미룸(출처 = 8쪽 기록)
    expect(s.head.ledger.trace!.queue).toEqual([{ emotion: 'emo.calm', seq: 3, date: '2026-01-01', from: '2026-01-01' }]);
    s.addEntry(e(1, 14, ['슬픔'], '', 74), 4); // 다음 날: 미룬 평온 1개 놓임, 슬픔 14쪽은 남음
    const late = s.head.changes.find((c) => c.sourceSeq === 3)!;
    expect(late.text).toBe('1월 1일부터 모인 평온에서 별빛 해파리가 생겼어요');
    s.addEntry(e(2, 14, ['기쁨'], '', 88), 5); // 기쁨 14쪽도 남음(슬픔과 섞이지 않음)
    expect(traces(s, sym('슬픔'))).toHaveLength(0);
    expect(traces(s, sym('기쁨'))).toHaveLength(0);
    s.finalize('completed', Date.UTC(2026, 0, 4));
    const fin = s.head.changes.filter((c) => c.level === 'finale' && c.objectId && traces(s).some((o) => o.id === c.objectId));
    expect(fin.every((c) => c.text.startsWith('그동안의 '))).toBe(true); // 남은 쪽은 특정 기록인 척하지 않음
    expect(s.head.ledger.trace!.made).toBe(10); // 150 ÷ 15
    expect(s.checkInvariants({ deep: true })).toEqual([]);
  });
});
