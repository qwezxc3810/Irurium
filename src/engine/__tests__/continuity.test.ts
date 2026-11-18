import { describe, expect, it } from 'vitest';
import { computeFinale, computeSnapshot } from '../compute';
import { ENGINE_VERSION } from '../config';
import { hashOf } from '../random';
import { contentHashOf, TankSession, type NewEntry, type SessionData } from '../session';
import type { Snapshot, TankState } from '../types';
import { GOLDEN_REPLAY } from './golden';
import { littlePrinceConfig, littlePrinceEntries } from '../scenarios';
import confirmedFx from './fixtures/continuity-0.1.0-confirmed.json';
import draftFx from './fixtures/continuity-0.1.0-draft.json';
import contEntries from './fixtures/continuity-entries.json';
import contBy010 from './fixtures/continuity-0.1.0-continued-by-0.1.0.json';

/**
 * 이슈 #12: 엔진 버전 간 기록 연속성.
 * 고정 파일은 실제 엔진 0.1.0(main bb039c0)으로 만든 어항이다(만든 방법: docs/CONTINUITY.md).
 * - confirmed: 60일·61개 기록, 머리까지 확정. 중간에 확정 기록 숨김(e21), 확정 기록 한마디 수정(e11), 미확정 폐기(46일차), 쉬는 날 변경
 * - draft: 같은 기록, 머리(s61-r1)가 미확정
 * - entries: 0.2.0으로 이어 넣을 기록 30개 / continued-by-0.1.0: 같은 30개를 0.1.0으로 이었을 때 머리 상태(비교용)
 */

const DAY = 86400000;
const T_END = Date.UTC(2026, 7, 1, 12) + 61 * DAY; // 고정 파일 마지막 시각 다음 날
const raw = (fx: unknown) => JSON.parse(JSON.stringify(fx)) as SessionData;
const load = (fx: unknown) => TankSession.fromJSON(raw(fx));
const ENTRIES = contEntries as NewEntry[];
/** 앱을 끄고 다시 여는 것과 같음: 문자열로 저장했다가 불러오기 */
const reopen = (s: TankSession) => TankSession.fromJSON(JSON.parse(JSON.stringify(s.toJSON())) as SessionData);

function addAll(s: TankSession, list: NewEntry[], start = T_END) {
  let t = start;
  for (const e of list) s.addEntry(e, (t += DAY));
  return t;
}
/** 확정 처리 필드를 뺀 스냅샷 내용(미확정 → 확정은 허용되는 변화) */
const body = (x: Snapshot) => {
  const { status: _s, confirmedAt: _a, confirmReason: _r, confirmDueAt: _d, ...rest } = x;
  return rest;
};
const fishOf = (st: TankState) => st.objects.filter((o) => o.kind === 'fish').map((o) => ({ id: o.id, el: o.el, scale: o.scale }));
const chainIds = (s: TankSession) => {
  const out: string[] = [];
  let cur: Snapshot | null = s.head;
  while (cur) { out.unshift(cur.id); cur = cur.baseId ? s.snap(cur.baseId) : null; }
  return out;
};

describe('고정 파일: 실제 엔진 0.1.0 기록', () => {
  it('모두 0.1.0으로 만들었고, 지금 엔진(0.3.0)으로 불러와도 무결성 오류가 없다(다시 계산하지 않음)', () => {
    expect(ENGINE_VERSION).toBe('0.3.0');
    for (const fx of [confirmedFx, draftFx]) {
      const d = raw(fx);
      expect(new Set(d.snapshots.map((x) => x.engineVersion))).toEqual(new Set(['0.1.0']));
      const s = TankSession.fromJSON(d);
      expect(s.checkInvariants({ deep: true })).toEqual([]);
      expect(s.integrityScope()).toMatchObject({ versions: ['0.1.0'], recomputed: 0, notRecomputed: d.snapshots.length - 1 });
    }
    expect(raw(confirmedFx).snapshots.at(-1)!.status).toBe('confirmed');
    expect(raw(draftFx).snapshots.at(-1)!.status).toBe('draft');
  });

  it('고친 점 회귀: 예전 깊은 검사는 0.1.0 스냅샷을 0.2.0으로 다시 계산해 "결과가 다름"으로 잘못 잡았다', () => {
    const d = raw(confirmedFx);
    // 지금 규칙으로 다시 계산하면 실제로 다른 스냅샷이 있다(그래서 다시 계산하면 안 된다)
    const byId = new Map(d.snapshots.map((x) => [x.id, x]));
    const differ = d.snapshots.filter((x) => x.baseId && x.input && contentHashOf(computeSnapshot(byId.get(x.baseId)!, x.input, x.cfg)) !== x.contentHash);
    expect(differ.length).toBeGreaterThan(10);
  });
});

describe('1·6. 하나의 기록 체인으로 이어진다', () => {
  const s = load(confirmedFx);
  const before = raw(confirmedFx);
  addAll(s, ENTRIES);
  const d = s.toJSON();

  it('0.1.0 스냅샷 61개 뒤에 0.2.0 스냅샷 30개가 한 줄로 이어진다', () => {
    const ids = chainIds(s);
    expect(ids.length).toBe(d.snapshots.length);
    expect(ids.length).toBe(before.snapshots.length + 30);
    const versions = ids.map((id) => s.snap(id).engineVersion);
    const firstNew = versions.indexOf('0.2.0');
    expect(versions.slice(0, firstNew).every((v) => v === '0.1.0')).toBe(true);
    expect(versions.slice(firstNew).every((v) => v === '0.2.0')).toBe(true);
    // 첫 0.2.0 스냅샷의 기준은 0.1.0의 마지막(확정) 스냅샷
    const first = s.snap(ids[firstNew]!);
    expect(first.baseId).toBe(before.headId);
    expect(s.snap(first.baseId!).engineVersion).toBe('0.1.0');
    expect(s.snap(first.baseId!).status).toBe('confirmed');
  });

  it('순번이 이어지고 겹치지 않는다(기록 62~91, 스냅샷 s62~s91), 중복 기록 없음', () => {
    expect(d.entries.map((e) => e.seq)).toEqual(d.entries.map((_, i) => i + 1));
    expect(d.entries.slice(-30).map((e) => e.id)).toEqual(Array.from({ length: 30 }, (_, i) => `e${62 + i}`));
    expect(new Set(d.entries.map((e) => e.clientId)).size).toBe(d.entries.length);
    expect(new Set(d.snapshots.map((x) => x.id)).size).toBe(d.snapshots.length);
    const news = d.snapshots.filter((x) => x.engineVersion === '0.2.0');
    for (const x of news) expect(s.snap(x.baseId!).seq).toBeLessThan(x.seq);
  });

  it('섞인 기록 전체가 무결성 검사를 통과한다', () => {
    expect(s.checkInvariants({ deep: true })).toEqual([]);
    expect(s.integrityScope()).toMatchObject({ versions: ['0.1.0', '0.2.0'], recomputed: 30, notRecomputed: 60 });
  });

  it('같은 기록을 다시 보내면(앱 재시도) 중복으로 처리하고 아무것도 늘지 않는다 — 0.1.0 때 기록도', () => {
    const n = s.toJSON();
    expect(s.addEntry(ENTRIES[5]!, T_END + 100 * DAY).duplicate).toBe(true);
    expect(s.addEntry({ ...ENTRIES[0]!, clientId: 'c-5' }, T_END + 100 * DAY).duplicate).toBe(true);
    expect(s.addEntry({ ...ENTRIES[0]!, clientId: 'c-45-mistake' }, T_END + 100 * DAY).duplicate).toBe(true); // 0.1.0 때 폐기한 기록
    expect(s.toJSON()).toEqual(n);
  });
});

describe('2. 기존 확정 스냅샷은 바뀌지 않는다', () => {
  it('새 기록 30개를 넣고 저장·불러오기를 해도 0.1.0 스냅샷 61개의 내용·해시·오브젝트·확정 정보가 그대로', () => {
    const before = raw(confirmedFx);
    let s = load(confirmedFx);
    addAll(s, ENTRIES.slice(0, 15));
    s = reopen(s);
    addAll(s, ENTRIES.slice(15), T_END + 15 * DAY);
    s.confirmIfDue(T_END + 60 * DAY);
    s = reopen(s);
    for (const old of before.snapshots) {
      const now = s.snap(old.id);
      expect(now, old.id).toEqual(old);
      expect(contentHashOf(now)).toBe(old.contentHash);
      expect(hashOf(now.state.objects)).toBe(hashOf(old.state.objects));
    }
  });

  it('기존 기록(entries)·수정 이력·쉬는 날 규칙도 그대로', () => {
    const before = raw(confirmedFx);
    const s = load(confirmedFx);
    addAll(s, ENTRIES);
    const d = s.toJSON();
    expect(d.entries.slice(0, before.entries.length)).toEqual(before.entries);
    expect(d.revisions).toEqual(before.revisions);
    expect(d.restRules).toEqual(before.restRules);
  });
});

// 0.3.0부터: 어항은 만들 때 엔진으로 끝까지 계산한다. 계산 코드를 보관하지 않는 0.1.0 어항은 0.2.0 도입 때처럼 0.2.0(FALLBACK_ENGINE)으로 이어서 계산한다
describe('3. 새 기록부터 0.2.0 규칙으로 계산한다(0.1.0 어항 → FALLBACK_ENGINE)', () => {
  const s = load(confirmedFx);
  addAll(s, ENTRIES);
  s.confirmIfDue(T_END + 60 * DAY);
  const news = s.snapshots.filter((x) => x.engineVersion === '0.2.0');

  it('새 스냅샷은 모두 0.2.0이고, 저장된 입력으로 지금 엔진에서 다시 계산하면 같다', () => {
    expect(news.length).toBe(30);
    for (const x of news) {
      expect(contentHashOf(computeSnapshot(s.snap(x.baseId!), x.input!, x.cfg, '0.2.0')), x.id).toBe(x.contentHash);
      expect(x.inputHash).toBe(hashOf({ base: s.snap(x.baseId!).inputHash, input: x.input, v: '0.2.0' }));
    }
  });

  it('0.2.0 헤엄 공간 예산이 적용된다: 예산을 넘은 0.1.0 어항에는 새 물고기가 생기지 않고 물고기도 자라지 않는다', () => {
    const last010 = s.snap(raw(confirmedFx).headId).state;
    expect(fishOf(s.head.state)).toEqual(fishOf(last010));
    // 같은 30개 기록을 0.1.0으로 이었다면 물고기가 더 자랐다
    const by010 = (contBy010 as { engineVersion: string; headState: TankState }).headState;
    expect((contBy010 as { engineVersion: string }).engineVersion).toBe('0.1.0');
    expect(fishOf(by010)).not.toEqual(fishOf(last010));
    expect(hashOf(by010)).not.toBe(hashOf(s.head.state));
  });

  it('예산을 넘은 기존 물고기를 줄이거나 지우지 않는다(기존 생물 보존), 다른 생물은 계속 자란다', () => {
    const last010 = s.snap(raw(confirmedFx).headId).state;
    const ids = new Set(s.head.state.objects.map((o) => o.id));
    for (const o of last010.objects) expect(ids.has(o.id), o.id).toBe(true);
    const grew = s.head.state.objects.some((o) => o.kind !== 'fish' && o.scale > (last010.objects.find((p) => p.id === o.id)?.scale ?? 0));
    expect(grew).toBe(true);
  });

  it('지금 엔진 계산 자체는 그대로(골든 해시)', () => {
    expect(TankSession.replay(littlePrinceConfig(), littlePrinceEntries())).toBe(GOLDEN_REPLAY[ENGINE_VERSION]);
  });
});

describe('4. 예외 상황', () => {
  it('0.1.0 미확정 머리: 24시간이 지나면 0.1.0 결과 그대로 확정(다시 계산 안 함)', () => {
    const before = raw(draftFx);
    const s = load(draftFx);
    s.confirmIfDue(T_END + 3 * DAY);
    expect(s.head.status).toBe('confirmed');
    expect(s.head.confirmReason).toBe('timeout');
    expect(body(s.head)).toEqual(body(before.snapshots.at(-1)!));
    expect(s.checkInvariants({ deep: true })).toEqual([]);
  });

  it('0.1.0 미확정 머리: 다음 기록을 넣으면 0.1.0 결과 그대로 확정하고 그 뒤에 0.2.0 스냅샷', () => {
    const before = raw(draftFx);
    const s = load(draftFx);
    const due = s.head.confirmDueAt!;
    s.addEntry({ ...ENTRIES[0]!, localDate: s.entries.at(-1)!.localDate }, due - 1000); // 확정 기한 전에 다음 기록
    const old = s.snap(before.headId);
    expect(old.status).toBe('confirmed');
    expect(old.confirmReason).toBe('next_entry');
    expect(body(old)).toEqual(body(before.snapshots.at(-1)!));
    expect(s.head.engineVersion).toBe('0.2.0');
    expect(s.head.baseId).toBe(before.headId);
  });

  it('0.1.0 미확정 머리를 확정 전에 고치면: 확정 기준(0.1.0) 위에서 지금 엔진으로 다시 계산한 미확정본으로 바뀐다(확정본은 그대로)', () => {
    const before = raw(draftFx);
    const s = load(draftFx);
    const e = s.entries.at(-1)!;
    const dueAt = s.head.confirmDueAt!;
    expect(s.editEntry(e.id, { moodChips: ['유쾌함'] }, e.rev, dueAt - 1000).mode).toBe('recomputed');
    expect(s.head.engineVersion).toBe('0.2.0');
    expect(s.head.status).toBe('draft');
    expect(s.head.baseId).toBe(before.snapshots.at(-1)!.baseId);
    expect(s.snapshots.some((x) => x.id === before.headId)).toBe(false); // 미확정본만 바뀜
    for (const old of before.snapshots.slice(0, -1)) expect(s.snap(old.id)).toEqual(old);
    expect(s.checkInvariants({ deep: true })).toEqual([]);
  });

  it('0.1.0 미확정 머리를 확정 전에 지우면: 폐기되고 머리는 0.1.0 확정본으로, 확정본은 그대로', () => {
    const before = raw(draftFx);
    const s = load(draftFx);
    const e = s.entries.at(-1)!;
    expect(s.deleteEntry(e.id, s.head.confirmDueAt! - 1000).mode).toBe('discarded');
    expect(s.head.id).toBe(before.snapshots.at(-1)!.baseId);
    for (const old of before.snapshots.slice(0, -1)) expect(s.snap(old.id)).toEqual(old);
    // 그 뒤 새 기록은 0.2.0, 순번은 폐기 기록 다음
    const r = s.addEntry(ENTRIES[0]!, T_END + 2 * DAY);
    expect(r.entry.seq).toBe(before.entries.length + 1);
    expect(r.snapshot.engineVersion).toBe('0.2.0');
    expect(reopen(s).checkInvariants({ deep: true })).toEqual([]);
  });

  it('확정된 0.1.0 기록 수정은 기록만 바뀌고 스냅샷은 그대로(수정 이력 남음)', () => {
    const before = raw(confirmedFx);
    const s = load(confirmedFx);
    addAll(s, ENTRIES.slice(0, 3));
    const e = s.entries.find((x) => x.id === 'e30')!;
    expect(s.editEntry('e30', { note: '고침', amount: 99 }, e.rev, T_END + 10 * DAY).mode).toBe('record_only');
    expect(s.revisions.length).toBe(before.revisions.length + 2);
    for (const old of before.snapshots) expect(s.snap(old.id)).toEqual(old);
    expect(s.checkInvariants({ deep: true })).toEqual([]);
  });

  it('확정된 0.1.0 기록 삭제는 숨김: 스냅샷·체인은 그대로', () => {
    const before = raw(confirmedFx);
    const s = load(confirmedFx);
    expect(s.deleteEntry('e40', T_END + DAY).mode).toBe('hidden');
    for (const old of before.snapshots) expect(s.snap(old.id)).toEqual(old);
    addAll(s, ENTRIES.slice(0, 2), T_END + DAY);
    expect(reopen(s).checkInvariants({ deep: true })).toEqual([]);
  });

  it('완독: 0.2.0 기록으로 마지막 쪽에 닿으면 완독 확인 → 완성 스냅샷은 지금 엔진, 기준은 이어진 머리', () => {
    const s = load(confirmedFx);
    addAll(s, ENTRIES.slice(0, 5));
    const last = s.addEntry({ ...ENTRIES[5]!, progressValue: 3000 }, T_END + 7 * DAY);
    expect(last.needsCompletionPrompt).toBe(true);
    const headBefore = s.head.id;
    s.answerCompletion('finished', T_END + 7 * DAY + 1000);
    expect(s.lifecycle).toBe('completed');
    expect(s.head.kind).toBe('finale');
    expect(s.head.engineVersion).toBe('0.2.0');
    expect(s.head.baseId).toBe(headBefore);
    expect(contentHashOf(computeFinale(s.snap(headBefore), s.head.cfg, s.head.seq))).toBe(s.head.contentHash);
    expect(() => s.addEntry(ENTRIES[10]!, T_END + 9 * DAY)).toThrow('tank_closed');
    const e = s.entries.at(-1)!;
    expect(() => s.editEntry(e.id, { amount: 1 }, e.rev, T_END + 9 * DAY)).toThrow('amount_locked');
    expect(reopen(s).checkInvariants({ deep: true })).toEqual([]);
  });

  it('완성: 불러오자마자 완성하면 0.1.0 머리 위에 0.2.0 완성 스냅샷', () => {
    const before = raw(confirmedFx);
    const s = load(confirmedFx);
    s.finalize('completed', T_END);
    expect(s.head.kind).toBe('finale');
    expect(s.head.engineVersion).toBe('0.2.0');
    expect(s.snap(s.head.baseId!).engineVersion).toBe('0.1.0');
    for (const old of before.snapshots) expect(s.snap(old.id)).toEqual(old);
    expect(reopen(s).checkInvariants({ deep: true })).toEqual([]);
  });

  it('마무리(wrapped): 새 스냅샷 없이 닫히고 확정본은 그대로', () => {
    const before = raw(draftFx);
    const s = load(draftFx);
    s.finalize('wrapped', s.head.confirmDueAt! - 1000); // 확정 기한 전에 마무리
    expect(s.lifecycle).toBe('wrapped');
    expect(s.snapshots.length).toBe(before.snapshots.length);
    expect(body(s.head)).toEqual(body(before.snapshots.at(-1)!)); // 미확정본은 0.1.0 결과 그대로 확정
    expect(s.head.confirmReason).toBe('finalized');
  });

  it('시간대 이동으로 더 이른 날짜가 오면 마지막 날짜로 맞춘다(I4)', () => {
    const s = load(confirmedFx);
    const lastDate = s.entries.at(-1)!.localDate;
    const r = s.addEntry({ ...ENTRIES[0]!, localDate: '2026-08-02' }, T_END + DAY);
    expect(r.entry.localDate).toBe(lastDate);
    expect(s.checkInvariants({ deep: true })).toEqual([]);
  });
});

describe('5. 앱을 끄고 다시 열어도 같다', () => {
  it('저장 → 불러오기 → 저장 결과가 글자 하나까지 같다(0.1.0만, 섞인 기록 모두)', () => {
    for (const fx of [confirmedFx, draftFx]) {
      const s = load(fx);
      expect(reopen(s).toJSON()).toEqual(raw(fx));
      addAll(s, ENTRIES.slice(0, 4));
      const again = reopen(reopen(s));
      expect(again.toJSON()).toEqual(s.toJSON());
      expect(hashOf(again.head.state)).toBe(hashOf(s.head.state));
      expect(again.moss('2026-11-01')).toEqual(s.moss('2026-11-01'));
      expect(again.displayProgress()).toBe(s.displayProgress());
    }
  });

  it('중간에 끄고 다시 열어 이어 써도, 한 번에 쓴 것과 결과가 같다', () => {
    const straight = load(confirmedFx);
    addAll(straight, ENTRIES);
    let s = load(confirmedFx);
    let t = T_END;
    for (let i = 0; i < ENTRIES.length; i++) {
      s.addEntry(ENTRIES[i]!, (t += DAY));
      if (i % 7 === 3) s = reopen(s);
    }
    expect(s.toJSON()).toEqual(straight.toJSON());
  });

  it('미확정 머리를 저장했다가 열면 미확정 그대로, 확정 기한도 그대로', () => {
    const s = reopen(load(draftFx));
    expect(s.head.status).toBe('draft');
    expect(s.head.confirmDueAt).toBe(raw(draftFx).snapshots.at(-1)!.confirmDueAt);
  });
});

describe('6. 깨진 기록은 불러오지 않는다', () => {
  const broken = (fn: (d: SessionData) => void) => {
    const d = raw(confirmedFx);
    fn(d);
    return () => TankSession.fromJSON(d);
  };

  it('형식이 아니면 거부', () => {
    expect(() => TankSession.fromJSON({} as SessionData)).toThrow('session_invalid');
    expect(() => TankSession.fromJSON(null as unknown as SessionData)).toThrow('session_invalid');
  });

  it('기준 스냅샷 없음·순환·갈래(고아)·머리 없음', () => {
    expect(broken((d) => { d.snapshots[10]!.baseId = 's-none'; })).toThrow(/I5: .*기준 스냅샷/);
    expect(broken((d) => { d.snapshots[1]!.baseId = d.snapshots[5]!.id; })).toThrow('I5');
    expect(broken((d) => { d.snapshots.push({ ...d.snapshots[20]!, id: 's21-fork' }); })).toThrow(/I5: 머리에서 이어지지 않은/);
    expect(broken((d) => { d.headId = 's-none'; })).toThrow(/I5: 머리 스냅샷/);
  });

  it('스냅샷·기록 id 겹침, 기록 순번 오류, 같은 clientId 두 번', () => {
    expect(broken((d) => { d.snapshots.push(d.snapshots[3]!); })).toThrow(/I5: 스냅샷 id가 겹침/);
    expect(broken((d) => { d.entries[5]!.seq = 99; })).toThrow(/I5: 기록 순번/);
    expect(broken((d) => { d.entries[6]!.clientId = d.entries[5]!.clientId; })).toThrow(/I5: 같은 기록이 두 번/);
    expect(broken((d) => { d.entries.splice(10, 1); })).toThrow('I5');
  });

  it('0.1.0 스냅샷 내용 변조(I3), 입력·엔진 버전 표시 변조(I6)는 다시 계산 없이도 잡는다', () => {
    expect(broken((d) => { d.snapshots[12]!.state.objects[0]!.scale = 9; })).toThrow('I3');
    expect(broken((d) => { d.snapshots[12]!.input!.amount = 999; })).toThrow('I6');
    expect(broken((d) => { d.snapshots[12]!.engineVersion = '0.2.0'; })).toThrow('I6');
  });
});

describe('7. 섞인 기록 무결성 검사로 확인할 수 있는 것 / 없는 것', () => {
  it('확인할 수 있음: 지금 버전 스냅샷을 고치면 다시 계산(I2)으로 잡는다', () => {
    const s = load(confirmedFx);
    addAll(s, ENTRIES.slice(0, 3));
    const d = s.toJSON();
    const x = d.snapshots.at(-1)!;
    x.state.objects[0]!.scale = 1.9;
    x.contentHash = contentHashOf(x); // 내용 해시까지 맞춰 고쳐도
    const t = TankSession.fromJSON(d);
    expect(t.checkInvariants({ deep: true }).some((e) => e.startsWith('I2'))).toBe(true);
  });

  it('확인할 수 있음: 0.1.0 마지막 스냅샷을 고치면 그 위에 이어진 0.2.0 스냅샷의 다시 계산(I2)이 어긋나 잡힌다', () => {
    const s = load(confirmedFx);
    addAll(s, ENTRIES.slice(0, 1));
    const d = s.toJSON();
    const last010 = d.snapshots.find((x) => x.id === raw(confirmedFx).headId)!;
    last010.state.light.temp = -0.9;
    last010.contentHash = contentHashOf(last010);
    expect(TankSession.fromJSON(d).checkInvariants({ deep: true }).some((e) => e.startsWith('I2'))).toBe(true);
  });

  it('확인할 수 없음(한계): 0.1.0 중간 스냅샷의 상태와 내용 해시를 함께 고쳐 쓰면 잡지 못한다 — 0.1.0 규칙으로 다시 계산할 수 없어서', () => {
    const d = raw(confirmedFx);
    const mid = d.snapshots[20]!;
    mid.state.light.temp = -0.9;
    mid.contentHash = contentHashOf(mid);
    const s = TankSession.fromJSON(d);
    expect(s.checkInvariants({ deep: true })).toEqual([]); // 한계를 테스트로 고정(바뀌면 문서도 고쳐야 함)
    expect(s.integrityScope().notRecomputed).toBe(60);
  });
});
