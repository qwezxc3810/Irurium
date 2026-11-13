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
