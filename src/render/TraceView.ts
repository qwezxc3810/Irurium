import { Container, Graphics, Text } from 'pixi.js';
import { EMOTIONS } from '../engine/mood';
import type { PlacedObject } from '../engine/types';

/**
 * 0.3.0 감정 흔적의 **임시 도형**(그림이 나오기 전 시제품). 감정마다 색과 글자 하나, 자람 단계는 점으로 보여 준다.
 * 실제 그림(세미 리얼 상징)은 다음 단계에서 매니페스트로 바꾼다. 엔진 상태는 읽기만 한다.
 */
const COLORS: Record<string, number> = {
  'emo.joy': 0xf59e0b, 'emo.flutter': 0xf472b6, 'emo.excited': 0xef4444, 'emo.proud': 0xa3a3a3,
  'emo.calm': 0x5eead4, 'emo.longing': 0x93c5fd, 'emo.lonely': 0xfde68a, 'emo.sad': 0x3b82f6,
  'emo.stuffy': 0x65a30d, 'emo.lost': 0x94a3b8, 'emo.pain': 0x4b5563, 'emo.sleepy': 0xc4b5fd,
};
const BY_SYMBOL = new Map(EMOTIONS.map((e) => [e.symbol, e]));

export class TraceView {
  readonly root = new Container();
  private shape = new Graphics();
  private label: Text;
  private pips = new Graphics();

  constructor(public obj: PlacedObject) {
    const emo = BY_SYMBOL.get(obj.el);
    const color = COLORS[emo?.id ?? ''] ?? 0xffffff;
    // 바닥에 놓인 둥근 조약돌 모양(아래가 기준점)
    this.shape.roundRect(-20, -34, 40, 34, 14).fill({ color, alpha: 0.9 }).stroke({ color: 0xffffff, width: 2, alpha: 0.75 });
    this.label = new Text({ text: emo?.name.slice(0, 1) ?? '?', style: { fontSize: 18, fontWeight: '700', fill: 0xffffff, fontFamily: 'sans-serif' } });
    this.label.anchor.set(0.5);
    this.label.position.set(0, -18);
    this.root.addChild(this.shape, this.label, this.pips);
    this.root.position.set(obj.x, obj.y);
    this.update(obj);
  }

  update(obj: PlacedObject) {
    this.obj = obj;
    this.root.scale.set(obj.scale * (obj.layer === 'back' ? 0.8 : 1)); // 먼 줄은 조금 작게
    const stage = obj.stage ?? 1;
    this.pips.clear();
    for (let i = 0; i < stage; i++) this.pips.circle(-8 + i * 8, -40, 3).fill({ color: 0xffffff, alpha: 0.95 });
  }

  destroy() {
    this.root.destroy({ children: true });
  }
}
