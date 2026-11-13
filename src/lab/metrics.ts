import { CAPS } from '../engine/config';
import { CHIP_VECTORS, BASE_CHIPS } from '../engine/mood';
import type { Lifecycle, TankState } from '../engine/types';
import type { FrameMetrics } from './types';

/**
 * 검증용 지표. 엔진 규칙이 아니라 "보는 사람이 비교하기 쉽게" 만든 측정값이다.
 * 성장 단계·차이 거리 같은 정의는 [검증용 정의]이며 엔진 결과에 영향을 주지 않는다.
 */

export const LIFECYCLE_LABEL: Record<Lifecycle, string> = { active: '진행 중', completed: '완성', wrapped: '마무리' };

export const CAP_TOTAL = CAPS.fish + CAPS.plant + CAPS.rock + CAPS.symbol;

/** [검증용 정의] 성장 단계: 상한 대비 채움 비율로 5단계 */
export const STAGES = [
  { stage: 1, name: '빈 어항', upTo: 0 },
  { stage: 2, name: '새싹', upTo: 15 },
  { stage: 3, name: '자라는 중', upTo: 40 },
  { stage: 4, name: '풍성', upTo: 75 },
  { stage: 5, name: '가득', upTo: 100 },
] as const;

export function stageOf(fillPct: number): { stage: number; name: string } {
  if (fillPct <= 0) return { stage: 1, name: '빈 어항' };
  const s = STAGES.find((x) => x.stage > 1 && fillPct < x.upTo) ?? STAGES[4];
  return { stage: s.stage, name: s.name };
}

/** 배경 물색(테마 세미 리얼 배경의 가운데 평균색 #043877)에 렌더러의 감정 조명을 겹친 색. AquariumRenderer.drawLight와 같은 공식. */
const WATER = [0x04, 0x38, 0x77] as const;
const WARM = [0xf5, 0x9e, 0x0b] as const;
const COOL = [0x38, 0xbd, 0xf8] as const;

export function waterColor(light: { temp: number }): string {
  const t = light.temp;
  const a = Math.abs(t) < 0.01 ? 0 : Math.min(0.28, Math.abs(t) * 0.3);
  const over = t > 0 ? WARM : COOL;
  const rgb = WATER.map((w, i) => Math.round(w * (1 - a) + over[i]! * a));
  return '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** 조명 방향이 가장 가까운 기본 마음 칩. 움직임이 작으면 '중립'. */
export function moodNameOf(light: { temp: number; energy: number }): string {
  const mag = Math.hypot(light.temp, light.energy);
  if (mag < 0.1) return '중립';
  let best = '중립';
  let bestCos = -2;
  for (const c of BASE_CHIPS) {
    const v = CHIP_VECTORS[c]!;
    const cos = (v.temp * light.temp + v.energy * light.energy) / (Math.hypot(v.temp, v.energy) * mag);
    if (cos > bestCos) { bestCos = cos; best = c; }
  }
  return `${best} 쪽`;
}

export function frameMetrics(state: TankState): FrameMetrics {
  const count = (k: string) => state.objects.filter((o) => o.kind === k).length;
  const total = state.objects.length;
  const fillPct = Math.round((total / CAP_TOTAL) * 100);
  const st = stageOf(fillPct);
  const scales = state.objects.map((o) => o.scale);
  return {
    fish: count('fish'),
    plant: count('plant'),
    rock: count('rock'),
    symbol: count('symbol'),
    total,
    fillPct,
    distinct: new Set(state.objects.map((o) => o.el)).size,
    avgScale: scales.length ? round2(scales.reduce((a, b) => a + b, 0) / scales.length) : 0,
    maxScale: scales.length ? Math.max(...scales) : 0,
    lightTemp: state.light.temp,
    lightEnergy: state.light.energy,
    waterHex: waterColor(state.light),
    moodName: moodNameOf(state.light),
    stage: st.stage,
    stageName: st.name,
    effects: [...state.effects],
    speed: state.behavior.speed,
    depth: state.behavior.depth,
  };
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}

// ───────────────────────── 어항 사이 차이 ─────────────────────────

/** 물빛(조명) 차이. 0~1로 정규화(조명 벡터 차이 / 2). */
export function lightDistance(a: TankState, b: TankState): number {
  return Math.min(1, Math.hypot(a.light.temp - b.light.temp, a.light.energy - b.light.energy) / 2);
}

/** 구성 차이: 요소 종류별 분포의 총변동거리(0 = 같은 구성, 1 = 전혀 다른 구성). 크기도 무게로 반영. */
export function compositionDistance(a: TankState, b: TankState): number {
  const dist = (s: TankState) => {
    const m = new Map<string, number>();
    let sum = 0;
    for (const o of s.objects) { m.set(o.el, (m.get(o.el) ?? 0) + o.scale); sum += o.scale; }
    return { m, sum };
  };
  const da = dist(a);
  const db = dist(b);
  if (da.sum === 0 && db.sum === 0) return 0;
  if (da.sum === 0 || db.sum === 0) return 1;
  const keys = new Set([...da.m.keys(), ...db.m.keys()]);
  let tv = 0;
  for (const k of keys) tv += Math.abs((da.m.get(k) ?? 0) / da.sum - (db.m.get(k) ?? 0) / db.sum);
  return tv / 2;
}

/** 배치 차이: (요소, 50px 칸) 집합의 자카드 거리. 시드가 만드는 개성을 본다. */
export function layoutDistance(a: TankState, b: TankState): number {
  const cells = (s: TankState) => new Set(s.objects.filter((o) => o.kind !== 'fish').map((o) => `${o.el}@${Math.round(o.x / 50)}`));
  const ca = cells(a);
  const cb = cells(b);
  if (ca.size === 0 && cb.size === 0) return 0;
  let inter = 0;
  for (const c of ca) if (cb.has(c)) inter++;
  return 1 - inter / (ca.size + cb.size - inter);
}

/** [검증용 정의] 분위기·구성 차이 = (물빛 차이 + 구성 차이) / 2. 감정이 만드는 차이를 본다(배치는 제외). */
export function moodCompositionDistance(a: TankState, b: TankState): number {
  return (lightDistance(a, b) + compositionDistance(a, b)) / 2;
}

export function pairwise<T>(items: T[], f: (a: T, b: T) => number): number[] {
  const out: number[] = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) out.push(f(items[i]!, items[j]!));
  return out;
}

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
export const fmt = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '-');
