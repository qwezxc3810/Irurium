import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION } from '../../engine/config';
import { GOLDEN_REPLAY } from '../../engine/__tests__/golden';
import { littlePrinceConfig, littlePrinceEntries } from '../../engine/scenarios';
import { TankSession } from '../../engine/session';
import { computeFinale } from '../../engine/compute';
import { CAPS } from '../../engine/config';
import type { Snapshot } from '../../engine/types';
import { memoryOf } from '../memory';

function play(n = 14) {
  const s = new TankSession(littlePrinceConfig());
  let t = Date.UTC(2026, 10, 13, 12);
  for (const e of littlePrinceEntries().slice(0, n)) s.addEntry(e, (t += 86_400_000));
  return s;
}

describe('기억 보기: 요소가 어떤 기록에서 생기고 자랐는지(읽기 전용)', () => {
  it('어항 속 모든 요소에 생긴 날이 있고, 그날의 기록(쪽·마음·한마디)과 엔진 변화 문구가 이어진다', () => {
    const s = play();
    const entries = littlePrinceEntries();
    for (const obj of s.head.state.objects) {
      const m = memoryOf(s.snapshots, s.entries, s.head.id, obj.id)!;
      expect(m).not.toBeNull();
      expect(m.born).not.toBeNull();
      const src = entries.find((e) => e.localDate === m.born!.date)!;
      expect(src).toBeDefined();
      // 하루 여러 번 기록한 날은 그날의 어느 기록이든 그 날짜·쪽수와 맞는다
      const sameDay = entries.filter((e) => e.localDate === m.born!.date);
      expect(sameDay.some((e) => e.progressValue === m.born!.pages?.to && e.note === m.born!.note)).toBe(true);
      expect(m.born!.entryState).toBe('ok');
    }
  });

  it('자란 날은 생긴 날 뒤에만, 날짜 순으로 나온다', () => {
    const s = play();
    for (const obj of s.head.state.objects) {
      const m = memoryOf(s.snapshots, s.entries, s.head.id, obj.id)!;
      const dates = [m.born!.date, ...m.grew.map((g) => g.date)];
      expect([...dates].sort()).toEqual(dates);
      if (obj.scale > 1) expect(m.grew.length).toBeGreaterThan(0);
    }
  });

  it('확정 후 지운 기록에서 생긴 요소는 날짜만 보이고 마음·한마디는 숨긴다', () => {
    const s = play(3);
    const target = s.head.state.objects[0]!;
    const before = memoryOf(s.snapshots, s.entries, s.head.id, target.id)!;
    const entry = s.entries.find((e) => e.localDate === before.born!.date)!;
    s.addEntry(littlePrinceEntries()[3]!, Date.UTC(2026, 10, 30)); // 다음 기록 → 앞 기록 확정
    s.deleteEntry(entry.id, Date.UTC(2026, 10, 30, 1));
    const after = memoryOf(s.snapshots, s.entries, s.head.id, target.id)!;
    expect(after.born!.entryState).toBe('hidden');
    expect(after.born!.note).toBe('');
    expect(after.born!.chips).toEqual([]);
    expect(after.born!.date).toBe(before.born!.date);
  });

  it('없는 요소면 null, 엔진·골든은 그대로', () => {
    const s = play(2);
    expect(memoryOf(s.snapshots, s.entries, s.head.id, 'nope')).toBeNull();
    expect(ENGINE_VERSION).toBe('0.2.0');
    expect(TankSession.replay(littlePrinceConfig(), littlePrinceEntries())).toBe(GOLDEN_REPLAY[ENGINE_VERSION]);
  });

  it('완독: 대표 생물이 새로 생기면 "완성한 날"(완성 시각의 관장 날짜)과 엔진 문구, 마지막 기록의 마음은 쓰지 않는다', () => {
    const s = play();
    const at = Date.UTC(2026, 10, 30, 16, 30); // 서울 기준 12월 1일 01:30
    s.finalize('completed', at);
    const c = s.head.changes.find((x) => x.level === 'finale' && x.objectId)!;
    expect(c.text).toContain('대표 생물이 되었어요');
    const m = memoryOf(s.snapshots, s.entries, s.head.id, c.objectId!, 'Asia/Seoul')!;
    expect(m.born).not.toBeNull(); // '처음부터 있던 요소' 아님
    expect(m.born!.kind).toBe('finale');
    expect(m.born!.date).toBe('2026-12-01');
    expect(m.born!.text).toBe(c.text);
    expect(m.born!.chips).toEqual([]);
    expect(m.born!.note).toBe('');
    expect(m.born!.pages).toBeNull();
  });

  it('완독: 자리가 없어 가장 오래된 물고기가 대표가 되면 원래 생긴 날은 그대로, "대표 생물이 된 날"이 더해진다', () => {
    const s = play();
    const head = s.head;
    const oldest = [...head.state.objects].filter((o) => o.kind === 'fish').sort((a, b) => a.bornSeq - b.bornSeq)[0]!;
    // 물고기 상한까지 채운 상태를 만들어 실제 엔진 computeFinale의 '승격' 경로를 탄다
    const full = structuredClone(head);
    let n = 900;
    while (full.state.objects.filter((o) => o.kind === 'fish').length < CAPS.fish) full.state.objects.push({ ...oldest, id: `o${n++}`, bornSeq: 999 });
    const out = computeFinale(full, head.cfg, head.seq);
    const promo = out.changes.find((x) => x.objectId === oldest.id)!;
    expect(promo.text.startsWith('가장 오래 함께한 물고기')).toBe(true);
    const fin: Snapshot = { ...head, id: 'fin', baseId: head.id, kind: 'finale', entryId: null, input: null, state: out.state, ledger: out.ledger, changes: out.changes, confirmedAt: Date.UTC(2026, 10, 28, 3) };
    const before = memoryOf(s.snapshots, s.entries, head.id, oldest.id)!;
    const m = memoryOf([...s.snapshots, fin], s.entries, 'fin', oldest.id, 'Asia/Seoul')!;
    expect(m.born).toEqual(before.born);
    const last = m.grew.at(-1)!;
    expect(last.kind).toBe('finale');
    expect(last.date).toBe('2026-11-28');
    expect(last.text).toBe(promo.text);
    expect(last.chips).toEqual([]);
  });
});
