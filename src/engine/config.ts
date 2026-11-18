/**
 * 엔진 수치. 전부 [가설]이다(v0.3.1 수정 노트 6장 H1~H11).
 * 0단계 시뮬레이터로 측정한 뒤 바꾸고, 바꾸면 ENGINE_VERSION을 올린다.
 */
export const ENGINE_VERSION = '0.3.0';

/**
 * 계산할 수 있는 엔진 버전. 어항은 만들 때의 엔진 버전(0번 스냅샷)으로 끝까지 계산한다(2026-11-18 결정).
 * 0.2.0 동작은 골든과 검증실 샘플 전체 해시(engine/__tests__/frozen-0.2.0.json)로 고정한다.
 */
export const SUPPORTED_ENGINES = ['0.2.0', '0.3.0'] as const;
export type EngineVersion = (typeof SUPPORTED_ENGINES)[number];
/** 지원하지 않는 옛 버전(0.1.0 등) 어항에 새 기록이 오면 이 버전으로 이어서 계산한다(0.2.0 도입 때와 같은 동작) */
export const FALLBACK_ENGINE: EngineVersion = '0.2.0';
export function engineFor(v: string | undefined): EngineVersion {
  return (SUPPORTED_ENGINES as readonly string[]).includes(v ?? '') ? (v as EngineVersion) : FALLBACK_ENGINE;
}
export const hasEmotionTraces = (v: EngineVersion) => v !== '0.2.0';

/** 논리 좌표. 렌더러가 화면 크기에 맞춰 늘린다. */
export const WORLD = { width: 1000, height: 600, floorY: 500 } as const;

/** H8: 종류별 개수 상한 */
export const CAPS = { fish: 12, plant: 10, rock: 6, symbol: 4, emotion: 40 } as const;

/**
 * 0.3.0 감정 흔적(docs/EMOTION_DICTIONARY.md 결정 1·2). 전부 시작값이다.
 * - 읽은 pagesPerTrace쪽마다 흔적 1개, 하루 최대 dailyMax개(넘친 몫은 쌓아 둠)
 * - 같은 감정은 다른 자리에 최대 perEmotionMax개, 그다음부터는 자람(단계 maxStage까지, 같은 흔적은 growCooldownDays일에 한 번)
 * - 완성 목표 = max(targetMin, 총 쪽수 ÷ targetDivisor). 완독 때 모자라면 기록한 감정 비율대로 채움
 */
export const TRACE = {
  pagesPerTrace: 15,
  dailyMax: 3,
  perEmotionMax: 4,
  /** 완독 채움에서는 한 감정만 많이 기록한 책도 쪽수만큼 채우도록 감정당 최대 개수를 늘린다(공간 한도 안에서) */
  finalePerEmotionMax: 8,
  maxStage: 3,
  growCooldownDays: 3,
  targetDivisor: 15,
  targetMin: 8,
  stageScaleStep: 0.15,
  baseScale: 1,
} as const;
export const EFFECT_CAP = 2;

/**
 * 이슈 #9: 물고기 헤엄 공간 예산. 물고기 몸 높이(카탈로그 bodyHeight × 크기 배율) 합이
 * 헤엄 띠 높이의 maxFill배를 넘지 않게 한다. 넘으면 새 물고기 대신 다른 종류가 생기거나 다른 생물이 자란다.
 * 0.2.0에서 추가. 그 전 스냅샷은 그대로 둔다.
 */
export const FISH_SPACE = { bandHeight: 330, maxFill: 1.4 } as const;

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
  /** 0.3.0 감정 흔적 자리: 먼 줄(y 478, 수초 뒤쪽)과 바닥 앞줄(y 548). 기본 생태계 줄(505·518·522·585)과 높이가 달라 서로 막지 않고, 같은 줄 안에서만 minDist 간격(높이 차 nearDy 미만이면 같은 줄로 봄) */
  emotion: { rows: [{ y: 478, layer: 'back' }, { y: 548, layer: 'floor' }], xs: [45, 110, 175, 240, 305, 370, 435, 500, 565, 630, 695, 760, 825, 890, 955], minDist: 55, nearDy: 20 },
  jitter: 30,
  retries: 5,
} as const;

/** 이끼 단계 기준(빠진 날 수). 쉬는 날 제외. */
export const MOSS = { stage1: 3, stage2: 7, stage3: 14 } as const;

/** 진행 중 어항 권장 안내 기준 / 기술 상한 */
export const ACTIVE_TANKS = { recommended: 5, hardCap: 50 } as const;

/** 미확정 스냅샷 자동 확정 시간 */
export const CONFIRM_AFTER_MS = 24 * 60 * 60 * 1000;
