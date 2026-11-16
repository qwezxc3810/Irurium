import { ENGINE_VERSION } from '../engine/config';
import { QUALITY_LABEL, type RenderQuality } from '../render/quality';
import { sourceLabel, type Declared, type EnvInfo } from './env';

/** 같은 조건끼리 비교하려고 측정자가 적는 측정 조건 */
export interface MeasureConditions {
  model: string;
  browser: string;
  powerSaving: 'on' | 'off' | 'unknown';
  brightness: string;
  /** 화면 주사율. 패널이 브라우저 갱신 간격으로 추정해 미리 채우고, 측정자가 고칠 수 있다 */
  refreshRate: string;
  /** 측정 끝났을 때 손에 느껴지는 발열 */
  thermal: 'normal' | 'warm' | 'hot' | 'unknown';
}

export const EMPTY_CONDITIONS: MeasureConditions = { model: '', browser: '', powerSaving: 'unknown', brightness: '', refreshRate: '', thermal: 'unknown' };
const POWER_LABEL = { on: '켬', off: '끔', unknown: '모름' } as const;
export const THERMAL_LABEL = { normal: '보통', warm: '따뜻함', hot: '뜨거움', unknown: '모름' } as const;

/** 브라우저 갱신 간격(ms) 중앙값으로 흔한 주사율(60·90·120·144Hz) 중 가까운 값을 고른다 */
export function estimateRefreshRate(deltas: readonly number[]): number | null {
  const d = deltas.filter((x) => x > 0 && x < 100).sort((a, b) => a - b);
  if (d.length < 30) return null;
  const hz = 1000 / d[Math.floor(d.length / 2)]!;
  return [30, 60, 90, 120, 144, 165].reduce((best, r) => (Math.abs(r - hz) < Math.abs(best - hz) ? r : best), 60);
}
import type { FrameStats } from './frameStats';

export interface RenderInfo {
  dpr: number;
  resolution: number;
  canvasCss: [number, number];
  canvasPx: [number, number];
  backend: string;
}

export interface PerfResult {
  scene: string;
  quality: RenderQuality;
  /** 계획한 측정 시간(초)과 실제로 잰 구간 길이(ms, 시작~끝 시각) */
  plannedSeconds: number;
  measuredMs: number;
  warmupMs: number;
  /** 1차 지표: 어항 FPS(PixiJS가 실제로 그린 프레임) */
  aquarium: FrameStats;
  /** 진단: 브라우저 갱신 간격(독립 requestAnimationFrame). 어항 성능 판정에 쓰지 않는다 */
  raf: FrameStats;
  render: RenderInfo;
  /** 무효 사유(있으면 참고용) */
  invalid: string | null;
  /** 진단용 어항 갱신 제한(0이면 없음, 음수면 멈춤) */
  frameLimit: number;
  /** 1초 넘게 멈춰 버린 간격 수(어항) */
  gaps: number;
  at: string;
  /** 화면에 그린 생물 수(저사양 모드에서도 같아야 함) */
  objects: { fish: number; plant: number; rock: number; symbol: number };
}

const f1 = (x: number) => x.toFixed(1);

export function limitLabel(n: number): string {
  return n < 0 ? '멈춤' : n > 0 ? `${n}fps 제한` : '제한 없음';
}

export function formatResult(r: PerfResult): string {
  const a = r.aquarium;
  const lines = [
    `- ${r.scene} · ${QUALITY_LABEL[r.quality]} 모드 · 실측 ${f1(r.measuredMs / 1000)}초(워밍업 ${r.warmupMs / 1000}초 뒤) (${r.at})`,
  ];
  if (r.invalid) lines.push(`  ⚠️ 무효(참고용): ${r.invalid}`);
  if (r.frameLimit !== 0) lines.push(`  ⚠️ 진단용 어항 갱신 제한: ${limitLabel(r.frameLimit)} — 성능 값으로 쓰지 마세요`);
  lines.push(
    `  어항 FPS(PixiJS 렌더링 프레임) 평균 ${f1(a.avgFps)} · 1% 느린 프레임 ${f1(a.low1Fps)} (프레임 ${a.frames}개, 유효 시간 ${f1(a.durationMs / 1000)}초)`,
    `  어항 프레임 시간 평균 ${f1(a.meanMs)}ms · 99% ${f1(a.p99Ms)}ms · 최대 ${f1(a.maxMs)}ms · 33ms 넘은 프레임 ${a.longFrames}개(${f1(a.longShare * 100)}%)`,
    `  [진단] 브라우저 갱신 간격(rAF, 어항 성능 아님) 평균 ${f1(r.raf.avgFps)}fps · 1% 느린 ${f1(r.raf.low1Fps)}fps`,
    `  해상도 DPR ${r.render.dpr} → 렌더링 ${r.render.resolution} · 캔버스 ${r.render.canvasCss.join('×')} (실제 픽셀 ${r.render.canvasPx.join('×')}) · ${r.render.backend}`,
    `  어항 구성 물고기 ${r.objects.fish} · 수초 ${r.objects.plant} · 수석 ${r.objects.rock} · 상징 ${r.objects.symbol}${r.gaps ? ` · 측정 중 1초 넘게 멈춘 구간 ${r.gaps}번` : ''}`,
  );
  return lines.join('\n');
}

/** 복사용 텍스트. 맨 위에 측정 출처(실기기/시뮬레이션)를 적는다 */
export function formatReport(results: PerfResult[], env: EnvInfo, declared: Declared, cond: MeasureConditions = EMPTY_CONDITIONS): string {
  const src = sourceLabel(env, declared);
  return [
    `# 이루리움 어항 성능 측정 (엔진 ${ENGINE_VERSION})`,
    `측정 출처: ${src.real ? '✅ ' : '⚠️ '}${src.text}`,
    `자동 판정: ${env.kind === 'mobile' ? '휴대폰' : env.kind === 'simulated' ? '시뮬레이션' : '데스크톱'} (${env.reasons.join(', ')})`,
    `기기: ${env.userAgent}`,
    `CPU 코어 ${env.cores ?? '알 수 없음'} · 메모리 ${env.memoryGb != null ? `${env.memoryGb}GB 이상` : '알 수 없음'}`,
    `측정 조건(측정자 기록): 기종 ${cond.model.trim() || '안 적음'} · 브라우저 ${cond.browser.trim() || '안 적음'} · 화면 주사율 ${cond.refreshRate.trim() || '안 적음'} · 절전 모드 ${POWER_LABEL[cond.powerSaving]} · 화면 밝기 ${cond.brightness.trim() || '안 적음'} · 발열 ${THERMAL_LABEL[cond.thermal]}`,
    '',
    ...results.map(formatResult),
  ].join('\n');
}
