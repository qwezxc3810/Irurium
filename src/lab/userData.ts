import { computeFinale, computeSnapshot } from '../engine/compute';
import { ENGINE_VERSION } from '../engine/config';
import { addDays, daysBetween } from '../engine/dates';
import { computeMoss } from '../engine/moss';
import { hashOf } from '../engine/random';
import type { SessionData } from '../engine/session';
import type { Lifecycle, Snapshot } from '../engine/types';
import { frameMetrics } from './metrics';
import { eventsOf } from './runner';
import { SAMPLE_PREFIX, type DayFrame, type RunResult, type SampleTank, type ScriptedEntry } from './types';

/**
 * 실제 기록(앱에서 내보낸 SessionData)을 검증실에서 읽기 전용으로 보기.
 * - 가져오자마자 깊게 얼린다(Object.freeze). 검증 코드가 실수로 값을 바꾸면 그 자리에서 오류가 난다.
 * - 저장된 스냅샷을 그대로 보여 준다. 다시 계산한 결과로 바꿔치기하지 않는다.
 * - 무결성 확인은 "다시 계산해서 저장된 해시와 비교"만 하고, 결과를 어디에도 쓰지 않는다.
 * - 시드를 바꿔 보는 실험은 기록을 복사해 별도 어항(derived)으로 돌린다.
 */

export const LAB_IMPORT_KEY = 'irurium.lab.import';
const MAX_DAYS = 400;

export function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v as object)) deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
}

export function parseUserData(json: string): Readonly<SessionData> {
  let d: SessionData;
  try {
    d = JSON.parse(json) as SessionData;
  } catch {
    throw new Error('JSON 형식이 아니에요.');
  }
  if (!d || typeof d !== 'object' || !d.cfg || !Array.isArray(d.entries) || !Array.isArray(d.snapshots) || typeof d.headId !== 'string') {
    throw new Error('이루리움 어항 기록(SessionData) 형식이 아니에요.');
  }
  if (d.cfg.tankId.startsWith(SAMPLE_PREFIX)) throw new Error('샘플 어항은 실제 기록으로 가져올 수 없어요.');
  if (!d.snapshots.some((s) => s.id === d.headId)) throw new Error('머리 스냅샷을 찾을 수 없어요.');
  return deepFreeze(d);
}

/** 머리에서 기준(baseId)을 따라 거슬러 올라간 실제 어항 흐름. 폐기된 초안은 들어 있지 않다. */
export function liveChain(d: Readonly<SessionData>): Snapshot[] {
  const byId = new Map(d.snapshots.map((s) => [s.id, s]));
  const out: Snapshot[] = [];
  let cur = byId.get(d.headId);
  const guard = new Set<string>();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    out.push(cur);
    cur = cur.baseId ? byId.get(cur.baseId) : undefined;
  }
  return out.reverse();
}

const contentHashOf = (s: Pick<Snapshot, 'state' | 'ledger' | 'changes'>) => hashOf({ state: s.state, ledger: s.ledger, changes: s.changes });

export interface IntegrityReport {
  checked: number;
  problems: string[];
  /** 다른 엔진 버전으로 만든 스냅샷 수. 지금 엔진으로 다시 계산하면 달라지는 게 정상이라 I2(재계산)는 건너뛰고 I3(내용 해시)만 본다 */
  otherVersion: number;
  versions: string[];
  fingerprint: string;
}

/**
 * 읽기만 한다. 검사 범위:
 * - I3 내용 해시: 상태·원장·변화 문구(state·ledger·changes)가 만든 뒤 바뀌지 않았는지. 연결 정보(baseId·seq·input)는 이 해시에 들어 있지 않다.
 * - I4 기준 체인: 버전과 관계없이 모든 스냅샷의 기준(baseId)이 있고, 순번이 맞고, 순환 없이 시작 스냅샷까지 이어지는지. 머리(headId)가 있는지.
 * - I2 다시 계산: 지금 엔진 버전으로 만든 스냅샷만. 다른 버전은 저장된 결과가 정답이라 건너뛴다.
 *   그래서 다른 버전 스냅샷의 입력(input)만 바꾼 경우는 잡지 못한다(화면에 범위를 함께 표시).
 */
export function verifyUserData(d: Readonly<SessionData>): IntegrityReport {
  const byId = new Map(d.snapshots.map((s) => [s.id, s]));
  const problems: string[] = [];
  let otherVersion = 0;
  if (!byId.has(d.headId)) problems.push(`머리 스냅샷 없음: ${d.headId}(I4)`);
  for (const s of d.snapshots) {
    if (contentHashOf(s) !== s.contentHash) problems.push(`${s.id}: 저장된 내용이 만든 뒤 바뀜(I3)`);
    const chain = chainProblem(s, byId);
    if (chain) { problems.push(`${s.id}: ${chain}(I4)`); continue; }
    if (!s.baseId) continue;
    // 그 전 엔진으로 만든 스냅샷은 저장된 결과가 정답이다. 지금 엔진으로 다시 계산해 비교(I2)만 하지 않는다.
    if (s.engineVersion !== ENGINE_VERSION) { otherVersion++; continue; }
    const base = byId.get(s.baseId)!;
    const again = s.kind === 'finale' ? computeFinale(base, s.cfg, s.seq) : s.input ? computeSnapshot(base, s.input, s.cfg) : null;
    if (!again) problems.push(`${s.id}: 계산 입력 없음`);
    else if (contentHashOf(again) !== s.contentHash) problems.push(`${s.id}: 다시 계산하면 결과가 다름(I2)`);
  }
  const versions = [...new Set(d.snapshots.map((s) => s.engineVersion))].sort();
  return { checked: d.snapshots.length, problems, otherVersion, versions, fingerprint: fingerprintOf(d) };
}

/** I4: 이 스냅샷에서 기준을 따라가면 순환 없이 시작 스냅샷(genesis)에 닿는지, 각 단계 순번이 맞는지 */
function chainProblem(s: Snapshot, byId: Map<string, Snapshot>): string | null {
  if (!s.baseId) return s.kind === 'genesis' ? null : '기준(baseId)이 비어 있음';
  if (s.kind === 'genesis') return '시작 스냅샷에 기준이 있음';
  const seen = new Set<string>([s.id]);
  let cur: Snapshot = s;
  while (cur.baseId) {
    const base = byId.get(cur.baseId);
    if (!base) return cur === s ? '기준 스냅샷 없음' : `기준 체인이 끊김(${cur.id} → ${cur.baseId})`;
    const seqOk = cur.kind === 'finale' ? base.seq === cur.seq : base.seq < cur.seq;
    if (!seqOk) return `기준 순번이 맞지 않음(${cur.id} #${cur.seq} → ${base.id} #${base.seq})`;
    if (seen.has(base.id)) return '기준 체인이 순환함';
    seen.add(base.id);
    cur = base;
  }
  return cur.kind === 'genesis' ? null : '기준 체인이 시작 스냅샷에 닿지 않음';
}

export function fingerprintOf(d: Readonly<SessionData>): string {
  return hashOf(d.snapshots.map((s) => s.contentHash));
}

const snapDate = (s: Snapshot, chain: Snapshot[]): string | null => {
  if (s.input) return s.input.localDate;
  if (s.kind === 'finale') {
    const base = chain.find((x) => x.id === s.baseId);
    return base?.input?.localDate ?? null;
  }
  return null;
};

/** 저장된 스냅샷만으로 날짜별 프레임을 만든다(다시 계산하지 않음). */
export function userRun(d: Readonly<SessionData>): RunResult {
  const chain = liveChain(d);
  const start = d.cfg.startDate;
  const dated = chain.map((s) => ({ s, date: snapDate(s, chain) }));
  const lastDate = dated.reduce((m, x) => (x.date && x.date > m ? x.date : m), start);
  const days = Math.min(MAX_DAYS, daysBetween(start, lastDate) + 1);
  const frames: DayFrame[] = [];
  const snapDay = new Map<string, number>([[chain[0]?.id ?? 's0', 0]]);
  let head = chain[0]!;
  let idx = 1;
  for (let day = 1; day <= days; day++) {
    const date = addDays(start, day - 1);
    const today: Snapshot[] = [];
    while (idx < dated.length && (dated[idx]!.date ?? '') <= date) {
      head = dated[idx]!.s;
      today.push(head);
      snapDay.set(head.id, day);
      idx++;
    }
    const lastActivity = dated.filter((x) => x.s.input && x.date && x.date <= date).reduce((m, x) => (x.date! > m ? x.date! : m), start);
    // 완성은 완성 스냅샷(finale)이 생긴 날부터 알 수 있다.
    // 마무리(wrapped)는 스냅샷을 추가하지 않고 머리를 고정하는 정책이라(v0.3.2 3.3) 마무리한 날짜가 데이터에 없다.
    // 그래서 지난 날짜로 소급하지 않고, 마지막 프레임(마지막 기록 날짜)에만 저장된 lifecycle을 적용한다. 그 뒤 날짜는 만들지 않는다.
    const lifecycle: Lifecycle = head.kind === 'finale' ? 'completed' : day === days && d.lifecycle !== 'active' ? d.lifecycle : 'active';
    frames.push({
      day, date, state: head.state,
      moss: computeMoss({ lifecycle, lastActivityDate: lastActivity, today: date, rules: [...d.restRules] }).stage,
      entries: today.filter((s) => s.kind === 'entry').length,
      changes: today.flatMap((s) => s.changes),
      lifecycle,
      progress: head.ledger.maxProgress,
      lightUsed: head.ledger.dayLightShift.date === date ? head.ledger.dayLightShift.used : 0,
      metrics: frameMetrics(head.state),
    });
  }
  const trail = head.ledger.moodTrail;
  const integrity = verifyUserData(d);
  return {
    key: 'USER', label: '내 어항(실제 기록)', origin: 'user', cfg: d.cfg, frames,
    events: eventsOf(chain, snapDay, start),
    chainHash: hashOf(chain.map((s) => s.contentHash)),
    snapshotCount: chain.length,
    entryCount: d.entries.filter((e) => e.deleteMode !== 'discarded').length,
    invariants: integrity.problems,
    tags: {},
    trailAvg: {
      temp: trail.length ? trail.reduce((a, x) => a + x.temp, 0) / trail.length : 0,
      energy: trail.length ? trail.reduce((a, x) => a + x.energy, 0) / trail.length : 0,
      days: trail.length,
    },
    rules: [],
    notes: d.lifecycle === 'wrapped'
      ? [`이 어항은 마무리(wrapped)됐어요. 마무리한 날짜는 기록에 저장되지 않아서, 마지막 기록 날짜(${lastDate}) 프레임에만 '마무리'로 표시하고 그 뒤 날짜는 만들지 않아요. 그 전 날짜는 당시 상태(진행 중)로 보여요.`]
      : d.lifecycle === 'completed' && !chain.some((s) => s.kind === 'finale')
        ? ['저장된 상태는 완성인데 완성 스냅샷이 없어요. 마지막 프레임에만 완성으로 표시해요.']
        : [],
  };
}

const KST_OFFSET_MS = 9 * 3_600_000;
const hhmm = (ms: number) => new Date(ms + KST_OFFSET_MS).toISOString().slice(11, 16);

/** 실제 기록을 복사해 시드만 바꾼 가상 어항(derived). 원본 데이터·스냅샷과 완전히 별개. */
export function derivedTanks(d: Readonly<SessionData>, seeds: number[]): SampleTank[] {
  const chain = liveChain(d).filter((s) => s.kind === 'entry' && s.input);
  const createdAt = new Map(d.entries.map((e) => [e.id, e.createdAt]));
  const lastDate = chain.reduce((m, s) => (s.input!.localDate > m ? s.input!.localDate : m), d.cfg.startDate);
  const days = Math.min(MAX_DAYS, daysBetween(d.cfg.startDate, lastDate) + 1);
  return seeds.map((seed, i) => {
    const key = `DV${i + 1}`;
    const entries: ScriptedEntry[] = chain.map((s, j) => ({
      clientId: `derived:${key}:${j + 1}`,
      localDate: s.input!.localDate,
      time: hhmm(createdAt.get(s.entryId ?? '') ?? 0),
      amount: s.input!.amount,
      progressValue: s.input!.progressValue,
      moodChips: [...s.input!.moodChips],
      note: s.input!.note,
    }));
    return {
      key, label: `같은 기록 · 시드 ${i + 1}`, days, finishOnLastPage: d.lifecycle === 'completed', endWrapped: d.lifecycle === 'wrapped',
      cfg: { ...d.cfg, goal: { ...d.cfg.goal }, tankId: `derived:${d.cfg.tankId}:${key}`, seed },
      entries,
    };
  });
}
