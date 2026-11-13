/**
 * 감정 조명(물빛) 색 보정. 엔진의 state.light(temp, energy)를 화면 색으로 바꾸는 규칙이다.
 *
 * 이전 방식: 수조 전체에 호박색/하늘색 사각형을 반투명으로 덧칠 → 남색 물 위에 주황이 덮여 탁한 회갈색이 됨.
 * 지금 방식: 덧칠하지 않고 색 보정 행렬로 색온도·채도·밝기만 옮긴다(물은 파란 채로 따뜻하거나 차가워짐)
 *           + 왼쪽 위에서 들어오는 은은한 빛(가산 혼합)으로 따뜻함/차가움을 "빛"으로 표현한다.
 *
 * 렌더러(ColorMatrixFilter)와 검증실 물빛 색감 지표가 같은 함수를 쓴다. 엔진·스냅샷과 무관하다.
 */

export interface Light { temp: number; energy: number }

export interface LightGrade {
  /** PixiJS ColorMatrixFilter용 4×5 행렬(20개). 입력·출력 0~1 */
  matrix: number[];
  /** 왼쪽 위에서 퍼지는 가산 빛 */
  glow: { color: number; alpha: number };
  gains: [number, number, number];
  saturation: number;
  brightness: number;
}

const LUMA = [0.2126, 0.7152, 0.0722] as const;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function lightGrade(light: Light): LightGrade {
  const t = clamp(light.temp, -1, 1);
  const e = clamp(light.energy, -1, 1);
  const w = Math.max(0, t);
  const c = Math.max(0, -t);
  const gains: [number, number, number] = [1 + 0.24 * w - 0.12 * c, 1 + 0.08 * w + 0.02 * c, 1 - 0.18 * w + 0.12 * c];
  const saturation = clamp(1 + 0.12 * e + 0.08 * w - 0.28 * c, 0.7, 1.25);
  const brightness = clamp(1 + 0.06 * e + 0.06 * w - 0.1 * c, 0.85, 1.15);
  const m: number[] = [];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const sat = (1 - saturation) * LUMA[j]! + (i === j ? saturation : 0);
      m.push(brightness * gains[i]! * sat);
    }
    m.push(0, 0); // 알파 열, 오프셋
  }
  m.push(0, 0, 0, 1, 0);
  const glow = w > 0
    ? { color: 0xffb35c, alpha: 0.38 * w }
    : c > 0
      ? { color: 0xa8e2ff, alpha: 0.1 * c }
      : { color: 0xffffff, alpha: 0 };
  return { matrix: m, glow, gains, saturation, brightness };
}

/** 행렬을 RGB(0~255)에 적용 */
export function applyGrade(rgb: readonly [number, number, number], g: LightGrade): [number, number, number] {
  const x = rgb.map((v) => v / 255);
  const out: number[] = [];
  for (let i = 0; i < 3; i++) {
    const r = g.matrix.slice(i * 5, i * 5 + 3);
    out.push(clamp(r[0]! * x[0]! + r[1]! * x[1]! + r[2]! * x[2]!, 0, 1) * 255);
  }
  return out.map(Math.round) as [number, number, number];
}

/** 화면 평균 물빛(검증용): 보정한 물색 + 가산 빛의 평균 기여(빛은 왼쪽 위에서 퍼지므로 화면 평균으로 약 35%) */
export function gradedWater(water: readonly [number, number, number], light: Light): [number, number, number] {
  const g = lightGrade(light);
  const base = applyGrade(water, g);
  const gc = [(g.glow.color >> 16) & 255, (g.glow.color >> 8) & 255, g.glow.color & 255];
  return base.map((v, i) => Math.round(clamp(v + gc[i]! * g.glow.alpha * 0.35, 0, 255))) as [number, number, number];
}

/** 이전 방식(덧칠)의 물색 — 비교용 */
export function legacyWater(water: readonly [number, number, number], light: Light): [number, number, number] {
  const t = light.temp;
  const a = Math.abs(t) < 0.01 ? 0 : Math.min(0.28, Math.abs(t) * 0.3);
  const over = t > 0 ? [0xf5, 0x9e, 0x0b] : [0x38, 0xbd, 0xf8];
  return water.map((w, i) => Math.round(w * (1 - a) + over[i]! * a)) as [number, number, number];
}

/** HSL 채도(0~1). 탁해졌는지 보는 데 쓴다 */
export function chroma(rgb: readonly [number, number, number]): number {
  const [r, g, b] = rgb.map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return 0;
  return (max - min) / (1 - Math.abs(2 * l - 1));
}

export const hex = (rgb: readonly number[]) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
