/**
 * 감정별 어항 분위기(렌더링 전용, 엔진 계산과 무관).
 * 엔진 상태의 조명값(temp·energy)과 최근 감정 이력의 흔들림(spread)을 연속적으로 받아
 * 물색 덧칠(생물 뒤)·보조 빛·빛 입자를 정한다. 고정 테마 세 개로 나누지 않는다.
 *
 * - 따뜻함(temp > 0): 노을빛 살구·금색 물, 위로 천천히 떠오르는 따뜻한 빛 알갱이
 * - 차가움(temp < 0): 새벽빛 청색·남색 물, 천천히 내려오는 백청색 입자
 * - 감정 변화 큼(spread): 위쪽은 따뜻한 빛, 아래쪽은 차가운 빛이 부드럽게 섞임(반반 나누지 않음)
 *
 * 물색 덧칠은 배경 바로 위·생물 뒤에 깔아 생물 색을 덮지 않는다.
 * 뿌옇게 바래지 않도록 위층은 가산(빛을 더함: 노을빛·새벽빛이 밝아지는 느낌), 아래층은 곱하기(색을 걸러 깊이를 줌)로 섞는다.
 * 알파 상한과 곱하기 색의 밝기 하한을 두어 어둡거나 탁해지지 않게 한다.
 */

export type RenderStyle = 'v0' | 'atmos-1' | 'atmos-2';
/** 지금 기본 렌더링. V1 평가 세션에 기록해 렌더링 버전끼리 결과가 섞이지 않게 한다 */
export const RENDER_STYLE: RenderStyle = 'atmos-2';
/** 바로 이전 실험(비교 화면 왼쪽) */
export const PREVIOUS_STYLE: RenderStyle = 'atmos-1';
/** 평가·결과 화면에서 고를 수 있는 순서(새 것부터) */
export const RENDER_STYLES: RenderStyle[] = ['atmos-2', 'atmos-1', 'v0'];
export const LEGACY_STYLE: RenderStyle = 'v0';
export const STYLE_LABEL: Record<RenderStyle, string> = { v0: '기존 렌더링(v0)', 'atmos-1': '분위기 렌더링(atmos-1)', 'atmos-2': '감정 배경(atmos-2)' };
/** 배경 그림 자체의 색감을 감정에 따라 바꾸는 렌더링인지 */
export const hasBackgroundGrade = (s: RenderStyle) => s === 'atmos-2';

export interface MoodInput {
  /** 엔진 조명 온도 -1(차가움) ~ +1(따뜻함) */
  temp: number;
  /** 엔진 조명 에너지 -1 ~ +1 */
  energy: number;
  /** 최근 감정 이력 온도의 표준편차(0 이상). 클수록 감정 변화가 큼 */
  spread: number;
}

export interface Tone {
  color: number;
  alpha: number;
}

export interface Atmosphere {
  warm: number;
  cool: number;
  contrast: number;
  /** 생물 뒤 물색: 위에서 아래로 옅어지는 가산 빛(add) / 아래에서 위로 옅어지는 색 거름(multiply) */
  waterTop: Tone;
  waterBottom: Tone;
  /** 생물 뒤 보조 빛: 왼쪽 위 따뜻한 빛 / 오른쪽 아래 차가운 빛(가산) */
  glowWarm: Tone;
  glowCool: Tone;
  particles: {
    /** 최대 입자 수 대비 비율 0~1 */
    density: number;
    /** 따뜻한 입자 비율(나머지는 차가운 입자) */
    warmShare: number;
    warmColor: number;
    coolColor: number;
    /** 움직임 빠르기 배율(에너지에 따라) */
    speed: number;
  };
}

/** 위층 가산 빛 알파 상한(과하게 밝아지지 않게) */
export const MAX_WATER_ALPHA = 0.3;
/** 아래층 곱하기 알파 상한과 곱하기 색 밝기 하한(어두워지지 않게) */
export const MAX_FILTER_ALPHA = 0.55;
export const MIN_FILTER_LUMA = 150;
export const MAX_GLOW_ALPHA = 0.34;

// 위층(가산): 더해지는 빛의 색
const NEUTRAL_TOP = 0x5f8fb0; // 은은한 물빛
const APRICOT = 0xff9a4a; // 노을 살구·금빛
const DAWN = 0x4f8fff; // 새벽 청색
// 아래층(곱하기): 걸러 내는 색(밝을수록 덜 걸러짐)
const NEUTRAL_BOTTOM = 0xffffff;
const GOLD = 0xffc98a; // 파랑을 걸러 따뜻하게
const INDIGO = 0x9cb4ff; // 빨강·초록을 걸러 깊은 청색
const WARM_MOTE = 0xffd59a;
const COOL_MOTE = 0xdcecff;

/** 이 온도(절댓값)에서 따뜻함·차가움이 꽉 찬다 */
export const TEMP_FULL = 0.35;
/** 감정 이력 흔들림(표준편차)이 이 값부터 대비가 생기고, SPREAD_FULL에서 꽉 찬다 */
export const SPREAD_START = 0.36;
export const SPREAD_FULL = 0.55;

const clamp01 = (x: number) => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0));
const smooth = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };

function mix(colors: Array<[number, number]>): number {
  let r = 0, g = 0, b = 0, w = 0;
  for (const [c, k] of colors) {
    if (k <= 0) continue;
    r += ((c >> 16) & 255) * k; g += ((c >> 8) & 255) * k; b += (c & 255) * k; w += k;
  }
  if (w === 0) return colors[0]![0];
  return (Math.round(r / w) << 16) | (Math.round(g / w) << 8) | Math.round(b / w);
}

/** 'YYYY-MM-DD' → 달력 일수(UTC 기준 정수). 형식이 틀리거나 없는 날짜(2026-02-31 등)면 NaN */
function dayNumber(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return NaN;
  const [y, mo, d] = [+m[1]!, +m[2]!, +m[3]!];
  const t = new Date(Date.UTC(y, mo - 1, d));
  // Date.UTC는 없는 날짜를 다음 달로 넘기므로, 되돌려 읽은 연·월·일이 같은지 확인한다
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return NaN;
  return t.getTime() / 86_400_000;
}

/**
 * 최근 감정 흔들림: 기준 날짜 asOf를 포함한 최근 days개 **달력 날짜**(asOf-days+1 ~ asOf) 안의 감정 온도 표준편차.
 * - 기록 개수가 아니라 날짜로 자른다. 오래 쉬었다 돌아온 사용자의 옛 감정이 최근 분위기로 섞이지 않는다.
 * - 기록이 없는 날은 중립(0)으로 채우지 않고 **미관측**으로 빼고 계산한다.
 * - 같은 날 여러 번 기록은 엔진(mergeMoodTrail)이 이미 하루 1개로 합쳐 둔다.
 * - asOf보다 뒤 날짜 기록은 쓰지 않는다. 창 안 기록이 2개 미만이면 0(흔들림 없음).
 */
export function moodSpreadOf(trail: ReadonlyArray<{ date: string; temp: number }>, asOf: string, days = 14): number {
  const end = dayNumber(asOf);
  if (!Number.isFinite(end)) return 0;
  const start = end - days + 1;
  const xs = trail
    .filter((d) => { const n = dayNumber(d.date); return n >= start && n <= end; })
    .map((d) => d.temp)
    .filter((x) => Number.isFinite(x));
  if (xs.length < 2) return 0;
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}

export function atmosphere(m: MoodInput): Atmosphere {
  // 엔진의 감정 온도는 차가운 쪽이 좁다(차분·쓸쓸 기록 약 -0.2, 따뜻한 기록 약 +0.7). 0.35에서 꽉 차게 맞춘다
  const warm = smooth(m.temp / TEMP_FULL);
  const cool = smooth(-m.temp / TEMP_FULL);
  // 같은 계열 감정끼리 오가는 흔들림(차분·쓸쓸·그리움, 표준편차 약 0.3)은 '변화 큼'으로 보지 않는다.
  // 밝음 ↔ 어두움처럼 크게 오갈 때(약 0.55 이상) 대비가 꽉 찬다. [샘플 기록으로 맞춘 값, 실측 뒤 다듬기]
  const contrast = smooth((m.spread - SPREAD_START) / (SPREAD_FULL - SPREAD_START));
  const lift = clamp01((m.energy + 1) / 2); // 0~1

  // 위층: 따뜻함과 변화 폭이 금빛을 끌어올리고, 차가움은 새벽빛
  const tw = warm + 0.75 * contrast;
  const tc = cool * (1 - 0.6 * contrast);
  const topStrength = Math.min(1, Math.max(tw, tc));
  // 아래층: 차가움과 변화 폭이 남색을, 따뜻함은 금빛
  const bw = warm * (1 - 0.6 * contrast);
  const bc = cool + 0.75 * contrast;
  const bottomStrength = Math.min(1, Math.max(bw, bc));

  const waterTop: Tone = {
    color: mix([[NEUTRAL_TOP, 0.35], [APRICOT, tw], [DAWN, tc]]),
    alpha: Math.min(MAX_WATER_ALPHA, 0.04 + 0.18 * topStrength),
  };
  const waterBottom: Tone = {
    color: mix([[NEUTRAL_BOTTOM, 0.35], [GOLD, bw], [INDIGO, bc]]),
    alpha: Math.min(MAX_FILTER_ALPHA, 0.08 + 0.47 * bottomStrength),
  };
  // 기존 조명(왼쪽 위 가산 빛)과 겹쳐 뿌예지지 않게 따뜻한 보조 빛은 약하게
  const glowWarm: Tone = { color: 0xffb860, alpha: Math.min(MAX_GLOW_ALPHA, (0.03 + 0.04 * lift) + 0.12 * Math.max(warm, 0.8 * contrast)) };
  const glowCool: Tone = { color: 0x9fd0ff, alpha: Math.min(MAX_GLOW_ALPHA, 0.04 + 0.24 * Math.max(cool, 0.8 * contrast)) };

  const wp = warm + 0.6 * contrast;
  const cp = cool + 0.6 * contrast;
  return {
    warm, cool, contrast, waterTop, waterBottom, glowWarm, glowCool,
    particles: {
      density: clamp01(0.25 + 0.75 * Math.max(warm, cool, contrast)),
      warmShare: wp + cp > 0 ? wp / (wp + cp) : 0.5,
      warmColor: WARM_MOTE,
      coolColor: COOL_MOTE,
      speed: 0.7 + 0.6 * lift,
    },
  };
}

/** 자동 비교용: 물 가운데쯤 보이는 색(대략값). 위층은 더하고(add), 아래층은 곱한다(multiply). 그라데이션 가운데라 0.5배 */
export function compositeWater(water: number, a: Atmosphere): [number, number, number] {
  const ch = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  const base = ch(water);
  const top = ch(a.waterTop.color);
  const bot = ch(a.waterBottom.color);
  const ka = a.waterTop.alpha * 0.5;
  const kb = a.waterBottom.alpha * 0.5;
  return base.map((v, i) => {
    const added = Math.min(255, v + top[i]! * ka);
    return added * (1 - kb + kb * (bot[i]! / 255));
  }) as [number, number, number];
}

// ───────── 감정 배경 색감(atmos-2): 같은 배경 그림을 감정별 두 색(듀오톤)으로 다시 칠한다 ─────────
//
// 배경의 밝기(L)를 어두운 색 lo → 밝은 색 hi 사이로 옮긴다(L이 BG_REF 이상이면 hi를 넘어 더 밝아짐: 빛줄기는 밝게 남음).
// 물고기·수초·수석·바닥 모래는 칠하지 않는다(배경 그림 한 장만). 엔진과 무관하다.
// - 따뜻함: 노을 라군(호박·살구빛 물, 금빛 빛줄기)
// - 차가움: 달빛 새벽(채도를 뺀 강철 청색, 은빛 빛줄기) — 원래의 선명한 파랑과 구별되게
// - 변화 큼: 해 질 녘(어두운 곳은 푸르고 밝은 곳은 복숭앗빛) — 따뜻함과 차가움이 한 화면에 같이
export interface Duotone { lo: number; hi: number }
export const BG_REF = 0.4;
export const BG_MAPS: Record<'warm' | 'cool' | 'swing', Duotone> = {
  warm: { lo: 0x3a1c2c, hi: 0xf2b070 }, // 기존 조명의 따뜻한 보정이 위에 더해지므로 살짝 덜 진하게
  cool: { lo: 0x0a1434, hi: 0x96b6e8 },
  swing: { lo: 0x162860, hi: 0xffaa96 },
};

export interface BackgroundGrade {
  /** PixiJS ColorMatrixFilter용 4×5 행렬(입력·출력 0~1, 오프셋도 0~1) */
  matrix: number[];
  /** 원래 배경에서 얼마나 옮겼나(0 = 원래 그대로, 1 = 감정 색감 그대로) */
  strength: number;
  weights: { warm: number; cool: number; swing: number };
}

const LUMA_W = [0.2126, 0.7152, 0.0722] as const;
const IDENTITY = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];

function duotoneMatrix(d: Duotone): number[] {
  const ch = (c: number) => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
  const lo = ch(d.lo);
  const hi = ch(d.hi);
  const m: number[] = [];
  for (let i = 0; i < 3; i++) {
    const k = (hi[i]! - lo[i]!) / BG_REF;
    m.push(k * LUMA_W[0], k * LUMA_W[1], k * LUMA_W[2], 0, lo[i]!);
  }
  m.push(0, 0, 0, 1, 0);
  return m;
}

/** 감정 → 배경 색감 행렬. atmosphere()와 같은 연속 가중치(따뜻함·차가움·대비)를 쓴다 */
export function backgroundGrade(m: MoodInput): BackgroundGrade {
  const a = atmosphere(m);
  const weights = { warm: a.warm * (1 - a.contrast), cool: a.cool * (1 - a.contrast), swing: a.contrast };
  const sum = weights.warm + weights.cool + weights.swing;
  const strength = Math.min(1, sum);
  if (sum <= 1e-6) return { matrix: [...IDENTITY], strength: 0, weights };
  const maps = (['warm', 'cool', 'swing'] as const).map((k) => [duotoneMatrix(BG_MAPS[k]), weights[k] / sum] as const);
  const matrix = IDENTITY.map((id, i) => (1 - strength) * id + strength * maps.reduce((acc, [mx, w]) => acc + mx[i]! * w, 0));
  return { matrix, strength, weights };
}

/** 행렬을 RGB(0~255)에 적용(오프셋 포함) */
export function applyBackgroundGrade(rgb: readonly [number, number, number], g: Pick<BackgroundGrade, 'matrix'>): [number, number, number] {
  const x = rgb.map((v) => v / 255);
  const out: number[] = [];
  for (let i = 0; i < 3; i++) {
    const r = g.matrix.slice(i * 5, i * 5 + 5);
    out.push(Math.round(Math.max(0, Math.min(1, r[0]! * x[0]! + r[1]! * x[1]! + r[2]! * x[2]! + r[4]!)) * 255));
  }
  return out as [number, number, number];
}
