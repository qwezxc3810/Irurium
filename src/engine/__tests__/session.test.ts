import { describe, expect, it } from 'vitest';
import { CAPS, CONFIRM_AFTER_MS, LIGHT_SHIFT } from '../config';
import { addDays } from '../dates';
import { mulberry32, seedFromString } from '../random';
import { littlePrinceConfig, littlePrinceEntries } from '../scenarios';
import { TankSession, type NewEntry } from '../session';
import type { TankConfig } from '../types';

const T0 = Date.UTC(2026, 10, 13, 0, 0, 0);
const H = 3_600_000;

function freeConfig(seed = 'free'): TankConfig {
  return { tankId: 't', seed: seedFromString(seed), themeId: 'starlit-desert', goal: { type: 'free', totalUnits: null, dailyTarget: null }, startDate: '2026-11-13' };
}

function entry(i: number, date: string, chips: string[] = ['따뜻함'], extra: Partial<NewEntry> = {}): NewEntry {
  return { clientId: `c${i}`, localDate: date, amount: 10, progressValue: i * 10, moodChips: chips, note: '', ...extra };
}

describe('재현성', () => {
  it('같은 기록을 넣으면 언제나 같은 어항이 나온다', () => {
    const cfg = littlePrinceConfig();
    const a = TankSession.replay(cfg, littlePrinceEntries());
    const b = TankSession.replay(cfg, littlePrinceEntries());
    expect(a).toBe(b);
  });

  it('같은 설정·같은 기록이면 상태가 완전히 같다', () => {
    const a = TankSession.replayState(littlePrinceConfig(), littlePrinceEntries());
    const b = TankSession.replayState(littlePrinceConfig(), littlePrinceEntries());
    expect(a).toEqual(b);
  });

  it('시드만 다르면 실제 배치(위치·종류)가 달라진다', () => {
    // 해시가 아니라 어항 상태의 오브젝트를 직접 비교한다(설정 해시 차이로 통과하는 것을 막기 위해)
    const layout = (seedText: string) =>
      TankSession.replayState(littlePrinceConfig('2026-11-13', seedText), littlePrinceEntries())
        .objects.map((o) => `${o.el}@${o.layer}:${o.x},${o.y}`);
    const a = layout('seed-a');
    const b = layout('seed-b');
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toEqual(b);
  });

  it('시드가 달라도 감정이 같으면 분위기(조명)는 같다', () => {
    const a = TankSession.replayState(littlePrinceConfig('2026-11-13', 'seed-a'), littlePrinceEntries());
    const b = TankSession.replayState(littlePrinceConfig('2026-11-13', 'seed-b'), littlePrinceEntries());
    expect(a.light).toEqual(b.light);
  });
});

describe('어린왕자 14일', () => {
  it('완독 확인 전까지 자동 완성되지 않고, 확인하면 완성 스냅샷이 생긴다', () => {
    const s = new TankSession(littlePrinceConfig());
    let t = T0;
    let last;
    for (const e of littlePrinceEntries()) last = s.addEntry(e, (t += H));
    expect(last!.needsCompletionPrompt).toBe(true);
    expect(s.lifecycle).toBe('active');
    s.answerCompletion('finished', t + H);
    expect(s.lifecycle).toBe('completed');
    expect(s.head.kind).toBe('finale');
    expect(s.head.state.completed).toBe(true);
    expect(s.checkInvariants()).toEqual([]);
  });

  it('14일 뒤에도 상한의 절반 이하로 채워진다', () => {
    const s = new TankSession(littlePrinceConfig());
    let t = T0;
    for (const e of littlePrinceEntries()) s.addEntry(e, (t += H));
    const objs = s.head.state.objects;
    expect(objs.length).toBeGreaterThan(2);
    expect(objs.length).toBeLessThanOrEqual((CAPS.fish + CAPS.plant + CAPS.rock + CAPS.symbol) / 2);
  });
});

describe('하루 여러 번 기록', () => {
  it('주요 변화는 하루 1회, 새 오브젝트도 하루 1개 이하', () => {
    const s = new TankSession(littlePrinceConfig());
    const date = '2026-11-13';
    let t = T0;
    const before = s.head.state.objects.length;
    for (let i = 1; i <= 5; i++) s.addEntry(entry(i, date, i % 2 ? ['설렘'] : ['쓸쓸함'], { progressValue: i * 30 }), (t += H));
    const added = s.head.state.objects.length - before;
    expect(added).toBeLessThanOrEqual(1);
    const majors = s.snapshots.flatMap((x) => x.changes).filter((c) => c.level === 'growth' || c.level === 'special');
    expect(majors.length).toBeLessThanOrEqual(1);
  });

  it('조명 이동은 하루 합계 30%를 넘지 않는다', () => {
    const s = new TankSession(freeConfig());
    let t = T0;
    for (let i = 1; i <= 6; i++) s.addEntry(entry(i, '2026-11-13', ['쓸쓸함']), (t += H));
    expect(s.head.ledger.dayLightShift.used).toBeLessThanOrEqual(LIGHT_SHIFT.dayMax + 1e-9);
  });

  it('같은 날 기록들의 감정 이력은 하루 1일치로 합쳐진다', () => {
    const s = new TankSession(freeConfig());
    let t = T0;
    for (let i = 1; i <= 4; i++) s.addEntry(entry(i, '2026-11-13', ['따뜻함']), (t += H));
    expect(s.head.ledger.moodTrail).toHaveLength(1);
    expect(s.head.ledger.moodTrail[0]!.count).toBe(4);
  });
});

describe('스냅샷 확정과 재계산', () => {
  it('다음 기록이 저장되면 앞 스냅샷이 확정된다', () => {
    const s = new TankSession(freeConfig());
    const a = s.addEntry(entry(1, '2026-11-13'), T0);
    s.addEntry(entry(2, '2026-11-14'), T0 + H);
    expect(s.snap(a.snapshot.id).status).toBe('confirmed');
    expect(s.snap(a.snapshot.id).confirmReason).toBe('next_entry');
  });

  it('24시간이 지나면 읽을 때 확정된다', () => {
    const s = new TankSession(freeConfig());
    const a = s.addEntry(entry(1, '2026-11-13'), T0);
    expect(s.confirmIfDue(T0 + CONFIRM_AFTER_MS - 1)).toBe(false);
    expect(s.confirmIfDue(T0 + CONFIRM_AFTER_MS)).toBe(true);
    expect(s.snap(a.snapshot.id).confirmReason).toBe('timeout');
  });

  it('확정 전 감정을 고치면 그 스냅샷만 다시 계산된다', () => {
    const s = new TankSession(freeConfig());
    s.addEntry(entry(1, '2026-11-13'), T0);
    const second = s.addEntry(entry(2, '2026-11-14', ['따뜻함']), T0 + H);
    const firstSnap = s.snapshots.find((x) => x.seq === 1)!;
    const firstHash = firstSnap.inputHash;
    const r = s.editEntry(second.entry.id, { moodChips: ['쓸쓸함'] }, 1, T0 + 2 * H);
    expect(r.mode).toBe('recomputed');
    expect(s.head.state.light.temp).toBeLessThan(second.snapshot.state.light.temp);
    expect(s.snapshots.find((x) => x.seq === 1)!.inputHash).toBe(firstHash);
    expect(s.checkInvariants()).toEqual([]);
  });

  it('확정된 기록을 고치면 기록만 바뀌고 어항은 그대로, 수정 이력이 남는다', () => {
    const s = new TankSession(freeConfig());
    const a = s.addEntry(entry(1, '2026-11-13'), T0);
    s.addEntry(entry(2, '2026-11-14'), T0 + H);
    const snapBefore = JSON.stringify(s.snap(a.snapshot.id).state);
    const r = s.editEntry(a.entry.id, { moodChips: ['답답함'] }, 1, T0 + 2 * H);
    expect(r.mode).toBe('record_only');
    expect(JSON.stringify(s.snap(a.snapshot.id).state)).toBe(snapBefore);
    expect(s.revisions).toHaveLength(1);
    expect(s.entries[0]!.moodChips).toEqual(['답답함']);
  });

  it('미확정 기록을 지우면 머리가 직전 확정본으로 돌아간다', () => {
    const s = new TankSession(freeConfig());
    const a = s.addEntry(entry(1, '2026-11-13'), T0);
    const b = s.addEntry(entry(2, '2026-11-14'), T0 + H);
    expect(s.deleteEntry(b.entry.id, T0 + 2 * H).mode).toBe('discarded');
    expect(s.head.id).toBe(a.snapshot.id);
    expect(s.checkInvariants()).toEqual([]);
  });

  it('같은 clientId로 다시 보내면 중복 저장되지 않는다', () => {
    const s = new TankSession(freeConfig());
    s.addEntry(entry(1, '2026-11-13'), T0);
    const again = s.addEntry(entry(1, '2026-11-13'), T0 + 5);
    expect(again.duplicate).toBe(true);
    expect(s.entries).toHaveLength(1);
  });

  it('localDate가 마지막 기록보다 이르면 마지막 날짜로 맞춘다(시간대 이동)', () => {
    const s = new TankSession(freeConfig());
    s.addEntry(entry(1, '2026-11-14'), T0);
    const b = s.addEntry(entry(2, '2026-11-13'), T0 + H);
    expect(b.entry.localDate).toBe('2026-11-14');
  });

  it('무작위 기록·수정·삭제·확정 순서에서도 불변 규칙이 지켜진다', () => {
    for (let run = 0; run < 40; run++) {
      const rng = mulberry32(run + 1);
      const s = new TankSession(freeConfig(`run-${run}`));
      let t = T0;
      let date = '2026-11-13';
      for (let step = 0; step < 60; step++) {
        t += Math.floor(rng() * 30) * H;
        if (rng() < 0.3) date = addDays(date, 1);
        const r = rng();
        const live = s.entries.filter((e) => !e.deletedAt);
        if (r < 0.55) s.addEntry(entry(step + 1, date, rng() < 0.5 ? ['설렘'] : ['쓸쓸함']), t);
        else if (r < 0.75 && live.length) { const e = live[Math.floor(rng() * live.length)]!; s.editEntry(e.id, { moodChips: ['차분함'] }, e.rev, t); }
        else if (r < 0.85 && live.length) { const e = live[Math.floor(rng() * live.length)]!; s.deleteEntry(e.id, t); }
        else s.confirmIfDue(t);
        expect(s.checkInvariants({ deep: false })).toEqual([]);
      }
      expect(s.checkInvariants({ deep: true })).toEqual([]);
    }
  });
});

describe('개수 상한', () => {
  it('200일 기록해도 종류별 상한을 넘지 않는다', () => {
    const s = new TankSession(freeConfig('long'));
    let t = T0;
    let date = '2026-11-13';
    const moods = [['따뜻함'], ['쓸쓸함'], ['유쾌함'], ['차분함'], ['답답함']];
    for (let i = 1; i <= 200; i++) {
      s.addEntry(entry(i, date, moods[i % moods.length]), (t += 24 * H));
      date = addDays(date, 1);
    }
    const objs = s.head.state.objects;
    for (const kind of ['fish', 'plant', 'rock', 'symbol'] as const) {
      expect(objs.filter((o) => o.kind === kind).length).toBeLessThanOrEqual(CAPS[kind]);
    }
    expect(s.head.state.effects.length).toBeLessThanOrEqual(2);
    expect(Math.max(...objs.map((o) => o.scale))).toBeLessThanOrEqual(1.6);
  });
});

describe('불변 규칙 검사(I2·I3)', () => {
  function sessionWith(n: number) {
    const s = new TankSession(littlePrinceConfig());
    let t = T0;
    for (const e of littlePrinceEntries().slice(0, n)) s.addEntry(e, (t += H));
    return s;
  }

  it('정상 세션은 깊은 검사(다시 계산)까지 통과한다', () => {
    const s = sessionWith(13);
    s.answerCompletion('finished', T0 + 100 * H);
    expect(s.checkInvariants({ deep: true })).toEqual([]);
  });

  it('확정된 스냅샷 내용이 바뀌면 I3 위반을 잡는다', () => {
    const s = sessionWith(5);
    const confirmed = s.snapshots.find((x) => x.seq === 2)!;
    (confirmed.state.light as { temp: number }).temp = 0.99; // 의도적 변조
    expect(s.checkInvariants().some((e) => e.startsWith('I3'))).toBe(true);
  });

  it('스냅샷을 다시 계산한 결과가 다르면 I2 위반을 잡는다', () => {
    const s = sessionWith(5);
    const snap = s.snapshots.find((x) => x.seq === 3)!;
    snap.input!.moodChips = ['답답함']; // 저장된 입력만 바꿔 결과와 어긋나게 만든다
    expect(s.checkInvariants({ deep: true }).some((e) => e.startsWith('I2'))).toBe(true);
  });

  it('확정 후 기록을 고쳐도 깊은 검사는 통과한다(스냅샷은 저장 당시 입력으로 재현)', () => {
    const s = sessionWith(5);
    const first = s.entries[0]!;
    s.editEntry(first.id, { moodChips: ['답답함'], note: '바꾼 한마디' }, first.rev, T0 + 50 * H);
    expect(s.checkInvariants({ deep: true })).toEqual([]);
  });

  it('총 쪽수를 고쳐도 과거 스냅샷은 당시 설정으로 재현된다', () => {
    const s = sessionWith(13);
    s.fixTotal(150, T0 + 50 * H);
    expect(s.checkInvariants({ deep: true })).toEqual([]);
  });
});

describe('삭제한 기록과 이끼 기준', () => {
  it('확정 후 숨긴 기록은 활동으로 남아 이끼가 갑자기 생기지 않는다', () => {
    const s = new TankSession(freeConfig());
    s.addEntry(entry(1, '2026-11-13'), T0);
    const last = s.addEntry(entry(2, '2026-11-20'), T0 + H);
    s.confirmHead('user', T0 + 2 * H);
    expect(s.deleteEntry(last.entry.id, T0 + 3 * H).mode).toBe('hidden');
    expect(s.lastActivityDate()).toBe('2026-11-20');
    expect(s.moss('2026-11-22').stage).toBe(0);
  });

  it('미확정 상태에서 지운 기록은 실수 입력으로 보고 활동에서 뺀다', () => {
    const s = new TankSession(freeConfig());
    s.addEntry(entry(1, '2026-11-13'), T0);
    s.confirmHead('user', T0 + H);
    const mistake = s.addEntry(entry(2, '2026-11-20'), T0 + 2 * H);
    expect(s.deleteEntry(mistake.entry.id, T0 + 3 * H).mode).toBe('discarded');
    expect(s.lastActivityDate()).toBe('2026-11-13');
    expect(s.moss('2026-11-20').stage).toBe(1); // 11/14~11/19 6일 → 1단계
  });

  it('모든 기록을 지우면 기준은 어항 시작일', () => {
    const s = new TankSession(freeConfig());
    const a = s.addEntry(entry(1, '2026-11-15'), T0);
    s.deleteEntry(a.entry.id, T0 + H);
    expect(s.lastActivityDate()).toBe('2026-11-13');
  });
});
