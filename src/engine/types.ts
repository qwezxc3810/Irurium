/**
 * 이루리움 어항 엔진의 공통 타입.
 * 이 폴더(src/engine)는 DOM·PixiJS·React를 모른다. 같은 입력이면 어디서 돌려도 같은 결과가 나와야 한다.
 * 근거 문서: 「이루리움(가제) v0.3.2 기술 보완서」 2~4장.
 */

/** 'YYYY-MM-DD'. 기록한 기기 시간대 기준의 날짜. */
export type ISODate = string;

/** 감정 벡터. temp: 차가움(-1) ~ 따뜻함(+1), energy: 고요(-1) ~ 활발(+1). */
export interface MoodVec {
  temp: number;
  energy: number;
  /** 0~1. 칩이나 한마디에서 감정을 얼마나 확신하는지. 0이면 중립. */
  confidence: number;
  labels: string[];
}

export type GoalType = 'amount' | 'free';

export interface Goal {
  type: GoalType;
  /** 총 쪽수. 모르면 null. */
  totalUnits: number | null;
  /** 분량형 하루 목표량(참고용). 자유형은 null. */
  dailyTarget: number | null;
}

export interface TankConfig {
  tankId: string;
  /** 어항 생성 시 한 번 정해지는 시드. */
  seed: number;
  themeId: string;
  goal: Goal;
  /** 어항 시작일. 이끼 계산의 기준점. */
  startDate: ISODate;
}

/** 엔진에 들어가는 기록 한 건. */
export interface EngineInput {
  seq: number;
  localDate: ISODate;
  amount: number;
  /** 독서: 지금 읽은 쪽. */
  progressValue: number | null;
  moodChips: string[];
  note: string;
}

export type ObjectKind = 'fish' | 'plant' | 'rock' | 'symbol';
export type Layer = 'back' | 'floor' | 'mid' | 'front';

/** 어항 안에 놓인 오브젝트 하나. el은 카탈로그 id이고, 그림 파일은 렌더러가 매니페스트로 찾는다. */
export interface PlacedObject {
  id: string;
  el: string;
  kind: ObjectKind;
  layer: Layer;
  /** 논리 좌표(1000 × 600). 물고기는 x가 시작 위치, y가 헤엄 레인 중심. */
  x: number;
  y: number;
  scale: number;
  /** -1(차갑게) ~ +1(따뜻하게). 렌더러가 색 보정에 쓴다. */
  tint: number;
  bornSeq: number;
}

export interface TankState {
  schema: 1;
  themeId: string;
  light: { temp: number; energy: number };
  /** 물고기 행동. speed 배율, depth: -1(바닥 쪽) ~ +1(수면 쪽). */
  behavior: { speed: number; depth: number };
  objects: PlacedObject[];
  /** 동시에 최대 2개. */
  effects: string[];
  completed: boolean;
}

export interface DayMood {
  date: ISODate;
  temp: number;
  energy: number;
  /** 그날 합친 기록 수. 하루 여러 번 기록해도 감정 이력에선 하루 1일치 무게. */
  count: number;
}

/** 엔진이 다음 계산에 쓰는 내부 값. 스냅샷과 함께 저장되고 확정 후엔 바뀌지 않는다. */
export interface Ledger {
  lastEntryDate: ISODate | null;
  entryCount: number;
  growthPoints: number;
  lastMajorDate: ISODate | null;
  dayLightShift: { date: ISODate | null; used: number };
  day: { date: ISODate | null; amount: number; bonusGiven: boolean };
  pendingSpecials: string[];
  firedMilestones: string[];
  moodTrail: DayMood[];
  lastShiftAtDay: number;
  maxProgress: number;
  lastGrowthKind: ObjectKind | null;
  nextObjectNo: number;
}

export type ChangeLevel = 'daily' | 'growth' | 'special' | 'finale' | 'info';

export interface Change {
  level: ChangeLevel;
  text: string;
  objectId?: string;
}

export interface EngineOutput {
  state: TankState;
  ledger: Ledger;
  changes: Change[];
}

export type ConfirmReason = 'genesis' | 'user' | 'next_entry' | 'timeout' | 'finalized';

export interface Snapshot {
  id: string;
  seq: number;
  entryId: string | null;
  baseId: string | null;
  kind: 'genesis' | 'entry' | 'finale';
  state: TankState;
  ledger: Ledger;
  changes: Change[];
  engineVersion: string;
  inputHash: string;
  status: 'draft' | 'confirmed';
  confirmDueAt: number | null;
  confirmedAt: number | null;
  confirmReason: ConfirmReason | null;
}

export interface Entry extends EngineInput {
  id: string;
  clientId: string;
  createdAt: number;
  rev: number;
  deletedAt: number | null;
}

export interface EntryRevision {
  entryId: string;
  at: number;
  field: keyof EngineInput;
  before: unknown;
  after: unknown;
}

export interface RestRule {
  /** 비트마스크. 1<<0 = 일요일 … 1<<6 = 토요일 */
  weekdays: number;
  effectiveFrom: ISODate;
}

export type Lifecycle = 'active' | 'completed' | 'wrapped';
