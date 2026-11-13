import { Container, MeshRope, Point, type Texture } from 'pixi.js';
import { mulberry32, seedFromString, type Rng } from '../engine/random';
import type { PlacedObject, TankState } from '../engine/types';
import type { ElementAsset } from '../assets/manifest';
import { Tween, tintFor, turnScale } from './util';

/**
 * 물고기 한 마리. 통짜 옆모습 이미지 한 장을 MeshRope에 입혀 몸통과 꼬리를 휘게 한다.
 * 이미지 규칙: 머리가 오른쪽, 투명 배경. 왼쪽 끝 = 꼬리, 오른쪽 끝 = 머리.
 */
const SEGMENTS = 12;

const BOUNDS = { left: 70, right: 930, top: 90, bottom: 450 };

export class FishView {
  readonly root = new Container();
  private flip = new Container();
  private rope: MeshRope;
  private points: Point[] = [];
  private length: number;
  private rng: Rng;
  private phase: number;
  private dir: 1 | -1;
  private turning = 0; // 0이면 회전 중 아님, 0~1 진행
  private nextTurnIn: number;
  private baseSpeed: number;
  private bobPhase: number;
  private scaleTween: Tween;
  private alphaTween = new Tween(0, 1, 1.2);
  laneY: number;

  constructor(public obj: PlacedObject, texture: Texture, private spec: ElementAsset) {
    this.length = texture.width;
    for (let i = 0; i < SEGMENTS; i++) this.points.push(new Point((i / (SEGMENTS - 1) - 0.5) * this.length, 0));
    this.rope = new MeshRope({ texture, points: this.points });
    this.flip.addChild(this.rope);
    this.root.addChild(this.flip);
    this.rng = mulberry32(seedFromString(obj.id + obj.el));
    this.phase = this.rng() * Math.PI * 2;
    this.bobPhase = this.rng() * Math.PI * 2;
    this.dir = this.rng() < 0.5 ? 1 : -1;
    this.nextTurnIn = 4 + this.rng() * 8;
    this.baseSpeed = 28 + this.rng() * 22;
    this.laneY = obj.y;
    this.root.position.set(obj.x, obj.y);
    const unit = (spec.displayWidth ?? 100) / this.length;
    this.scaleTween = new Tween(unit * obj.scale * 0.6, unit * obj.scale, 1.2);
    this.applyScale();
    this.root.alpha = 0;
    this.rope.tint = tintFor(obj.tint);
  }

  update(next: PlacedObject) {
    const unit = (this.spec.displayWidth ?? 100) / this.length;
    if (next.scale !== this.obj.scale) this.scaleTween = new Tween(this.scaleTween.value, unit * next.scale, 1.0);
    this.rope.tint = tintFor(next.tint);
    this.laneY = next.y;
    this.obj = next;
  }

  private applyScale() {
    const s = this.scaleTween.value;
    this.root.scale.set(s);
  }

  tick(dt: number, state: TankState, reducedMotion: boolean) {
    this.scaleTween.step(dt);
    this.alphaTween.step(dt);
    this.root.alpha = this.alphaTween.value;
    this.applyScale();
    if (reducedMotion) {
      this.flip.scale.x = this.dir;
      return;
    }
    const speedMul = Math.max(0.4, state.behavior.speed);
    const swim = this.spec.swim ?? { amplitude: 0.1, frequency: 1 };

    // 몸통 휘기: 꼬리 쪽일수록 크게, 머리 쪽은 거의 고정
    this.phase += dt * swim.frequency * Math.PI * 2 * (0.8 + speedMul * 0.6);
    const amp = swim.amplitude * this.length;
    for (let i = 0; i < SEGMENTS; i++) {
      const t = i / (SEGMENTS - 1); // 0 = 꼬리, 1 = 머리
      const w = Math.pow(1 - t, 1.6);
      this.points[i]!.y = amp * w * Math.sin(this.phase - t * 3.2);
    }

    // 방향 전환: 좌우 반전 크기를 cos 곡선으로 줄였다 키워 몸을 돌리는 것처럼 보이게.
    // p=0에서 dir(지금 방향), p=1에서 -dir(새 방향)이 되어 시작·끝 모두 끊김 없이 이어진다.
    if (this.turning > 0) {
      this.turning += dt / 0.55;
      const p = Math.min(1, this.turning);
      this.flip.scale.x = turnScale(this.dir, p);
      if (p >= 1) {
        this.dir = this.dir === 1 ? -1 : 1;
        this.turning = 0;
        this.flip.scale.x = this.dir;
        this.nextTurnIn = 5 + this.rng() * 9;
      }
    } else {
      this.flip.scale.x = this.dir;
    }

    // 이동: 회전하는 동안은 느려진다
    const v = this.baseSpeed * speedMul * (this.turning > 0 ? 0.25 : 1);
    const x = this.root.x + this.dir * v * dt;
    this.nextTurnIn -= dt;
    const halfW = (this.length * this.root.scale.x) / 2;
    const hitWall = (this.dir === 1 && x + halfW > BOUNDS.right) || (this.dir === -1 && x - halfW < BOUNDS.left);
    if (this.turning === 0 && (hitWall || this.nextTurnIn <= 0)) this.turning = 0.0001;
    this.root.x = Math.max(BOUNDS.left, Math.min(BOUNDS.right, x));

    // 높이: 레인 + 감정 깊이(활발하면 위, 고요하면 아래) + 느린 출렁임
    this.bobPhase += dt * 0.6;
    const depthOffset = -state.behavior.depth * 70;
    const targetY = this.laneY + depthOffset + Math.sin(this.bobPhase) * 14;
    this.root.y += (Math.max(BOUNDS.top, Math.min(BOUNDS.bottom, targetY)) - this.root.y) * Math.min(1, dt * 0.8);
  }

  /**
   * 정지 화면(검증실 갤러리)용 자세: 나타나는 연출을 끝내고, 감정 깊이를 반영한 높이에 몸을 살짝 휜 채로 둔다.
   * 위치·방향·휜 모양은 오브젝트 id로 정해져서 같은 상태면 언제나 같은 그림이 나온다.
   */
  settle(state: TankState) {
    this.scaleTween.finish();
    this.alphaTween.finish();
    this.root.alpha = 1;
    this.applyScale();
    this.flip.scale.x = this.dir;
    const amp = (this.spec.swim ?? { amplitude: 0.1, frequency: 1 }).amplitude * this.length;
    for (let i = 0; i < SEGMENTS; i++) {
      const t = i / (SEGMENTS - 1);
      this.points[i]!.y = amp * Math.pow(1 - t, 1.6) * Math.sin(this.phase - t * 3.2);
    }
    this.root.x = Math.max(BOUNDS.left, Math.min(BOUNDS.right, this.obj.x));
    this.root.y = Math.max(BOUNDS.top, Math.min(BOUNDS.bottom, this.laneY - state.behavior.depth * 70));
  }

  destroy() {
    this.root.destroy({ children: true });
  }
}
