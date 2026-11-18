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
 * - 0.3.0 감정 흔적이 하루 상한으로 미뤄졌다가 나중 기록에서 놓이면 변화에 원래 기록 순번(sourceSeq)이 있다.
 *   그때는 놓인 날의 기록이 아니라 원래 기록(날짜·쪽·마음·한마디)을 보여 준다.
 * - 한 스냅샷에서 같은 요소가 여러 번 바뀌면(완독 채움에서 여러 단계 자람 등) 변화마다 따로 보여 준다.
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
  const bySeq = new Map(chain.filter((s) => s.kind === 'entry').map((s) => [s.seq, s]));
  const at = (i: number, kind: MemoryMoment['kind'], c: Change | undefined) => {
    const s = chain[i]!;
    // 미뤄 둔 흔적: 원래 기록을 보여 준다(문구는 놓일 때의 것)
    const src = c?.sourceSeq !== undefined ? bySeq.get(c.sourceSeq) : undefined;
    if (src) return momentOf(src, kind === 'born' ? 'born' : 'grew', c, entryMap);
    return s.kind === 'finale' ? finaleMoment(s, c, prevDateAt(i), timeZone) : momentOf(s, kind, c, entryMap);
  };
  for (let i = Math.max(bornIndex, 1); i < chain.length; i++) {
    const cs = chain[i]!.changes.filter((x) => x.objectId === objectId);
    cs.forEach((c, k) => {
      if (i === bornIndex && k === 0) {
        born = at(i, 'born', c);
        return;
      }
      const m = at(i, c.level === 'finale' ? 'finale' : 'grew', c);
      if (m) grew.push(m);
    });
  }
  // 생긴 스냅샷에 그 요소를 가리키는 변화가 없으면(드묾) 스냅샷 기록으로
  if (bornIndex > 0 && !born) born = at(bornIndex, 'born', undefined);
  return { objectId, name, born, grew };
}
