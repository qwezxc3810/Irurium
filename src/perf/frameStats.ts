/**
 * 프레임 시간(ms) 목록으로 성능 지표를 계산한다. 순수 함수라 테스트할 수 있다.
 * - 평균 FPS: 프레임 수 ÷ 전체 시간
 * - 1% 느린 프레임(1% low): 가장 느린 1% 프레임들의 평균 시간을 FPS로 바꾼 값
 * - 프레임 지연: 평균·99번째 백분위 프레임 시간, 33.4ms(30fps 아래)를 넘은 프레임 수와 비율
 */
export interface FrameStats {
  frames: number;
  durationMs: number;
  avgFps: number;
  low1Fps: number;
  meanMs: number;
  p99Ms: number;
  maxMs: number;
  /** 33.4ms를 넘은 프레임(한 번에 두 프레임 이상 밀림) */
  longFrames: number;
  longShare: number;
}

export const LONG_FRAME_MS = 33.4;

export function computeFrameStats(deltas: readonly number[]): FrameStats {
  const d = deltas.filter((x) => Number.isFinite(x) && x > 0);
  const n = d.length;
  if (n === 0) return { frames: 0, durationMs: 0, avgFps: 0, low1Fps: 0, meanMs: 0, p99Ms: 0, maxMs: 0, longFrames: 0, longShare: 0 };
  const total = d.reduce((s, x) => s + x, 0);
  const sorted = [...d].sort((a, b) => a - b);
  const worstN = Math.max(1, Math.ceil(n * 0.01));
  const worst = sorted.slice(n - worstN);
  const worstMean = worst.reduce((s, x) => s + x, 0) / worst.length;
  const p99 = sorted[Math.min(n - 1, Math.ceil(n * 0.99) - 1)]!;
  const longFrames = d.filter((x) => x > LONG_FRAME_MS).length;
  return {
    frames: n,
    durationMs: total,
    avgFps: (n * 1000) / total,
    low1Fps: 1000 / worstMean,
    meanMs: total / n,
    p99Ms: p99,
    maxMs: sorted[n - 1]!,
    longFrames,
    longShare: longFrames / n,
  };
}

/**
 * requestAnimationFrame 사이 간격을 잰다. 렌더러와 따로 돌아서 화면 전체가 실제로 몇 번 그려졌는지 본다.
 * 탭이 백그라운드로 가면(간격 > 1초) 그 간격은 버리고 표시한다.
 */
export class FrameMeter {
  private deltas: number[] = [];
  private last = 0;
  private raf = 0;
  private running = false;
  private window: number;
  hidden = 0;

  constructor(windowMs = 2000) {
    this.window = windowMs;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = 0;
    const loop = (t: number) => {
      if (!this.running) return;
      if (this.last) {
        const dt = t - this.last;
        if (dt > 1000) this.hidden++;
        else this.deltas.push(dt);
      }
      this.last = t;
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  reset() {
    this.deltas = [];
    this.hidden = 0;
  }

  /** 지금까지 모은 전체 */
  all(): number[] {
    return [...this.deltas];
  }

  /** 최근 windowMs 만큼 */
  recent(): number[] {
    let sum = 0;
    let i = this.deltas.length;
    while (i > 0 && sum < this.window) sum += this.deltas[--i]!;
    if (this.deltas.length > 20000) this.deltas = this.deltas.slice(-5000);
    return this.deltas.slice(i);
  }
}
