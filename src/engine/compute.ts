import { CAPS, EFFECT_CAP, ENGINE_VERSION, FISH_SPACE, GROWTH, LIGHT_SHIFT, SCORE, SLOTS, SPECIAL } from './config';
import { EFFECTS, elementOf, themeOf, type ElementDef } from './catalog';
import { analyzeMood, clamp, round } from './mood';
import { rngFor, type Rng } from './random';
import type {
  Change, DayMood, EngineInput, EngineOutput, Layer, Ledger, MoodVec, ObjectKind, PlacedObject, TankConfig, TankState,
} from './types';

/**
 * 순수 함수: (직전 확정 스냅샷의 state·ledger, 기록 한 건, 어항 설정) → 새 state·ledger·변화 목록.
 * 불변 규칙 I2(v0.3.2 보완서 1.2). 현재 시각·Math.random을 쓰지 않는다.
 * 하루 여러 번 기록 규칙은 v0.3.1 수정 노트 3장.
 */

export function genesisState(cfg: TankConfig): { state: TankState; ledger: Ledger } {
  return {
    state: {
      schema: 1,
      themeId: cfg.themeId,
      light: { temp: 0, energy: 0 },
      behavior: { speed: 1, depth: 0 },
      objects: [],
      effects: [],
      completed: false,
    },
    ledger: {
      lastEntryDate: null,
      entryCount: 0,
      growthPoints: 0,
      lastMajorDate: null,
      dayLightShift: { date: null, used: 0 },
      day: { date: null, amount: 0, bonusGiven: false },
      pendingSpecials: [],
      firedMilestones: [],
      moodTrail: [],
      lastShiftAtDay: -999,
      maxProgress: 0,
      lastGrowthKind: null,
      nextObjectNo: 1,
    },
  };
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function computeSnapshot(
  base: { state: TankState; ledger: Ledger },
  input: EngineInput,
  cfg: TankConfig,
): EngineOutput {
  const state = clone(base.state);
  const ledger = clone(base.ledger);
  const changes: Change[] = [];
  const rng = rngFor(cfg.seed, input.seq);
  const mood = analyzeMood(input.moodChips, input.note);
  const date = input.localDate;
  const firstOfDay = ledger.lastEntryDate !== date;

  // ── 1. 하루 단위 값 초기화 ─────────────────────────
  if (ledger.dayLightShift.date !== date) ledger.dayLightShift = { date, used: 0 };
  if (ledger.day.date !== date) ledger.day = { date, amount: 0, bonusGiven: false };
  ledger.entryCount += 1;
  ledger.day.amount += Math.max(0, input.amount);
  if (input.progressValue !== null) ledger.maxProgress = Math.max(ledger.maxProgress, input.progressValue);

  // ── 2. 일상 변화: 조명·물빛(하루 상한), 물고기 행동 ─────────
  applyDaily(state, ledger, mood, firstOfDay, input.note, changes);

  // ── 3. 감정 이력: 같은 날은 하루 1일치 무게로 합친다(H10) ─────
  mergeMoodTrail(ledger, date, mood);

  // ── 4. 성장점: 그날 첫 기록 1점 + 하루 목표 달성 1점(추가 기록에서 채우면 다음 날로 이월) ──
  const majorDoneToday = () => ledger.lastMajorDate === date;
  const target = cfg.goal.type === 'amount' ? cfg.goal.dailyTarget : null;
  if (firstOfDay) ledger.growthPoints += GROWTH.firstEntryPoint;
  if (target !== null && !ledger.day.bonusGiven && ledger.day.amount >= target) {
    ledger.growthPoints += GROWTH.dailyTargetBonus;
    ledger.day.bonusGiven = true;
  }

  // ── 5. 주요 변화(하루 1회): 기다리는 특별 변화가 성장보다 먼저. 성장점은 다음 날로 이월된다 ──
  collectSpecials(ledger, cfg);
  if (!majorDoneToday()) {
    if (ledger.pendingSpecials.length > 0) {
      const key = ledger.pendingSpecials.shift()!;
      applySpecial(key, state, ledger, mood, cfg, rng, input, changes);
      ledger.lastMajorDate = date;
    } else if (firstOfDay && ledger.growthPoints >= GROWTH.threshold) {
      ledger.growthPoints -= GROWTH.threshold;
      applyGrowth(state, ledger, mood, cfg, rng, input, changes);
      ledger.lastMajorDate = date;
    }
  } else if (ledger.pendingSpecials.length > 0) {
    changes.push({ level: 'info', text: '특별한 변화가 기다리고 있어요. 다음 날 첫 기록에서 나타나요.' });
  }

  ledger.lastEntryDate = date;
  return { state, ledger, changes };
}

/** 완성 스냅샷. 하루 1회 제한의 예외. */
export function computeFinale(base: { state: TankState; ledger: Ledger }, cfg: TankConfig, seq: number): EngineOutput {
  const state = clone(base.state);
  const ledger = clone(base.ledger);
  const changes: Change[] = [];
  const rng = rngFor(cfg.seed, seq, 99);
  const theme = themeOf(cfg.themeId);
  const finale = elementOf(cfg.themeId, theme.finaleElement);
  if (finale && countKind(state, 'fish') < CAPS.fish && fishFits(state, cfg.themeId, (finale.bodyHeight ?? 0) * finale.baseScale, false)) {
    const obj = placeNew(state, ledger, finale, rng, seq, state.light.temp);
    if (obj) changes.push({ level: 'finale', text: `${subj(finale.name)} 이 어항의 대표 생물이 되었어요`, objectId: obj.id });
  } else {
    // 대표 생물이 들어갈 수 없으면(물고기 상한·헤엄 공간) 가장 먼저 태어난 물고기가 대표가 된다. 공간이 있을 때만 조금 자란다.
    const oldest = [...state.objects].filter((o) => o.kind === 'fish').sort((a, b) => a.bornSeq - b.bornSeq || a.id.localeCompare(b.id))[0];
    if (oldest) {
      const grow = Math.min(GROWTH.maxScale, oldest.scale + 0.2) - oldest.scale;
      const grew = grow > 0 && fishFits(state, cfg.themeId, (elementOf(cfg.themeId, oldest.el)?.bodyHeight ?? 0) * grow, false);
      if (grew) oldest.scale = round(oldest.scale + grow);
      changes.push({
        level: 'finale',
        text: grew ? '가장 오래 함께한 물고기가 대표 생물이 되어 조금 더 자랐어요' : '가장 오래 함께한 물고기가 대표 생물이 되었어요',
        objectId: oldest.id,
      });
    }
  }
  state.light = { temp: round(clamp(state.light.temp + 0.1)), energy: state.light.energy };
  state.effects = [EFFECTS.starsBright, EFFECTS.lightray];
  state.completed = true;
  changes.push({ level: 'finale', text: '최종 조명이 정해지고 어항이 완성되었어요' });
  return { state, ledger, changes };
}

// ───────────────────────── 일상 변화 ─────────────────────────

function applyDaily(state: TankState, ledger: Ledger, mood: MoodVec, firstOfDay: boolean, note: string, changes: Change[]) {
  if (mood.confidence <= 0) {
    changes.push({ level: 'daily', text: '오늘의 기록이 어항에 잔잔한 물결을 만들었어요' });
    return;
  }
  const want = firstOfDay ? LIGHT_SHIFT.first : LIGHT_SHIFT.extra;
  const allowed = Math.max(0, Math.min(want, LIGHT_SHIFT.dayMax - ledger.dayLightShift.used));
  if (allowed > 0) {
    const before = state.light.temp;
    state.light = {
      temp: round(state.light.temp + (mood.temp - state.light.temp) * allowed),
      energy: round(state.light.energy + (mood.energy - state.light.energy) * allowed),
    };
    ledger.dayLightShift.used = round(ledger.dayLightShift.used + allowed);
    const delta = state.light.temp - before;
    const label = mood.labels[0] ?? '오늘의 마음';
    if (Math.abs(delta) >= 0.005) {
      changes.push({
        level: 'daily',
        text: `${quote(note)}${label}${josa(label, '이', '가')} 물빛을 조금 ${delta > 0 ? '따뜻하게' : '푸르게'} 했어요`,
      });
    }
  } else {
    changes.push({ level: 'daily', text: '오늘은 물빛이 충분히 바뀌어서 더 바뀌지 않아요' });
  }
  state.behavior = {
    speed: round(1 + 0.5 * mood.energy),
    depth: round(clamp(mood.energy * 0.8)),
  };
  changes.push({
    level: 'daily',
    text: mood.energy > 0.3 ? '물고기들이 조금 빠르게 헤엄쳐요' : mood.energy < -0.3 ? '물고기들이 천천히, 아래쪽에서 헤엄쳐요' : '물고기들이 편안하게 헤엄쳐요',
  });
}

function mergeMoodTrail(ledger: Ledger, date: string, mood: MoodVec) {
  if (mood.confidence <= 0) return;
  const last = ledger.moodTrail[ledger.moodTrail.length - 1];
  if (last && last.date === date) {
    const n = last.count + 1;
    last.temp = round((last.temp * last.count + mood.temp) / n);
    last.energy = round((last.energy * last.count + mood.energy) / n);
    last.count = n;
  } else {
    ledger.moodTrail.push({ date, temp: mood.temp, energy: mood.energy, count: 1 });
  }
}

// ───────────────────────── 성장 ─────────────────────────

function affinity(a: { temp: number; energy: number }, b: { temp: number; energy: number }): number {
  const d = Math.hypot(a.temp - b.temp, a.energy - b.energy);
  return 1 - d / (2 * Math.SQRT2);
}

function trailAverage(trail: DayMood[]): { temp: number; energy: number } {
  if (trail.length === 0) return { temp: 0, energy: 0 };
  return {
    temp: trail.reduce((s, d) => s + d.temp, 0) / trail.length,
    energy: trail.reduce((s, d) => s + d.energy, 0) / trail.length,
  };
}

function countKind(state: TankState, kind: ObjectKind): number {
  return state.objects.filter((o) => o.kind === kind).length;
}

/** 이슈 #9: 물고기 몸 높이 합(크기 배율 반영) */
function fishLoad(state: TankState, themeId: string): number {
  let sum = 0;
  for (const o of state.objects) if (o.kind === 'fish') sum += (elementOf(themeId, o.el)?.bodyHeight ?? 0) * o.scale;
  return sum;
}

/**
 * 이 만큼 물고기 몸 높이가 늘어도 헤엄 공간 예산 안인지.
 * 일상 성장(daily)은 완성 때 나올 대표 생물 자리를 남겨 둔다. 그래야 완성 장면에서 대표 생물이 빠지지 않는다.
 */
function fishFits(state: TankState, themeId: string, extra: number, daily: boolean): boolean {
  let budget = FISH_SPACE.bandHeight * FISH_SPACE.maxFill;
  if (daily) {
    const fin = elementOf(themeId, themeOf(themeId).finaleElement);
    if (fin && fin.kind === 'fish') budget -= (fin.bodyHeight ?? 0) * fin.baseScale;
  }
  return fishLoad(state, themeId) + extra <= budget + 1e-9;
}

function countEl(state: TankState, el: string): number {
  return state.objects.filter((o) => o.el === el).length;
}

function applyGrowth(state: TankState, ledger: Ledger, mood: MoodVec, cfg: TankConfig, rng: Rng, input: EngineInput, changes: Change[]) {
  const theme = themeOf(cfg.themeId);
  const history = trailAverage(ledger.moodTrail);
  const target = mood.confidence > 0 ? mood : { temp: state.light.temp, energy: state.light.energy };
  const candidates = theme.elements.filter(
    (e) =>
      !e.specialOnly &&
      !e.finaleOnly &&
      countEl(state, e.id) < e.maxPerTank &&
      countKind(state, e.kind) < CAPS[e.kind] &&
      (e.kind !== 'fish' || fishFits(state, cfg.themeId, (e.bodyHeight ?? 0) * e.baseScale, true)),
  );
  const scored = candidates
    .map((e) => {
      let s = SCORE.mood * affinity(target, e.mood) + SCORE.history * affinity(history, e.mood) + SCORE.seed * rng();
      if (ledger.lastGrowthKind === e.kind) s *= SCORE.sameKindPenalty;
      return { e, s };
    })
    .sort((a, b) => b.s - a.s);

  // 아직 어항이 비어 있으면 새 요소를, 어느 정도 찼으면 절반은 기존 요소를 키운다
  const fill = state.objects.length / (CAPS.fish + CAPS.plant + CAPS.rock);
  const preferGrow = state.objects.length > 0 && rng() < fill;
  const best = scored[0];
  if (best && !preferGrow) {
    const obj = placeNew(state, ledger, best.e, rng, input.seq, target.temp);
    if (obj) {
      ledger.lastGrowthKind = best.e.kind;
      changes.push({ level: 'growth', text: `${quote(input.note)}${reasonLabel(mood)} ${subj(best.e.name)} 생겼어요`, objectId: obj.id });
      return;
    }
  }
  growExisting(state, ledger, target, cfg, input, mood, changes);
}

function growExisting(state: TankState, ledger: Ledger, target: { temp: number; energy: number }, cfg: TankConfig, input: EngineInput, mood: MoodVec, changes: Change[]) {
  const growable = state.objects.filter(
    (o) =>
      o.scale < GROWTH.maxScale &&
      (o.kind !== 'fish' || fishFits(state, cfg.themeId, (elementOf(cfg.themeId, o.el)?.bodyHeight ?? 0) * GROWTH.step, true)),
  );
  if (growable.length === 0) {
    changes.push({ level: 'growth', text: '어항이 가득 차서, 생물들의 색이 조금 깊어졌어요' });
    for (const o of state.objects) o.tint = round(clamp(o.tint + (target.temp - o.tint) * 0.1));
    return;
  }
  const pick = growable
    .map((o) => ({ o, s: affinity(target, elementOf(cfg.themeId, o.el)?.mood ?? { temp: 0, energy: 0 }) - o.scale * 0.1 }))
    .sort((a, b) => b.s - a.s || a.o.id.localeCompare(b.o.id))[0]!.o;
  pick.scale = round(Math.min(GROWTH.maxScale, pick.scale + GROWTH.step));
  pick.tint = round(clamp(pick.tint + (target.temp - pick.tint) * 0.3));
  ledger.lastGrowthKind = pick.kind;
  const name = elementOf(cfg.themeId, pick.el)?.name ?? '생물';
  changes.push({ level: 'growth', text: `${quote(input.note)}${reasonLabel(mood)} ${subj(name)} 조금 자랐어요`, objectId: pick.id });
}

/** 슬롯 배치. 겹치면 5번 다시 시도하고, 실패하면 null(호출 쪽에서 기존 요소 성장으로 대체). */
function placeNew(state: TankState, ledger: Ledger, e: ElementDef, rng: Rng, seq: number, tint: number): PlacedObject | null {
  const layer: Layer = e.layers[Math.floor(rng() * e.layers.length)] ?? e.layers[0]!;
  let x = 0;
  let y = 0;
  if (e.kind === 'fish') {
    const lanes = SLOTS.fishLanes;
    y = lanes[Math.floor(rng() * lanes.length)] ?? lanes[0];
    x = 150 + Math.floor(rng() * 700);
  } else {
    const slot = e.kind === 'rock' ? SLOTS.rock : e.kind === 'symbol' ? SLOTS.symbol : layer === 'front' ? SLOTS.plantFront : SLOTS.plantBack;
    const same = state.objects.filter((o) => o.layer === layer && o.kind !== 'fish');
    let placed = false;
    for (let attempt = 0; attempt < SLOTS.retries && !placed; attempt++) {
      const sx = slot.xs[Math.floor(rng() * slot.xs.length)] ?? slot.xs[0];
      const cx = sx + Math.round((rng() * 2 - 1) * SLOTS.jitter);
      if (same.every((o) => Math.abs(o.x - cx) >= slot.minGap)) {
        x = cx;
        y = slot.y;
        placed = true;
      }
    }
    if (!placed) return null;
  }
  const obj: PlacedObject = {
    id: `o${ledger.nextObjectNo++}`,
    el: e.id,
    kind: e.kind,
    layer,
    x,
    y,
    scale: e.baseScale,
    tint: round(clamp(tint)),
    bornSeq: seq,
  };
  state.objects.push(obj);
  return obj;
}

// ───────────────────────── 특별 변화 ─────────────────────────

function collectSpecials(ledger: Ledger, cfg: TankConfig) {
  const add = (key: string) => {
    if (!ledger.firedMilestones.includes(key)) {
      ledger.firedMilestones.push(key);
      ledger.pendingSpecials.push(key);
    }
  };
  const total = cfg.goal.totalUnits;
  if (total && total > 0) {
    const pct = (ledger.maxProgress / total) * 100;
    for (const p of SPECIAL.percent) if (pct >= p) add(`p${p}`);
  } else {
    for (const c of SPECIAL.counts) if (ledger.entryCount >= c) add(`c${c}`);
  }
  const t = ledger.moodTrail;
  const w = SPECIAL.shiftWindow;
  if (t.length >= w * 2 && t.length - ledger.lastShiftAtDay >= w) {
    const recent = trailAverage(t.slice(-w));
    const prev = trailAverage(t.slice(-2 * w, -w));
    if (Math.abs(recent.temp - prev.temp) >= SPECIAL.shiftThreshold || Math.abs(recent.energy - prev.energy) >= SPECIAL.shiftThreshold) {
      ledger.lastShiftAtDay = t.length;
      ledger.pendingSpecials.push('shift');
    }
  }
}

function pushEffect(state: TankState, fx: string) {
  state.effects = [...state.effects.filter((e) => e !== fx), fx].slice(-EFFECT_CAP);
}

function applySpecial(key: string, state: TankState, ledger: Ledger, mood: MoodVec, cfg: TankConfig, rng: Rng, input: EngineInput, changes: Change[]) {
  const theme = themeOf(cfg.themeId);
  if (key === 'p25') {
    pushEffect(state, EFFECTS.starsBright);
    changes.push({ level: 'special', text: '25%를 지났어요. 별 하나가 밝아졌어요' });
    return;
  }
  if (key === 'shift') {
    pushEffect(state, EFFECTS.lightray);
    changes.push({ level: 'special', text: '최근 마음의 흐름이 바뀌어서 물속에 빛줄기가 들어왔어요' });
    return;
  }
  // p50, p75, 누적 마일스톤: 상징 요소를 놓고, 자리가 없으면 빛 효과
  const symbols = theme.elements.filter((e) => e.kind === 'symbol' && countEl(state, e.id) < e.maxPerTank);
  const target = mood.confidence > 0 ? mood : { temp: state.light.temp, energy: state.light.energy };
  const pick = symbols.sort((a, b) => affinity(target, b.mood) - affinity(target, a.mood))[0];
  const label = key.startsWith('p') ? `${key.slice(1)}%를 지났어요.` : `${key.slice(1)}번째 기록이에요.`;
  if (pick && countKind(state, 'symbol') < CAPS.symbol) {
    const obj = placeNew(state, ledger, pick, rng, input.seq, target.temp);
    if (obj) {
      changes.push({ level: 'special', text: `${label} ${quote(input.note)}${subj(pick.name)} 놓였어요`, objectId: obj.id });
      return;
    }
  }
  pushEffect(state, key === 'p75' ? EFFECTS.starsBright : EFFECTS.lightray);
  changes.push({ level: 'special', text: `${label} 어항에 빛이 한 겹 더해졌어요` });
}

// ───────────────────────── 문구 ─────────────────────────

/** 받침이 있으면 withB, 없으면 withoutB. 한글이 아니면 withoutB. */
export function josa(word: string, withB: string, withoutB: string): string {
  const ch = word.trim().slice(-1);
  const code = ch.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return withoutB;
  return code % 28 > 0 ? withB : withoutB;
}

function quote(note: string): string {
  const t = note.trim();
  if (!t) return '';
  const short = t.length > 14 ? t.slice(0, 14) + '…' : t;
  return `"${short}"${josa(short, '이라는', '라는')} 말과 `;
}

function subj(name: string): string {
  return name + josa(name, '이', '가');
}

function reasonLabel(mood: MoodVec): string {
  if (mood.confidence <= 0) return '꾸준히 이어온 기록으로';
  return `${mood.labels[0] ?? '오늘의 마음'}에서`;
}

export { ENGINE_VERSION };
