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
  seconds: number;
  stats: FrameStats;
  render: RenderInfo;
  /** 백그라운드로 가서 버린 간격 수 */
  hidden: number;
  at: string;
  /** 엔진 상태 요약(저사양 모드에서도 같아야 함) */
  objects: { fish: number; plant: number; rock: number; symbol: number };
}

const f1 = (x: number) => x.toFixed(1);

export function formatResult(r: PerfResult): string {
  const s = r.stats;
  return [
    `- ${r.scene} · ${QUALITY_LABEL[r.quality]} 모드 · ${r.seconds}초 (${r.at})`,
    `  평균 ${f1(s.avgFps)} fps · 1% 느린 프레임 ${f1(s.low1Fps)} fps`,
    `  프레임 시간 평균 ${f1(s.meanMs)}ms · 99% ${f1(s.p99Ms)}ms · 최대 ${f1(s.maxMs)}ms · 33ms 넘은 프레임 ${s.longFrames}개(${f1(s.longShare * 100)}%)`,
    `  해상도 DPR ${r.render.dpr} → 렌더링 ${r.render.resolution} · 캔버스 ${r.render.canvasCss.join('×')} (실제 픽셀 ${r.render.canvasPx.join('×')}) · ${r.render.backend}`,
    `  어항 구성 물고기 ${r.objects.fish} · 수초 ${r.objects.plant} · 수석 ${r.objects.rock} · 상징 ${r.objects.symbol}${r.hidden ? ` · 백그라운드로 가서 버린 간격 ${r.hidden}개` : ''}`,
  ].join('\n');
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
