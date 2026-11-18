import { elementOf } from '../engine/catalog';
import { localDateIn } from '../engine/dates';
import type { Change, Entry, Snapshot } from '../engine/types';

/**
 * 기억 보기: 어항 속 요소 하나가 어떤 기록에서 생기고 자랐는지 찾는다.
 * 읽기 전용이다. 엔진·스냅샷을 바꾸지 않고, 이미 저장된 스냅샷(계산에 쓴 기록 입력 + 변화 목록)만 읽는다.
 *
 * - 머리 스냅샷에서 baseId를 따라 0번(빈 어항)까지 거슬러 간 사슬만 본다(폐기된 미확정 스냅샷은 사슬에 없다).
 * - "생긴 날" = 사슬에서 그 요소가 처음 나타난 스냅샷. "자란 날" = 그 뒤 그 요소를 가리키는 변화가 있는 스냅샷.
 * - 내용은 그때 계산에 쓴 입력(snapshot.input)으로 보여 준다. 나중에 기록을 고쳐도 "왜 생겼는지"는 그대로라서다.
 * - 확정 후 지운(숨김) 기록은 어항엔 남지만, 날짜만 보이고 마음·한마디는 보이지 않는다.
 * - 완독(finale) 스냅샷은 기록 입력이 없다(input = null). 마지막 독서 기록의 마음·한마디를 완독의 이유처럼 보여 주지 않고,
 *   날짜(완성 확정 시각을 관장 시간대 날짜로)와 엔진의 완성 문구만 보여 준다. 시각이 없으면 그 직전 기록 날짜를 쓴다.
 */
export interface MemoryMoment {
  kind: 'born' | 'grew' | 'finale';
  date: string;
  /** 읽은 쪽 범위(독서). 없으면 null */
  pages: { from: number; to: number } | null;
  chips: string[];
  note: string;
  /** 엔진이 남긴 변화 문구 */
  text: string | null;
  /** hidden: 확정 후 지운 기록, edited: 그 뒤에 기록을 고침 */
  entryState: 'ok' | 'hidden' | 'edited';
}

export interface ObjectMemory {
  objectId: string;
  name: string;
  /** 처음부터 있던 요소(0번 스냅샷)면 null */
  born: MemoryMoment | null;
  grew: MemoryMoment[];
}

function chainOf(snapshots: readonly Snapshot[], headId: string): Snapshot[] {
  const byId = new Map(snapshots.map((s) => [s.id, s]));
  const out: Snapshot[] = [];
  const seen = new Set<string>();
  for (let s = byId.get(headId); s && !seen.has(s.id); s = s.baseId ? byId.get(s.baseId) : undefined) {
    seen.add(s.id);
    out.push(s);
  }
  return out.reverse();
}

function finaleMoment(snap: Snapshot, change: Change | undefined, prevDate: string | null, timeZone: string): MemoryMoment | null {
  const date = snap.confirmedAt != null ? localDateIn(snap.confirmedAt, timeZone) : prevDate;
  if (!date) return null;
  return { kind: 'finale', date, pages: null, chips: [], note: '', text: change?.text ?? null, entryState: 'ok' };
}

function momentOf(snap: Snapshot, kind: MemoryMoment['kind'], change: Change | undefined, entries: ReadonlyMap<string, Entry>): MemoryMoment | null {
  const input = snap.input;
  if (!input) return null;
  const entry = snap.entryId ? entries.get(snap.entryId) : undefined;
  const hidden = !!entry?.deletedAt;
  const edited = !hidden && !!entry && entry.rev > 1;
  const pages = input.progressValue != null && input.amount > 0
    ? { from: Math.max(1, input.progressValue - input.amount + 1), to: input.progressValue }
    : null;
  return {
    kind,
    date: input.localDate,
    pages: hidden ? null : pages,
    chips: hidden ? [] : [...input.moodChips],
    note: hidden ? '' : input.note,
    text: hidden ? null : change?.text ?? null,
    entryState: hidden ? 'hidden' : edited ? 'edited' : 'ok',
  };
}

/** timeZone: 완독 날짜를 정할 관장 시간대(앱 화면과 같은 값) */
export function memoryOf(snapshots: readonly Snapshot[], entries: readonly Entry[], headId: string, objectId: string, timeZone = 'Asia/Seoul'): ObjectMemory | null {
  const chain = chainOf(snapshots, headId);
  const head = chain.at(-1);
  const obj = head?.state.objects.find((o) => o.id === objectId);
  if (!head || !obj) return null;
  const entryMap = new Map(entries.map((e) => [e.id, e]));
  const name = elementOf(head.state.themeId, obj.el)?.name ?? obj.el;

  let born: MemoryMoment | null = null;
  let bornIndex = -1;
  for (let i = 0; i < chain.length; i++) {
    if (chain[i]!.state.objects.some((o) => o.id === objectId)) { bornIndex = i; break; }
  }
  const grew: MemoryMoment[] = [];
  // 사슬에서 그 스냅샷 직전까지의 마지막 기록 날짜(완독 시각이 없을 때 대신 씀)
  const prevDateAt = (i: number) => { for (let j = i - 1; j >= 0; j--) { const d = chain[j]!.input?.localDate; if (d) return d; } return null; };
  const at = (i: number, kind: MemoryMoment['kind'], c: Change | undefined) => {
    const s = chain[i]!;
    return s.kind === 'finale' ? finaleMoment(s, c, prevDateAt(i), timeZone) : momentOf(s, kind, c, entryMap);
  };
  if (bornIndex > 0) born = at(bornIndex, 'born', chain[bornIndex]!.changes.find((c) => c.objectId === objectId));
  for (let i = Math.max(bornIndex + 1, 1); i < chain.length; i++) {
    const c = chain[i]!.changes.find((x) => x.objectId === objectId);
    if (!c) continue;
    const m = at(i, c.level === 'finale' ? 'finale' : 'grew', c);
    if (m) grew.push(m);
  }
  return { objectId, name, born, grew };
}
