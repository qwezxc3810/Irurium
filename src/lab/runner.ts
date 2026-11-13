import { addDays } from '../engine/dates';
import { hashOf } from '../engine/random';
import { TankSession, type NewEntry } from '../engine/session';
import { analyzeMood } from '../engine/mood';
import type { Snapshot, TankState } from '../engine/types';
import { frameMetrics } from './metrics';
import { allScenarios } from './samples';
import { SAMPLE_PREFIX, type DataOrigin, type DayFrame, type LabEvent, type RuleCheck, type RunResult, type SampleScenario, type SampleTank, type ScriptedEntry } from './types';

/**
 * 샘플 기록을 실제 앱과 같은 TankSession에 넣어 날짜별 어항을 만든다.
 * 엔진을 따로 흉내 내지 않고 그대로 쓰므로, 확정 순서·24시간 확정·완독 확인 규칙까지 앱과 같다.
 * 매번 새 세션을 만들기 때문에 다른 어항(실제 기록 포함)의 스냅샷에 손대지 않는다.
 */

const KST = '+09:00';
export const msAt = (date: string, time: string) => Date.parse(`${date}T${time}:00${KST}`);
const DAY_MS = 24 * 3_600_000;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** 샘플은 sample: 접두사가 있어야만 돌린다. 실제 어항 id가 섞여 들어오는 실수를 막는다. */
export function assertSampleTank(t: SampleTank) {
  if (!t.cfg.tankId.startsWith(SAMPLE_PREFIX)) throw new Error(`샘플이 아닌 어항은 검증 실행기에 넣을 수 없어요: ${t.cfg.tankId}`);
  for (const e of t.entries) {
    if (!e.clientId.startsWith(SAMPLE_PREFIX)) throw new Error(`샘플이 아닌 기록이 섞였어요: ${e.clientId}`);
  }
}

function toNewEntry(e: ScriptedEntry): NewEntry {
  return { clientId: e.clientId, localDate: e.localDate, amount: e.amount, progressValue: e.progressValue, moodChips: [...e.moodChips], note: e.note };
}

export function runTank(t: SampleTank, origin: DataOrigin = 'sample'): RunResult {
  if (origin === 'sample') assertSampleTank(t);
  const s = new TankSession(t.cfg, t.restWeekdays ?? 0);
  const byDate = new Map<string, ScriptedEntry[]>();
  for (const e of t.entries) byDate.set(e.localDate, [...(byDate.get(e.localDate) ?? []), e]);

  const frames: DayFrame[] = [];
  const snapDay = new Map<string, number>();
  snapDay.set('s0', 0);
  let lastMs = msAt(t.cfg.startDate, '00:00');

  for (let day = 1; day <= t.days; day++) {
    const date = addDays(t.cfg.startDate, day - 1);
    const before = s.snapshots.length;
    let count = 0;
    for (const e of byDate.get(date) ?? []) {
      if (s.lifecycle !== 'active') break;
      const now = msAt(date, e.time);
      const r = s.addEntry(toNewEntry(e), now);
      count++;
      lastMs = now;
      if (r.needsCompletionPrompt && t.finishOnLastPage) s.answerCompletion('finished', now + 60_000);
    }
    s.confirmIfDue(msAt(date, '23:59'));
    const fresh = s.snapshots.slice(before);
    for (const sn of fresh) snapDay.set(sn.id, day);
    const head = s.head;
    frames.push({
      day,
      date,
      state: clone(head.state),
      moss: s.moss(date).stage,
      entries: count,
      changes: fresh.flatMap((x) => x.changes),
      lifecycle: s.lifecycle,
      progress: s.displayProgress(),
      lightUsed: head.ledger.dayLightShift.date === date ? head.ledger.dayLightShift.used : 0,
      metrics: frameMetrics(head.state),
    });
  }
  // 마지막 미확정 기록도 24시간 규칙으로 확정
  s.confirmIfDue(lastMs + DAY_MS + 60_000);

  const events = eventsOf(s.snapshots, snapDay, t.cfg.startDate);
  const trail = s.head.ledger.moodTrail;
  const invariants = s.checkInvariants({ deep: true });
  return {
    key: t.key,
    label: t.label,
    origin,
    cfg: t.cfg,
    frames,
    events,
    chainHash: hashOf(s.snapshots.map((x) => x.contentHash)),
    snapshotCount: s.snapshots.length,
    entryCount: s.entries.length,
    invariants,
    tags: t.tags ?? {},
    trailAvg: {
      temp: trail.length ? trail.reduce((a, d) => a + d.temp, 0) / trail.length : 0,
      energy: trail.length ? trail.reduce((a, d) => a + d.energy, 0) / trail.length : 0,
      days: trail.length,
    },
    rules: ruleChecks(s, frames, events, invariants),
  };
}

/** v0.3.1 수정 노트 3장 규칙을 실제 스냅샷에서 확인한다. */
function ruleChecks(s: TankSession, frames: DayFrame[], events: LabEvent[], inv: string[]): RuleCheck[] {
  const out: RuleCheck[] = [];
  const perDay = (pred: (e: LabEvent) => boolean) => {
    const m = new Map<number, number>();
    for (const e of events) if (pred(e)) m.set(e.day, (m.get(e.day) ?? 0) + 1);
    return Math.max(0, ...m.values());
  };
  const newMax = perDay((e) => e.isNew === true && e.level !== 'finale');
  out.push({ id: 'R1', name: '새 오브젝트 하루 1개 이하(완성 제외)', ok: newMax <= 1, detail: `하루 최대 ${newMax}개` });
  const majorMax = perDay((e) => e.level === 'growth' || e.level === 'special');
  out.push({ id: 'R2', name: '주요 변화(성장·특별) 하루 1회 이하', ok: majorMax <= 1, detail: `하루 최대 ${majorMax}회` });
  const usedMax = Math.max(0, ...frames.map((f) => f.lightUsed));
  out.push({ id: 'R3', name: '조명 이동 하루 30% 이내', ok: usedMax <= 0.3 + 1e-9, detail: `하루 최대 ${Math.round(usedMax * 100)}%` });

  const entrySnaps = s.snapshots.filter((x) => x.kind === 'entry');
  const problems: string[] = [];
  entrySnaps.forEach((sn, i) => {
    const expectBase = i === 0 ? 's0' : entrySnaps[i - 1]!.id;
    if (sn.baseId !== expectBase) problems.push(`${sn.id} 기준 ${sn.baseId}(기대 ${expectBase})`);
    if (sn.status !== 'confirmed') problems.push(`${sn.id} 미확정`);
    const next = s.entries[i + 1];
    if (next && (sn.confirmedAt === null || sn.confirmedAt > next.createdAt)) problems.push(`${sn.id}가 다음 기록보다 늦게 확정`);
  });
  const reasons = new Map<string, number>();
  for (const sn of entrySnaps) reasons.set(sn.confirmReason ?? '-', (reasons.get(sn.confirmReason ?? '-') ?? 0) + 1);
  out.push({
    id: 'R4', name: '스냅샷 확정 순서(직전 확정본 위에 계산, 다음 기록 전에 확정)', ok: problems.length === 0,
    detail: problems.length ? problems.slice(0, 3).join(' / ') : `스냅샷 ${entrySnaps.length}개 · 확정 이유 ${[...reasons].map(([k, v]) => `${k} ${v}`).join(', ')}`,
  });

  // 같은 날 여러 번: 마지막 기록이 조명을 자기 감정 쪽으로 움직였는지(하루 상한에 닿았으면 그대로여도 통과)
  const byDate = new Map<string, Snapshot[]>();
  for (const sn of entrySnaps) if (sn.input) byDate.set(sn.input.localDate, [...(byDate.get(sn.input.localDate) ?? []), sn]);
  let multi = 0;
  const bad: string[] = [];
  for (const [date, list] of byDate) {
    if (list.length < 2) continue;
    multi++;
    const last = list[list.length - 1]!;
    const prev = list[list.length - 2]!;
    const mood = analyzeMood(last.input!.moodChips, last.input!.note);
    if (mood.confidence <= 0) continue;
    const d = (st: TankState) => Math.hypot(st.light.temp - mood.temp, st.light.energy - mood.energy);
    const capped = last.ledger.dayLightShift.used >= 0.3 - 1e-9 && prev.ledger.dayLightShift.used >= 0.3 - 1e-9;
    if (!(d(last.state) < d(prev.state) - 1e-9 || capped)) bad.push(date);
  }
  if (multi > 0) {
    out.push({ id: 'R5', name: '여러 번 기록한 날, 마지막 기록이 그 감정 쪽으로 분위기를 옮김', ok: bad.length === 0, detail: bad.length ? `어긋난 날: ${bad.join(', ')}` : `${multi}일 모두 마지막 감정 쪽으로 이동` });
  }
  out.push({ id: 'R6', name: '불변 규칙 I1~I4(전체 재계산 포함)', ok: inv.length === 0, detail: inv.length ? inv.slice(0, 2).join(' / ') : '위반 없음' });
  return out;
}

/** 스냅샷의 변화 목록에서 성장·특별 변화·완성 사건을 뽑는다. */
export function eventsOf(snaps: readonly Snapshot[], snapDay: Map<string, number>, startDate: string): LabEvent[] {
  const out: LabEvent[] = [];
  for (const sn of snaps) {
    const day = snapDay.get(sn.id) ?? 0;
    for (const c of sn.changes) {
      if (c.level !== 'growth' && c.level !== 'special' && c.level !== 'finale') continue;
      const obj = c.objectId ? sn.state.objects.find((o) => o.id === c.objectId) : undefined;
      out.push({
        day,
        date: addDays(startDate, Math.max(0, day - 1)),
        level: c.level,
        text: c.text,
        kind: obj?.kind ?? null,
        isNew: obj ? obj.bornSeq === sn.seq : null,
        el: obj?.el ?? null,
      });
    }
  }
  return out;
}

export function runScenario(sc: SampleScenario): RunResult[] {
  return sc.tanks.map((t) => runTank(t, 'sample'));
}

export interface SuiteResult {
  scenarios: SampleScenario[];
  runs: Record<string, RunResult[]>;
  ms: number;
}

/** 모든 샘플 시나리오를 처음부터 돌린다. */
export function runSuite(scenarios: SampleScenario[] = allScenarios()): SuiteResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const runs: Record<string, RunResult[]> = {};
  for (const sc of scenarios) runs[sc.id] = runScenario(sc);
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return { scenarios, runs, ms: Math.round(t1 - t0) };
}

export function finalState(r: RunResult): TankState {
  return r.frames[r.frames.length - 1]!.state;
}

export function frameAt(r: RunResult, day: number): DayFrame {
  return r.frames[Math.min(r.frames.length, Math.max(1, day)) - 1]!;
}

/** 재현성: 같은 시나리오를 두 번 처음부터 돌려 모든 스냅샷 해시가 같은지 */
export function checkDeterminism(): Array<{ id: string; key: string; a: string; b: string; same: boolean }> {
  const first = runSuite();
  const second = runSuite();
  const out: Array<{ id: string; key: string; a: string; b: string; same: boolean }> = [];
  for (const sc of first.scenarios) {
    const ra = first.runs[sc.id]!;
    const rb = second.runs[sc.id]!;
    ra.forEach((r, i) => out.push({ id: sc.id, key: r.key, a: r.chainHash, b: rb[i]!.chainHash, same: r.chainHash === rb[i]!.chainHash }));
  }
  return out;
}
