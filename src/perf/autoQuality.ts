import type { RenderQuality } from '../render/quality';
import type { FrameStats } from './frameStats';

/**
 * 그래픽 품질 자동 전환. 어항 FPS(PixiJS가 실제로 그린 프레임)를 보고 버거우면 저사양으로 내린다.
 * - 화면에 그리는 방식만 바뀐다(엔진·스냅샷·생물 수는 그대로).
 * - 자동으로 올리지는 않는다(모드가 왔다 갔다 하지 않게). 자동 판정은 기기에 저장하고, 7일 뒤 다시 일반으로 시험한다.
 * 기준 숫자는 초안이다. 보급형 휴대폰 실측(docs/PERF.md) 뒤 다듬는다.
 */

export type QualityPref = 'auto' | 'normal' | 'low';

export const AUTO = {
  /** 시작·모드 전환 직후 흔들림을 빼는 시간 */
  warmupMs: 2000,
  /** 판정에 쓰는 최근 구간 */
  windowMs: 3000,
  /** 처음 10초 안에는 3번(약 3초) 연속 버거우면 내림 */
  startupMs: 10000,
  startupSlowSteps: 3,
  /** 그 뒤(발열 등)에는 8번(약 8초) 연속이어야 내림 */
  ongoingSlowSteps: 8,
  /**
   * 목표 FPS는 60으로 고정. 평균이 48(80%) 아래이거나 1% 느린 프레임이 30(50%) 아래면 버거움(docs/PERF.md 기준과 같음).
   * 화면 주사율로 목표를 정하지 않는 까닭: 그리기가 느리면 브라우저 갱신도 같이 느려져 주사율을 낮게 잘못 보고,
   * 그러면 버벅이는 기기를 놓친다. 120Hz 기기도 60fps면 충분하다.
   */
  targetFps: 60,
  avgRatio: 0.8,
  lowRatio: 0.5,
  /** 3초 판정 구간에 이보다 프레임이 적으면(약 7fps 아래) 바로 버거움(구간이 짧으면 비례해서 줄임) */
  minFrames: 20,
  /** 관찰한 시간 중 프레임이 덮은 비율이 이보다 낮으면 '멈춤'(1초 넘는 정지는 통계에서 빠지므로 따로 본다) */
  minCoverage: 0.5,
  /** 화면 복귀·준비 직후 이만큼은 관찰해야 판정 */
  minObservedMs: 1000,
  /** 자동 판정을 기억하는 기간 */
  rememberMs: 7 * 24 * 60 * 60 * 1000,
  /** 사양으로 처음부터 저사양을 고르는 기준(보조) */
  hintMemoryGb: 2,
  hintCores: 2,
} as const;

export const PREF_LABEL: Record<QualityPref, string> = { auto: '자동', normal: '일반', low: '저사양' };

export type FrameVerdict = 'ok' | 'slow' | 'stall';

/**
 * 렌더러가 준비됐고 화면이 보이는 동안 observedMs 만큼 관찰한 프레임으로 판정한다.
 * - stall: 프레임이 0개이거나, 프레임이 덮은 시간이 관찰 시간의 절반 미만(1초 넘는 정지가 있었음)
 * - slow: 프레임이 아주 적거나, 평균·1% 느린 프레임이 기준 아래
 * 로딩 중·숨김은 여기 오기 전에 걸러진다(autoStep).
 */
export function judgeFrames(stats: FrameStats, observedMs: number): FrameVerdict {
  if (stats.frames === 0 || stats.durationMs < observedMs * AUTO.minCoverage) return 'stall';
  if (stats.frames < AUTO.minFrames * Math.min(1, observedMs / AUTO.windowMs)) return 'slow';
  const t = AUTO.targetFps;
  return stats.avgFps < t * AUTO.avgRatio || stats.low1Fps < t * AUTO.lowRatio ? 'slow' : 'ok';
}

export interface AutoState {
  quality: RenderQuality;
  /** 지금 모드로 보낸 시간(보이는 동안만) */
  elapsedMs: number;
  slowSteps: number;
  /** 저사양으로 내린 까닭(내렸을 때만) */
  reason: string | null;
}

export function autoStart(quality: RenderQuality, reason: string | null = null): AutoState {
  return { quality, elapsedMs: 0, slowSteps: 0, reason };
}

export interface AutoSample {
  dtMs: number;
  /** 최근 관찰 구간(최대 3초)의 어항 프레임 통계 */
  stats: FrameStats;
  /** 렌더러가 준비됐는지(로딩 중이면 false) */
  ready: boolean;
  visible: boolean;
  /** 준비·화면 복귀 이후 실제로 관찰한 시간(최대 3초). 이보다 오래된 프레임은 stats에 없다 */
  observedMs: number;
}

/** 약 1초마다 부른다. 같은 입력이면 같은 결과(테스트 가능) */
export function autoStep(s: AutoState, x: AutoSample): AutoState {
  if (s.quality === 'low') return s;
  // 숨김: 세지 않고 연속 기록도 끊음. 로딩 중: 아직 판정하지 않음(시간도 세지 않음)
  if (!x.visible) return { ...s, slowSteps: 0 };
  if (!x.ready) return s;
  const elapsedMs = s.elapsedMs + x.dtMs;
  if (elapsedMs <= AUTO.warmupMs) return { ...s, elapsedMs };
  if (x.observedMs < AUTO.minObservedMs) return { ...s, elapsedMs };
  const verdict = judgeFrames(x.stats, x.observedMs);
  const slowSteps = verdict === 'ok' ? 0 : s.slowSteps + 1;
  const startup = elapsedMs < AUTO.warmupMs + AUTO.startupMs;
  const need = startup ? AUTO.startupSlowSteps : AUTO.ongoingSlowSteps;
  if (slowSteps >= need) {
    const t = AUTO.targetFps;
    const when = startup ? '시작할 때' : '쓰는 중에';
    return {
      quality: 'low', elapsedMs: 0, slowSteps: 0,
      reason: verdict === 'stall'
        ? `${when} 어항 그리기가 ${need}초 넘게 멈추거나 끊겼어요(최근 ${(x.observedMs / 1000).toFixed(0)}초에 그린 프레임 ${x.stats.frames}개)`
        : `${when} 어항이 ${need}초 넘게 버거웠어요(평균 ${x.stats.avgFps.toFixed(0)}fps · 1% 느린 ${x.stats.low1Fps.toFixed(0)}fps, 목표 ${t}fps)`,
    };
  }
  return { ...s, elapsedMs, slowSteps };
}

export interface StoredDecision {
  quality: 'low';
  at: number;
  reason: string;
}

export interface DeviceHint {
  memoryGb: number | null;
  cores: number | null;
}

/** 앱을 열 때 시작 모드 */
/** retest: "일반으로 다시 시험하기"를 눌렀을 때. 기억한 판정과 사양 추정을 건너뛰고 일반으로 시험한다 */
export function initialQuality(pref: QualityPref, stored: StoredDecision | null, nowMs: number, hint: DeviceHint, retest = false): { quality: RenderQuality; reason: string | null } {
  if (pref !== 'auto') return { quality: pref, reason: null };
  if (retest) return { quality: 'normal', reason: null };
  if (stored && nowMs - stored.at < AUTO.rememberMs) return { quality: 'low', reason: `지난 자동 판정: ${stored.reason}` };
  if ((hint.memoryGb != null && hint.memoryGb <= AUTO.hintMemoryGb) || (hint.cores != null && hint.cores <= AUTO.hintCores)) {
    return { quality: 'low', reason: `기기 사양(메모리 ${hint.memoryGb ?? '?'}GB · 코어 ${hint.cores ?? '?'}개)으로 저사양부터 시작` };
  }
  return { quality: 'normal', reason: null };
}

/** 저장소(브라우저 저장소가 막혀 있으면 조용히 넘어간다) */
export const PREF_KEY = 'irurium.quality.pref';
export const AUTO_KEY = 'irurium.quality.auto';

export function loadPref(storage: Pick<Storage, 'getItem'> | null): QualityPref {
  try {
    const v = storage?.getItem(PREF_KEY);
    return v === 'normal' || v === 'low' || v === 'auto' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function loadDecision(storage: Pick<Storage, 'getItem'> | null): StoredDecision | null {
  try {
    const raw = storage?.getItem(AUTO_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<StoredDecision>;
    return d.quality === 'low' && typeof d.at === 'number' && typeof d.reason === 'string' ? (d as StoredDecision) : null;
  } catch {
    return null;
  }
}

export function safeStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}
