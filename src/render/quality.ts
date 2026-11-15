/**
 * 렌더링 품질(모바일 성능 검증용). **화면에 어떻게 그릴지만** 정한다.
 * 생성 엔진·스냅샷·물고기 수·수초 수는 이 값과 상관없다. 그래서 여기에는 "몇 개를 그릴지" 같은 항목을 두지 않는다
 * (기포는 엔진 상태가 아닌 화면 연출이라 예외).
 */
export type RenderQuality = 'normal' | 'low';

export interface QualitySpec {
  /** 렌더링 해상도 상한(기기 DPR과 비교해 작은 값) */
  maxResolution: number;
  /** 감정 조명 색 보정 필터(ColorMatrixFilter). 끄면 반투명 덧칠 한 장으로 대신한다 */
  colorGrade: boolean;
  /** 왼쪽 위 가산 빛 */
  glow: boolean;
  /** 화면 연출 기포 최대 개수(엔진 상태 아님) */
  maxBubbles: number;
  /** 빛줄기·별 반짝임 */
  shimmer: boolean;
}

export const QUALITY: Record<RenderQuality, QualitySpec> = {
  normal: { maxResolution: 2, colorGrade: true, glow: true, maxBubbles: 24, shimmer: true },
  low: { maxResolution: 1, colorGrade: false, glow: false, maxBubbles: 8, shimmer: false },
};

export const QUALITY_LABEL: Record<RenderQuality, string> = { normal: '일반', low: '저사양' };

/** 실제로 쓸 렌더링 해상도 */
export function qualityResolution(q: RenderQuality, dpr: number): number {
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return Math.min(d, QUALITY[q].maxResolution);
}
