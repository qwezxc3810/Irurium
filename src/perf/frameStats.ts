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
 * 프레임 시각을 받아 간격을 쌓는다. 어항(PixiJS 렌더링 프레임)과 브라우저 갱신(rAF)이 같은 기록기를 쓴다.
 * - 1초 넘는 간격은 멈춤으로 보고 버린다(gaps).
 * - pause(): 화면이 숨겨졌을 때 부른다. 다음 프레임은 새로 시작해서, 숨김 구간 간격이 섞이지 않는다.
 * - between(from, to): 측정 구간(시작~끝 시각)에 끝난 간격만 꺼낸다. 타이머가 늦게 돌아도 구간 밖 프레임은 들어가지 않는다.
 */
export class FrameRecorder {
  private deltas: number[] = [];
  private stamps: number[] = [];
  private gapStamps: number[] = [];
  private last: number | null = null;
  gaps = 0;

  mark(now: number) {
    if (this.last !== null) {
      const dt = now - this.last;
      if (dt > 1000) {
        this.gaps++;
        this.gapStamps.push(now);
      }
      else if (dt > 0) {
        this.deltas.push(dt);
        this.stamps.push(now);
      }
    }
    this.last = now;
    if (this.deltas.length > 20000) {
      this.deltas = this.deltas.slice(-10000);
      this.stamps = this.stamps.slice(-10000);
    }
  }

  pause() {
    this.last = null;
  }

  between(from: number, to: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.stamps.length; i++) {
      const t = this.stamps[i]!;
      // 간격 전체가 구간 안에 있을 때만
      if (t - this.deltas[i]! >= from && t <= to) out.push(this.deltas[i]!);
    }
    return out;
  }

  /** 측정 구간 안에서 1초 넘게 멈춰 버린 간격 수 */
  gapsBetween(from: number, to: number): number {
    return this.gapStamps.filter((t) => t > from && t <= to).length;
  }

  recent(windowMs: number, now: number): number[] {
    return this.between(now - windowMs, now);
  }

  clear() {
    this.deltas = [];
    this.stamps = [];
    this.gapStamps = [];
    this.last = null;
    this.gaps = 0;
  }
}

/**
 * 브라우저 갱신 간격(진단용). 렌더러와 따로 requestAnimationFrame을 돈다.
 * 어항이 실제로 그린 횟수가 아니다. 어항 렌더러가 느리거나 멈춰도 이 값은 화면 주사율 가까이 나올 수 있다.
 */
export class RafMeter {
  readonly rec = new FrameRecorder();
  private raf = 0;
  private running = false;

  start() {
    if (this.running) return;
    this.running = true;
    const loop = (t: number) => {
      if (!this.running) return;
      this.rec.mark(t);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}
