/** 간단한 값 보간. 시간(초) 동안 from → to, ease-out. */
export class Tween {
  private t = 0;
  constructor(private from: number, private to: number, private duration: number) {}
  step(dt: number) {
    this.t = Math.min(this.duration, this.t + dt);
  }
  get value(): number {
    if (this.duration <= 0) return this.to;
    const p = this.t / this.duration;
    const e = 1 - Math.pow(1 - p, 3);
    return this.from + (this.to - this.from) * e;
  }
  get done(): boolean {
    return this.t >= this.duration;
  }
}

/** 오브젝트 tint(-1 차갑게 ~ +1 따뜻하게)를 곱하기 색으로. 원래 색을 크게 해치지 않게 약하게만. */
export function tintFor(v: number): number {
  const k = Math.max(-1, Math.min(1, v)) * 0.12;
  const r = Math.round(255 * (1 - Math.max(0, -k)));
  const g = Math.round(255 * (1 - Math.abs(k) * 0.4));
  const b = Math.round(255 * (1 - Math.max(0, k)));
  return (r << 16) | (g << 8) | b;
}

/**
 * 물고기 회전 진행률 p(0~1)에서의 좌우 크기.
 * p=0 → dir(지금 방향), p=0.5 → 0(옆으로 선 순간), p=1 → -dir(새 방향). 시작과 끝에서 값이 튀지 않는다.
 */
export function turnScale(dir: 1 | -1, p: number): number {
  return dir * Math.cos(Math.PI * Math.max(0, Math.min(1, p)));
}
