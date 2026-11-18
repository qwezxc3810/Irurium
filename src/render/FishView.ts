import { Container, MeshRope, Point, type Texture } from 'pixi.js';
import { mulberry32, seedFromString, type Rng } from '../engine/random';
import type { PlacedObject, TankState } from '../engine/types';
import type { ElementAsset } from '../assets/manifest';
import { Tween, tintFor, turnScale } from './util';
import { displayScale, type Box } from './display';

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

  /** 무리를 이끌 때: 대열이 차지하는 좌우 폭의 절반(논리 좌표). 벽 판정·시작 위치에 더해 무리 전체가 벽 안에서 돌게 한다 */
  private extraHalf = 0;
  /** 위치 제한에 쓰는 대열 폭. 폭이 넓어지면 extraHalf로 부드럽게 따라가 무리가 튀지 않게 한다 */
  private clampHalf = 0;

  /** laneY: 화면용 헤엄 높이(fishLaneLayout). 없으면 엔진 레인 그대로 */
  constructor(public obj: PlacedObject, texture: Texture, private spec: ElementAsset, laneY?: number, opts: { extraHalfWidth?: number } = {}) {
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
    this.laneY = laneY ?? obj.y;
    this.extraHalf = opts.extraHalfWidth ?? 0;
    this.clampHalf = this.extraHalf;
    this.root.position.set(Math.max(BOUNDS.left + this.extraHalf, Math.min(BOUNDS.right - this.extraHalf, obj.x)), this.laneY);
    const unit = (spec.displayWidth ?? 100) / this.length;
    this.scaleTween = new Tween(unit * displayScale(obj) * 0.6, unit * displayScale(obj), 1.2);
    this.applyScale();
    this.root.alpha = 0;
    this.rope.tint = tintFor(obj.tint);
  }

  update(next: PlacedObject, laneY?: number) {
    const unit = (this.spec.displayWidth ?? 100) / this.length;
    if (next.scale !== this.obj.scale) this.scaleTween = new Tween(this.scaleTween.value, unit * displayScale(next), 1.0);
    this.rope.tint = tintFor(next.tint);
    this.laneY = laneY ?? next.y;
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
    const halfW = (this.length * this.root.scale.x) / 2 + this.extraHalf;
    const hitWall = (this.dir === 1 && x + halfW > BOUNDS.right) || (this.dir === -1 && x - halfW < BOUNDS.left);
    if (this.turning === 0 && (hitWall || this.nextTurnIn <= 0)) this.turning = 0.0001;
    this.clampHalf += (this.extraHalf - this.clampHalf) * Math.min(1, dt * 2.5);
    this.root.x = Math.max(BOUNDS.left + this.clampHalf, Math.min(BOUNDS.right - this.clampHalf, x));

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
    this.root.x = Math.max(BOUNDS.left + this.extraHalf, Math.min(BOUNDS.right - this.extraHalf, this.obj.x));
    this.root.y = Math.max(BOUNDS.top, Math.min(BOUNDS.bottom, this.laneY - state.behavior.depth * 70));
  }

  /**
   * 무리 마리 수가 바뀌면 대열 폭을 새로 잡는다(벽 판정에 더함).
   * immediate(움직임 줄이기·정지 그림)면 지금 자리를 새 안전 범위로 바로 옮기고, 아니면 다음 프레임부터 부드럽게 들어온다
   */
  setExtraHalfWidth(v: number, immediate = false) {
    this.extraHalf = v;
    if (immediate) {
      this.clampHalf = v;
      this.root.x = Math.max(BOUNDS.left + v, Math.min(BOUNDS.right - v, this.root.x));
    }
  }

  /** 지금 바라보는 방향(-1 ~ 1). 도는 중에는 부드럽게 바뀐다. 무리의 따르는 물고기가 대열을 돌릴 때 쓴다 */
  get facing(): number {
    return this.flip.scale.x;
  }

  /**
   * 무리를 따르는 물고기: 이동·벽 판정·회전 타이머 없이, 이끄는 물고기가 정한 자리와 방향만 따른다.
   * 몸 휘기·나타나는 연출·크기만 자기 것으로 움직인다(같은 무리라도 꼬리 박자는 조금씩 다르게).
   */
  follow(dt: number, state: TankState, reducedMotion: boolean, x: number, y: number, facing: number) {
    this.scaleTween.step(dt);
    this.alphaTween.step(dt);
    this.root.alpha = this.alphaTween.value;
    this.applyScale();
    this.flip.scale.x = facing;
    this.root.position.set(x, y);
    if (reducedMotion) return;
    const speedMul = Math.max(0.4, state.behavior.speed);
    const swim = this.spec.swim ?? { amplitude: 0.1, frequency: 1 };
    this.phase += dt * swim.frequency * Math.PI * 2 * (0.8 + speedMul * 0.6);
    const amp = swim.amplitude * this.length;
    for (let i = 0; i < SEGMENTS; i++) {
      const t = i / (SEGMENTS - 1);
      this.points[i]!.y = amp * Math.pow(1 - t, 1.6) * Math.sin(this.phase - t * 3.2);
    }
  }

  /** 지금 화면에서 차지하는 상자(논리 좌표). 앞쪽 수초 투명 처리에 쓴다. */
  bounds(): Box {
    const w = this.length * Math.abs(this.root.scale.x);
    const h = this.rope.texture.height * Math.abs(this.root.scale.y);
    return { x0: this.root.x - w / 2, x1: this.root.x + w / 2, y0: this.root.y - h / 2, y1: this.root.y + h / 2 };
  }

  destroy() {
    this.root.destroy({ children: true });
  }
}
