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

/** emotion: 0.3.0 감정 흔적(감정 사전 상징) */
export type ObjectKind = 'fish' | 'plant' | 'rock' | 'symbol' | 'emotion';
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
  /** 0.3.0 감정 흔적만: 자람 단계(1~TRACE.maxStage) */
  stage?: number;
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
  /** 0.3.0 감정 흔적 원장(0.2.0 어항엔 없음) */
  trace?: TraceLedger;
}

export interface TraceLedger {
  /**
   * 감정별로 따로 모으는 쪽수(15쪽이 차기 전 나머지). 감정 id → 기여한 기록들(먼저 온 것부터).
   * 서로 다른 감정의 쪽수는 섞지 않는다. 감정을 알 수 없는 기록의 쪽수는 모으지 않는다(완독 목표에만 반영).
   */
  buckets: Record<string, Array<{ seq: number; date: ISODate; pages: number }>>;
  /** 하루 상한으로 미뤄 둔 흔적. 원래 기록의 감정·순번·날짜를 함께 보관해 나중에 놓여도 출처가 바뀌지 않는다(먼저 미룬 것부터) */
  queue: Array<{ emotion: string; seq: number; date: ISODate; from?: ISODate }>;
  day: { date: ISODate | null; count: number };
  /** 기록한 대표 감정 횟수(감정 id → 횟수). 완독 채움 비율에 쓴다 */
  emotionCounts: Record<string, number>;
  /** 실제로 놓이거나 자란 흔적 수 */
  made: number;
  /** 흔적별 마지막으로 자란 날(쿨다운) */
  grownOn: Record<string, ISODate>;
}

export type ChangeLevel = 'daily' | 'growth' | 'special' | 'finale' | 'info';

export interface Change {
  level: ChangeLevel;
  text: string;
  objectId?: string;
  /** 0.3.0 감정 흔적만: 미뤄 둔 흔적이 나중 기록에서 놓였을 때, 그 흔적을 만든 원래 기록의 순번(기억 보기가 원래 기록을 보여 줌) */
  sourceSeq?: number;
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
  /** 계산에 쓴 기록 입력(저장 당시 값). 확정 후 기록을 고쳐도 이 값은 그대로라서 I2 재현 검사에 쓴다. */
  input: EngineInput | null;
  /** 계산에 쓴 어항 설정(총 쪽수 수정 등으로 설정이 바뀌어도 과거 계산을 재현하기 위해). */
  cfg: TankConfig;
  /** state·ledger·changes의 해시. 만든 뒤 바뀌면 I3 위반. */
  contentHash: string;
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
  /**
   * discarded: 미확정 상태에서 지움(스냅샷도 폐기, 활동으로 치지 않음)
   * hidden: 확정 후 지움(어항은 그대로, 활동 사실은 남음 → 이끼 기준에 포함)
   */
  deleteMode: 'discarded' | 'hidden' | null;
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
