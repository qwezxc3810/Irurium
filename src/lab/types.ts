import type { NewEntry } from '../engine/session';
import type { Change, ISODate, Lifecycle, ObjectKind, TankConfig, TankState } from '../engine/types';

/**
 * 검증실(src/lab) 공통 타입.
 * 검증실은 실제 앱 기능과 분리되어 있다. 엔진(src/engine)과 렌더러(src/render)를 가져다 쓰기만 하고 고치지 않는다.
 */

/**
 * 데이터 출처. 화면·보고서에서 항상 구분해서 표시한다.
 * - sample: 검증용으로 만든 임의의 가상 관장 기록(실제 사람이 쓴 기록이 아님)
 * - user: 실제 앱에서 사용자가 남긴 기록(읽기 전용, 스냅샷을 다시 계산하거나 바꾸지 않음)
 * - derived: 실제 기록을 복사해 시드 등을 바꿔 본 가상 실험(원본과 별개)
 */
export type DataOrigin = 'sample' | 'user' | 'derived';

export const ORIGIN_LABEL: Record<DataOrigin, string> = {
  sample: '샘플(가상 관장)',
  user: '실제 기록 · 읽기 전용',
  derived: '실제 기록 기반 가상 실험',
};

/** 샘플 어항 id는 반드시 이 접두사로 시작한다. 실제 어항 id와 섞이지 않게 하는 표시. */
export const SAMPLE_PREFIX = 'sample:';

export interface ScriptedEntry extends NewEntry {
  /** 기록 시각 'HH:MM'(Asia/Seoul). 확정 순서·24시간 확정 계산에 쓴다. */
  time: string;
}

export interface SampleTank {
  key: string;
  label: string;
  cfg: TankConfig;
  entries: ScriptedEntry[];
  /** 시뮬레이션 날짜 수(기록이 없는 날도 프레임을 만든다) */
  days: number;
  restWeekdays?: number;
  /** 마지막 쪽에 도착하면 '다 읽었어요'로 답해 완성한다 */
  finishOnLastPage?: boolean;
  /** 짝짓기 테스트 등에서 쓰는 정답 라벨 */
  tags?: Record<string, string>;
}

export interface SampleScenario {
  id: string;
  group: 'case' | 'compare' | 'long' | 'experiment';
  origin: 'sample';
  title: string;
  summary: string;
  /** 무엇을 보면 되는지 */
  watch: string;
  hypotheses: string[];
  tanks: SampleTank[];
  /** 갤러리 기본 열(날짜) */
  checkpoints: number[];
}

export interface FrameMetrics {
  fish: number;
  plant: number;
  rock: number;
  symbol: number;
  total: number;
  /** 상한(물고기 12 + 수초 10 + 수석 6 + 상징 4 = 32) 대비 채움 % */
  fillPct: number;
  distinct: number;
  avgScale: number;
  maxScale: number;
  lightTemp: number;
  lightEnergy: number;
  /** 물빛 대표색(배경 물색 + 감정 조명 겹침, 렌더러와 같은 공식) */
  waterHex: string;
  /** 조명 방향과 가장 가까운 마음 칩. 거의 움직이지 않았으면 '중립' */
  moodName: string;
  stage: number;
  stageName: string;
  effects: string[];
  speed: number;
  depth: number;
}

export interface LabEvent {
  day: number;
  date: ISODate;
  level: 'growth' | 'special' | 'finale';
  text: string;
  kind: ObjectKind | null;
  /** 새 오브젝트가 생겼으면 true, 기존 것이 자랐으면 false, 효과만이면 null */
  isNew: boolean | null;
  el: string | null;
}

export interface DayFrame {
  day: number;
  date: ISODate;
  state: TankState;
  moss: 0 | 1 | 2 | 3;
  entries: number;
  changes: Change[];
  lifecycle: Lifecycle;
  progress: number;
  /** 그날 조명이 움직인 비율(하루 상한 30%) */
  lightUsed: number;
  metrics: FrameMetrics;
}

export interface RunResult {
  key: string;
  label: string;
  origin: DataOrigin;
  cfg: TankConfig;
  frames: DayFrame[];
  events: LabEvent[];
  /** 모든 스냅샷의 contentHash를 순서대로 이은 것. 재현성 비교용 */
  chainHash: string;
  snapshotCount: number;
  entryCount: number;
  invariants: string[];
  tags: Record<string, string>;
  /** 마지막 스냅샷 원장의 감정 이력 평균(하루 1일치 무게로 합친 값) */
  trailAvg: { temp: number; energy: number; days: number };
  /** 하루 1회·조명 30%·확정 순서 등 규칙 검사 */
  rules: RuleCheck[];
}

export interface RuleCheck {
  id: string;
  name: string;
  ok: boolean;
  detail: string;
}
