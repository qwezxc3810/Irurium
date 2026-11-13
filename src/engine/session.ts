import { CONFIRM_AFTER_MS, ENGINE_VERSION } from './config';
import { computeFinale, computeSnapshot, genesisState } from './compute';
import { maxDate } from './dates';
import { computeMoss, setRestDays, type MossResult } from './moss';
import { hashOf } from './random';
import type {
  ConfirmReason, EngineInput, EngineOutput, Entry, EntryRevision, ISODate, Lifecycle, RestRule, Snapshot, TankConfig, TankState,
} from './types';

/**
 * 어항 하나의 기록·스냅샷 관리(메모리). 서버가 생기면 같은 규칙을 서버 트랜잭션으로 옮긴다.
 * 근거: v0.3.2 보완서 2장(상태 전이)·3장(완독)·4장(쉬는 날).
 *
 * 불변 규칙
 *  I1 미확정 스냅샷은 최대 1개, 삭제되지 않은 가장 마지막 기록의 것
 *  I2 스냅샷 n = computeSnapshot(직전 확정 스냅샷, 기록 n)
 *  I3 확정 스냅샷은 다시 계산하지 않는다(만든 뒤 내용이 바뀌지 않는다)
 *  I4 기록의 localDate는 줄어들지 않는다(미확정 상태에서 폐기한 기록은 기록 흐름에서 빠지므로 제외)
 */

function contentHashOf(o: Pick<EngineOutput, 'state' | 'ledger' | 'changes'>): string {
  return hashOf({ state: o.state, ledger: o.ledger, changes: o.changes });
}

export interface NewEntry {
  clientId: string;
  localDate: ISODate;
  amount: number;
  progressValue: number | null;
  moodChips: string[];
  note: string;
}

export type EntryPatch = Partial<Pick<EngineInput, 'moodChips' | 'note' | 'amount' | 'progressValue'>>;

export interface SaveResult {
  entry: Entry;
  snapshot: Snapshot;
  duplicate: boolean;
  /** 마지막 쪽에 도달해 완독 확인이 필요하다 */
  needsCompletionPrompt: boolean;
}

export interface SessionData {
  cfg: TankConfig;
  lifecycle: Lifecycle;
  entries: Entry[];
  snapshots: Snapshot[];
  revisions: EntryRevision[];
  restRules: RestRule[];
  headId: string;
  completionPrompt: boolean;
}

export class TankSession {
  private d: SessionData;

  constructor(cfg: TankConfig, restWeekdays = 0) {
    const g = genesisState(cfg);
    const genesis: Snapshot = {
      id: 's0', seq: 0, entryId: null, baseId: null, kind: 'genesis', state: g.state, ledger: g.ledger, changes: [],
      engineVersion: ENGINE_VERSION, inputHash: hashOf({ cfg }), input: null, cfg, contentHash: contentHashOf({ ...g, changes: [] }),
      status: 'confirmed', confirmDueAt: null, confirmedAt: 0, confirmReason: 'genesis',
    };
    this.d = {
      cfg, lifecycle: 'active', entries: [], snapshots: [genesis], revisions: [],
      restRules: [{ weekdays: restWeekdays, effectiveFrom: cfg.startDate }], headId: genesis.id, completionPrompt: false,
    };
  }

  // ───────── 조회 ─────────
  get cfg() { return this.d.cfg; }
  get lifecycle() { return this.d.lifecycle; }
  get entries(): readonly Entry[] { return this.d.entries; }
  get snapshots(): readonly Snapshot[] { return this.d.snapshots; }
  get revisions(): readonly EntryRevision[] { return this.d.revisions; }
  get restRules(): readonly RestRule[] { return this.d.restRules; }
  get completionPrompt() { return this.d.completionPrompt; }
  get head(): Snapshot { return this.snap(this.d.headId); }

  snap(id: string): Snapshot {
    const s = this.d.snapshots.find((x) => x.id === id);
    if (!s) throw new Error(`snapshot_not_found:${id}`);
    return s;
  }

  snapshotOfEntry(entryId: string): Snapshot | undefined {
    return this.d.snapshots.find((s) => s.entryId === entryId && s.kind === 'entry');
  }

  /** 화면에 보이는 진행량: 숨기지 않은 기록의 최댓값(엔진 원장과 별개로 다시 집계). */
  displayProgress(): number {
    return this.d.entries.filter((e) => !e.deletedAt).reduce((m, e) => Math.max(m, e.progressValue ?? 0), 0);
  }

  /**
   * 어항의 기록 흐름에 속한 기록: 폐기(discarded)한 것만 뺀다.
   * 확정 후 숨긴(hidden) 기록은 스냅샷이 남아 있고 그 날짜가 엔진 원장에도 들어 있으므로 포함한다.
   * 날짜 보정(I4), 이끼 기준일, I4 검사가 모두 이 목록을 쓴다.
   */
  private chainEntries(): Entry[] {
    return this.d.entries.filter((e) => e.deleteMode !== 'discarded');
  }

  /**
   * 이끼·쉬는 중 계산의 기준일(v0.3.2 보완서 4.3).
   * 확정 후 숨긴 기록(hidden)은 활동한 사실이 있으므로 포함한다. 지웠다고 이끼가 갑자기 생기지 않게 하려는 것.
   * 미확정 상태에서 지운 기록(discarded)은 실수 입력으로 보고 제외한다.
   */
  lastActivityDate(): ISODate {
    return this.chainEntries().reduce<ISODate>((m, e) => maxDate(m, e.localDate), this.d.cfg.startDate);
  }

  moss(today: ISODate): MossResult {
    return computeMoss({ lifecycle: this.d.lifecycle, lastActivityDate: this.lastActivityDate(), today, rules: [...this.d.restRules] });
  }

  // ───────── 확정 ─────────
  /** 읽기·쓰기 전에 부른다. 24시간이 지났으면 그 자리에서 확정. */
  confirmIfDue(now: number): boolean {
    const h = this.head;
    if (h.status === 'draft' && h.confirmDueAt !== null && now >= h.confirmDueAt) {
      this.confirm(h, 'timeout', now);
      return true;
    }
    return false;
  }

  confirmHead(reason: ConfirmReason, now: number) {
    const h = this.head;
    if (h.status === 'draft') this.confirm(h, reason, now);
  }

  private confirm(s: Snapshot, reason: ConfirmReason, now: number) {
    s.status = 'confirmed';
    s.confirmedAt = now;
    s.confirmReason = reason;
    s.confirmDueAt = null;
  }

  // ───────── 저장 ─────────
  addEntry(req: NewEntry, now: number): SaveResult {
    const dup = this.d.entries.find((e) => e.clientId === req.clientId);
    if (dup) {
      return { entry: dup, snapshot: this.snapshotOfEntry(dup.id) ?? this.head, duplicate: true, needsCompletionPrompt: false };
    }
    if (this.d.lifecycle !== 'active') throw new Error('tank_closed');
    this.confirmIfDue(now);
    const head = this.head;
    if (head.status === 'draft') this.confirm(head, 'next_entry', now);

    // I4: 기록 흐름(폐기 기록 제외)의 마지막 날짜보다 이르면 그 날짜로 맞춘다(시간대 이동 대응)
    const lastDate = this.chainEntries().reduce<ISODate | null>((m, e) => (m && m > e.localDate ? m : e.localDate), null);
    const localDate = lastDate && req.localDate < lastDate ? lastDate : req.localDate;
    const seq = this.d.entries.length + 1;
    const entry: Entry = {
      id: `e${seq}`, clientId: req.clientId, seq, localDate, amount: Math.max(0, req.amount), progressValue: req.progressValue,
      moodChips: [...req.moodChips], note: req.note, createdAt: now, rev: 1, deletedAt: null, deleteMode: null,
    };
    this.d.entries.push(entry);
    const snap = this.computeDraft(entry, head);
    snap.confirmDueAt = now + CONFIRM_AFTER_MS;
    this.d.snapshots.push(snap);
    this.d.headId = snap.id;
    const prompt = this.reachedEnd(entry);
    if (prompt) this.d.completionPrompt = true;
    return { entry, snapshot: snap, duplicate: false, needsCompletionPrompt: prompt };
  }

  private computeDraft(entry: Entry, base: Snapshot): Snapshot {
    const input = toInput(entry);
    const cfg = this.d.cfg;
    const out = computeSnapshot(base, input, cfg);
    return {
      id: `s${entry.seq}-r${entry.rev}`, seq: entry.seq, entryId: entry.id, baseId: base.id, kind: 'entry',
      state: out.state, ledger: out.ledger, changes: out.changes, engineVersion: ENGINE_VERSION,
      inputHash: hashOf({ base: base.inputHash, input, v: ENGINE_VERSION }),
      input: JSON.parse(JSON.stringify(input)) as EngineInput, cfg, contentHash: contentHashOf(out),
      status: 'draft', confirmDueAt: null, confirmedAt: null, confirmReason: null,
    };
  }

  private reachedEnd(e: Entry): boolean {
    const total = this.d.cfg.goal.totalUnits;
    return this.d.lifecycle === 'active' && total !== null && e.progressValue !== null && e.progressValue >= total;
  }

  // ───────── 수정·삭제 ─────────
  editEntry(id: string, patch: EntryPatch, expectedRev: number, now: number): { mode: 'recomputed' | 'record_only' } {
    this.confirmIfDue(now);
    const entry = this.d.entries.find((e) => e.id === id);
    if (!entry || entry.deletedAt) throw new Error('entry_not_found');
    if (entry.rev !== expectedRev) throw new Error('conflict');
    const snap = this.snapshotOfEntry(id);
    if (snap && snap.status === 'draft' && this.d.lifecycle === 'active') {
      Object.assign(entry, sanitize(patch));
      entry.rev += 1;
      const base = this.snap(snap.baseId!);
      const next = this.computeDraft(entry, base);
      next.confirmDueAt = snap.confirmDueAt;
      this.d.snapshots = this.d.snapshots.filter((s) => s.id !== snap.id);
      this.d.snapshots.push(next);
      this.d.headId = next.id;
      this.d.completionPrompt = this.reachedEnd(entry);
      return { mode: 'recomputed' };
    }
    if (this.d.lifecycle !== 'active' && ('amount' in patch || 'progressValue' in patch)) throw new Error('amount_locked');
    for (const [field, after] of Object.entries(sanitize(patch)) as Array<[keyof EngineInput, unknown]>) {
      this.d.revisions.push({ entryId: id, at: now, field, before: entry[field], after });
    }
    Object.assign(entry, sanitize(patch));
    entry.rev += 1;
    return { mode: 'record_only' }; // 스냅샷은 건드리지 않는다(I3)
  }

  deleteEntry(id: string, now: number): { mode: 'discarded' | 'hidden' } {
    this.confirmIfDue(now);
    const entry = this.d.entries.find((e) => e.id === id);
    if (!entry || entry.deletedAt) throw new Error('entry_not_found');
    const snap = this.snapshotOfEntry(id);
    entry.deletedAt = now;
    if (snap && snap.status === 'draft') {
      entry.deleteMode = 'discarded';
      this.d.snapshots = this.d.snapshots.filter((s) => s.id !== snap.id);
      this.d.headId = snap.baseId!;
      this.d.completionPrompt = false;
      return { mode: 'discarded' };
    }
    entry.deleteMode = 'hidden';
    return { mode: 'hidden' };
  }

  // ───────── 완성·마무리 ─────────
  finalize(kind: 'completed' | 'wrapped', now: number) {
    if (this.d.lifecycle !== 'active') return;
    this.confirmIfDue(now);
    const head = this.head;
    if (head.status === 'draft') this.confirm(head, 'finalized', now);
    if (kind === 'completed') {
      const out = computeFinale(head, this.d.cfg, head.seq);
      const s: Snapshot = {
        id: `s${head.seq}-finale`, seq: head.seq, entryId: null, baseId: head.id, kind: 'finale', state: out.state, ledger: out.ledger,
        changes: out.changes, engineVersion: ENGINE_VERSION, inputHash: hashOf({ base: head.inputHash, finale: true, v: ENGINE_VERSION }),
        input: null, cfg: this.d.cfg, contentHash: contentHashOf(out),
        status: 'confirmed', confirmDueAt: null, confirmedAt: now, confirmReason: 'finalized',
      };
      this.d.snapshots.push(s);
      this.d.headId = s.id;
    }
    this.d.lifecycle = kind;
    this.d.completionPrompt = false;
  }

  answerCompletion(answer: 'finished' | 'not_yet', now: number) {
    if (answer === 'finished') this.finalize('completed', now);
    else this.d.completionPrompt = false;
  }

  /** 이 어항에서만 총 쪽수를 고친다. 미확정 스냅샷은 새 기준으로 다시 계산. */
  fixTotal(total: number, now: number) {
    this.d.cfg = { ...this.d.cfg, goal: { ...this.d.cfg.goal, totalUnits: total } };
    const h = this.head;
    if (h.status === 'draft' && h.entryId) {
      const e = this.d.entries.find((x) => x.id === h.entryId)!;
      this.editEntry(e.id, {}, e.rev, now);
    }
    this.d.completionPrompt = false;
  }

  // ───────── 쉬는 날 ─────────
  setRestDays(weekdays: number, today: ISODate) {
    this.d.restRules = setRestDays(this.d.restRules, today, weekdays);
  }

  // ───────── 검사 ─────────
  /**
   * 불변 규칙 I1~I4 검사. 위반 내용을 문자열 목록으로 돌려준다(비어 있으면 통과).
   * deep=true면 모든 스냅샷을 저장된 입력으로 다시 계산해 결과가 같은지(I2) 확인한다. 기록 수에 비례해 느려지므로
   * 화면에서 매번 부를 때는 deep=false, 테스트·재현성 확인 버튼에서는 deep=true.
   */
  checkInvariants(opts: { deep?: boolean } = {}): string[] {
    const deep = opts.deep ?? true;
    const errors: string[] = [];
    // I1
    const drafts = this.d.snapshots.filter((s) => s.status === 'draft');
    if (drafts.length > 1) errors.push('I1: 미확정 스냅샷이 2개 이상');
    const live = this.d.entries.filter((e) => !e.deletedAt);
    const lastLive = live[live.length - 1];
    if (drafts[0] && drafts[0].entryId !== lastLive?.id) errors.push('I1: 미확정 스냅샷이 마지막 기록의 것이 아님');
    if (drafts[0] && this.d.headId !== drafts[0].id) errors.push('I1: 미확정 스냅샷이 머리가 아님');
    for (const s of this.d.snapshots) {
      // I2: 기준은 항상 확정본
      if (s.baseId && this.snap(s.baseId).status !== 'confirmed') errors.push(`I2: ${s.id}의 기준이 확정본이 아님`);
      // I3: 만든 뒤 내용이 바뀌지 않았는지
      if (contentHashOf(s) !== s.contentHash) errors.push(`I3: ${s.id}의 내용이 만든 뒤 바뀜`);
      // I2: 저장된 입력으로 다시 계산하면 같은 결과
      if (deep && s.baseId) {
        const base = this.snap(s.baseId);
        const again = s.kind === 'finale' ? computeFinale(base, s.cfg, s.seq) : s.input ? computeSnapshot(base, s.input, s.cfg) : null;
        if (!again) errors.push(`I2: ${s.id}에 계산 입력이 없음`);
        else if (contentHashOf(again) !== s.contentHash) errors.push(`I2: ${s.id}를 다시 계산하면 결과가 다름`);
      }
    }
    // I4
    const chain = this.chainEntries();
    for (let i = 1; i < chain.length; i++) {
      if (chain[i]!.localDate < chain[i - 1]!.localDate) errors.push('I4: localDate 감소');
    }
    return errors;
  }

  /** 같은 기록을 새 세션에 넣었을 때의 어항 상태. 시드·배치 비교 테스트용. */
  static replayState(cfg: TankConfig, inputs: NewEntry[]): TankState {
    const s = new TankSession(cfg);
    let t = 0;
    for (const i of inputs) s.addEntry(i, (t += 1000));
    return s.head.state;
  }

  /**
   * 같은 기록을 새 세션에 다시 넣었을 때의 머리 해시(기록 체인 해시 + 상태 해시).
   * 어항 설정(시드 포함)도 해시에 들어가므로 "같은 설정·같은 기록 → 같은 결과" 확인에만 쓴다.
   * 시드별 배치 차이를 비교할 때는 replayState()로 상태만 비교한다.
   */
  static replay(cfg: TankConfig, inputs: NewEntry[]): string {
    const s = new TankSession(cfg);
    let t = 0;
    for (const i of inputs) s.addEntry(i, (t += 1000));
    return s.head.inputHash + ':' + hashOf(s.head.state);
  }

  toJSON(): SessionData {
    return JSON.parse(JSON.stringify(this.d)) as SessionData;
  }
}

function toInput(e: Entry): EngineInput {
  return { seq: e.seq, localDate: e.localDate, amount: e.amount, progressValue: e.progressValue, moodChips: e.moodChips, note: e.note };
}

function sanitize(p: EntryPatch): EntryPatch {
  const out: EntryPatch = {};
  if (p.moodChips) out.moodChips = [...p.moodChips];
  if (p.note !== undefined) out.note = p.note;
  if (p.amount !== undefined) out.amount = Math.max(0, p.amount);
  if (p.progressValue !== undefined) out.progressValue = p.progressValue;
  return out;
}
