import { ENGINE_VERSION } from '../engine/config';
import { QUALITY_LABEL, type RenderQuality } from '../render/quality';
import { sourceLabel, type Declared, type EnvInfo } from './env';
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
    `  어항 구성 물고기 ${r.objects.fish} · 수초 ${r.objects.plant} · 수석 ${r.objects.rock} · 상징 ${r.objects.symbol}${r.gaps ? ` · 1초 넘게 멈춰 버린 간격 ${r.gaps}개` : ''}`,
  );
  return lines.join('\n');
}

/** 복사용 텍스트. 맨 위에 측정 출처(실기기/시뮬레이션)를 적는다 */
export function formatReport(results: PerfResult[], env: EnvInfo, declared: Declared): string {
  const src = sourceLabel(env, declared);
  return [
    `# 이루리움 어항 성능 측정 (엔진 ${ENGINE_VERSION})`,
    `측정 출처: ${src.real ? '✅ ' : '⚠️ '}${src.text}`,
    `자동 판정: ${env.kind === 'mobile' ? '휴대폰' : env.kind === 'simulated' ? '시뮬레이션' : '데스크톱'} (${env.reasons.join(', ')})`,
    `기기: ${env.userAgent}`,
    `CPU 코어 ${env.cores ?? '알 수 없음'} · 메모리 ${env.memoryGb != null ? `${env.memoryGb}GB 이상` : '알 수 없음'}`,
    '',
    ...results.map(formatResult),
  ].join('\n');
}
