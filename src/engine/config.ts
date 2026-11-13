/**
 * 엔진 수치. 전부 [가설]이다(v0.3.1 수정 노트 6장 H1~H11).
 * 0단계 시뮬레이터로 측정한 뒤 바꾸고, 바꾸면 ENGINE_VERSION을 올린다.
 */
export const ENGINE_VERSION = '0.1.0';

/** 논리 좌표. 렌더러가 화면 크기에 맞춰 늘린다. */
export const WORLD = { width: 1000, height: 600, floorY: 500 } as const;

/** H8: 종류별 개수 상한 */
export const CAPS = { fish: 12, plant: 10, rock: 6, symbol: 4 } as const;
export const EFFECT_CAP = 2;

/** H3: 조명 이동 비율 */
export const LIGHT_SHIFT = { first: 0.15, extra: 0.1, dayMax: 0.3 } as const;

/** H4: 성장점 */
export const GROWTH = { threshold: 2, firstEntryPoint: 1, dailyTargetBonus: 1, step: 0.1, maxScale: 1.6 } as const;

/** H7·H9: 요소 점수 */
export const SCORE = { mood: 0.6, history: 0.25, seed: 0.15, sameKindPenalty: 0.7 } as const;

/** H5·H6: 특별 변화 */
export const SPECIAL = {
  percent: [25, 50, 75],
  counts: [10, 20, 30, 50, 75, 100, 150, 200, 365],
  shiftThreshold: 0.6,
  shiftWindow: 5,
} as const;

/** 배치 슬롯과 최소 간격(논리 좌표) */
export const SLOTS = {
  rock: { y: 522, xs: [140, 300, 470, 640, 800, 905], minGap: 90 },
  plantBack: { y: 505, xs: [80, 200, 320, 440, 560, 680, 800, 920], minGap: 60 },
  plantFront: { y: 585, xs: [60, 360, 640, 945], minGap: 60 },
  symbol: { y: 518, xs: [235, 525, 745, 870], minGap: 80 },
  fishLanes: [170, 290, 400],
  jitter: 30,
  retries: 5,
} as const;

/** 이끼 단계 기준(빠진 날 수). 쉬는 날 제외. */
export const MOSS = { stage1: 3, stage2: 7, stage3: 14 } as const;

/** 진행 중 어항 권장 안내 기준 / 기술 상한 */
export const ACTIVE_TANKS = { recommended: 5, hardCap: 50 } as const;

/** 미확정 스냅샷 자동 확정 시간 */
export const CONFIRM_AFTER_MS = 24 * 60 * 60 * 1000;
