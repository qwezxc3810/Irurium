// 엄격한 보안 정책(CSP)에서 eval 없이 셰이더 코드를 만들도록 PixiJS 대체 구현을 켠다(호스팅 환경 호환).
import 'pixi.js/unsafe-eval';
import { Application, Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { WORLD } from '../engine/config';
import { mulberry32, seedFromString } from '../engine/random';
import type { PlacedObject, TankState } from '../engine/types';
import { applyOverrides, loadManifest, loadTextures, type AssetOverrides, type LoadedAssets } from '../assets/manifest';
import { FishView } from './FishView';
import { Tween, tintFor } from './util';
import { DISPLAY, displayScale, fishLaneLayout, overlaps, type Box } from './display';

/**
 * 어항 렌더러. 엔진의 TankState를 받아 그리기만 한다(상태를 바꾸지 않는다).
 * 그리는 순서(v0.3.1 수정 노트 5.3): 배경 → 뒤 수초 → 바닥·수석·상징 → 물고기 → 앞 수초 → 빛 효과 → 감정 조명 → 유리·이끼.
 * 수족관 공간 조명은 이 어항 바깥에서 처리하며, 어항 내부 색에 필터를 걸지 않는다.
 */

export interface RenderOptions {
  mossStage: 0 | 1 | 2 | 3;
  reducedMotion: boolean;
}

interface StaticView {
  obj: PlacedObject;
  sprite: Sprite;
  baseScale: number;
  scaleTween: Tween;
  /** 앞쪽 수초: 물고기가 뒤를 지나면 옅어진다(이슈 #6) */
  fade: number;
  alphaTween: Tween;
  swayPhase: number;
}

interface Bubble { s: Sprite; vy: number; wobble: number; phase: number }

export class AquariumRenderer {
  private app = new Application();
  private world = new Container();
  private layers = {
    background: new Container(),
    back: new Container(),
    floor: new Container(),
    mid: new Container(),
    front: new Container(),
    fx: new Container(),
    light: new Container(),
    glass: new Container(),
  };
  private fish = new Map<string, FishView>();
  private statics = new Map<string, StaticView>();
  private bubbles: Bubble[] = [];
  private bubbleTimer = 0;
  private lightOverlay = new Graphics();
  private moss = new Container();
  private mossGraphics = new Graphics();
  private mossMask = new Graphics();
  private wipe: { t: number; bar: Graphics } | null = null;
  private fxSprites = new Map<string, Sprite>();
  private state: TankState | null = null;
  private opts: RenderOptions = { mossStage: 0, reducedMotion: false };
  private time = 0;
  private ready = false;
  private shownMossStage = 0;

  private assets!: LoadedAssets;
  private destroyed = false;

  private still = false;

  /**
   * PixiJS를 시작하고 매니페스트의 그림을 불러온다. 불러오지 못한 파일 목록을 돌려준다.
   * still을 주면 화면에 붙이지 않고 고정 크기로 만들어, renderStill()로 정지 그림만 뽑는다(검증실 갤러리).
   */
  async init(host: HTMLElement | null, opts: { still?: { width: number; height: number }; overrides?: AssetOverrides } = {}): Promise<string[]> {
    this.still = !!opts.still;
    if (opts.still) {
      await this.app.init({
        width: opts.still.width,
        height: opts.still.height,
        background: '#0b1f33',
        antialias: true,
        resolution: 1,
        autoStart: false,
        preserveDrawingBuffer: true,
      });
    } else {
      await this.app.init({
        resizeTo: host!,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
      });
    }
    if (this.destroyed) { this.app.destroy(true); return []; }
    this.assets = await loadTextures(applyOverrides(await loadManifest(), opts.overrides), this.app.renderer);
    if (this.destroyed) { this.app.destroy(true); return []; }
    if (host && !this.still) host.appendChild(this.app.canvas);
    this.app.stage.addChild(this.world);
    for (const layer of Object.values(this.layers)) this.world.addChild(layer);

    // 수조 영역 밖으로 그려지지 않게 자른다
    const clip = new Graphics().roundRect(0, 0, WORLD.width, WORLD.height, 18).fill({ color: 0xffffff });
    this.world.addChild(clip);
    this.world.mask = clip;

    this.layers.light.addChild(this.lightOverlay);
    this.moss.addChild(this.mossGraphics);
    this.moss.mask = this.mossMask;
    this.layers.glass.addChild(this.moss, this.mossMask);
    const frame = new Graphics().roundRect(1, 1, WORLD.width - 2, WORLD.height - 2, 18).stroke({ width: 3, color: 0xffffff, alpha: 0.35 });
    this.layers.glass.addChild(frame);

    this.layout();
    if (!this.still) {
      this.app.renderer.on('resize', () => this.layout());
      this.app.ticker.add((t) => this.tick(Math.min(0.05, t.deltaMS / 1000)));
    }
    this.ready = true;
    if (this.state) {
      const st = this.state;
      this.state = null;
      this.setState(st, this.opts);
    }
    return this.assets.missing;
  }

  private layout() {
    const { width, height } = this.app.renderer.screen;
    const s = Math.min(width / WORLD.width, height / WORLD.height);
    this.world.scale.set(s);
    this.world.position.set((width - WORLD.width * s) / 2, (height - WORLD.height * s) / 2);
  }

  private tex(key: string): Texture | undefined {
    return this.assets.textures.get(key);
  }

  setState(state: TankState, opts: RenderOptions) {
    const themeChanged = !this.state || this.state.themeId !== state.themeId;
    this.state = state;
    this.opts = opts;
    if (!this.ready) return;
    if (themeChanged) this.drawTheme(state.themeId);
    this.syncObjects(state.objects);
    this.drawLight(state);
    this.syncEffects(state.effects);
    if (!this.wipe) this.drawMoss(opts.mossStage);
  }

  /**
   * 정지 그림 한 장(data URL). init({ still })로 만든 렌더러에서만 쓴다.
   * 다른 어항의 오브젝트 id가 겹칠 수 있어 매번 오브젝트를 비우고 다시 그린다. 상태는 읽기만 한다.
   */
  renderStill(state: TankState, opts: Pick<RenderOptions, 'mossStage'>, type: 'image/jpeg' | 'image/png' = 'image/jpeg'): string {
    if (!this.ready || !this.still) throw new Error('still_renderer_not_ready');
    for (const f of this.fish.values()) f.destroy();
    this.fish.clear();
    for (const v of this.statics.values()) v.sprite.destroy();
    this.statics.clear();
    this.setState(state, { mossStage: opts.mossStage, reducedMotion: true });
    for (const f of this.fish.values()) f.settle(state);
    const fishBoxes = [...this.fish.values()].map((f) => f.bounds());
    for (const v of this.statics.values()) {
      v.scaleTween.finish();
      v.alphaTween.finish();
      v.sprite.scale.set(v.scaleTween.value);
      v.sprite.skew.x = 0;
      v.fade = this.frontFadeTarget(v, fishBoxes);
      v.sprite.alpha = v.fade;
    }
    for (const sp of this.fxSprites.values()) sp.alpha = 0.8;
    this.app.renderer.render(this.app.stage);
    return this.app.canvas.toDataURL(type, 0.86);
  }

  /** 앞쪽 수초 뒤로 물고기가 지나가면 옅게(이슈 #6). 나머지는 항상 1 */
  private frontFadeTarget(v: StaticView, fishBoxes: Box[]): number {
    if (v.obj.kind !== 'plant' || v.obj.layer !== 'front') return 1;
    const s = v.sprite;
    const w = Math.abs(s.width);
    const h = Math.abs(s.height);
    const box: Box = { x0: s.x - w / 2, x1: s.x + w / 2, y0: s.y - h, y1: s.y };
    return fishBoxes.some((f) => overlaps(f, box)) ? DISPLAY.frontPlantFadeAlpha : 1;
  }

  /** 복귀 청소 연출(S10-1): 이끼를 왼쪽에서 오른쪽으로 닦아낸다. 약 1.6초. */
  playCleaning() {
    if (!this.ready || this.shownMossStage === 0) return;
    const bar = new Graphics().rect(-40, 0, 40, WORLD.height).fill({ color: 0xffffff, alpha: 0.35 });
    this.layers.glass.addChild(bar);
    this.wipe = { t: 0, bar };
  }

  private drawTheme(themeId: string) {
    this.layers.background.removeChildren();
    const bg = this.tex(`theme:${themeId}:background`);
    if (bg) {
      const s = new Sprite(bg);
      s.width = WORLD.width;
      s.height = WORLD.height;
      this.layers.background.addChild(s);
    }
    const floor = this.tex(`theme:${themeId}:floor`);
    if (floor) {
      const f = new Sprite(floor);
      f.width = WORLD.width;
      f.height = 140;
      f.y = WORLD.height - 140;
      this.layers.background.addChild(f);
    }
  }

  private syncObjects(objects: PlacedObject[]) {
    const ids = new Set(objects.map((o) => o.id));
    for (const [id, f] of this.fish) if (!ids.has(id)) { f.destroy(); this.fish.delete(id); }
    for (const [id, v] of this.statics) if (!ids.has(id)) { v.sprite.destroy(); this.statics.delete(id); }

    const lanes = fishLaneLayout(objects, this.assets.manifest.elements);
    for (const obj of objects) {
      const spec = this.assets.manifest.elements[obj.el];
      const texture = this.tex(obj.el);
      if (!spec || !texture) continue;
      if (obj.kind === 'fish') {
        const existing = this.fish.get(obj.id);
        if (existing) existing.update(obj, lanes.get(obj.id));
        else {
          const f = new FishView(obj, texture, spec, lanes.get(obj.id));
          this.fish.set(obj.id, f);
          this.layers.mid.addChild(f.root);
        }
        continue;
      }
      const v = this.statics.get(obj.id);
      const base = spec.displayHeight ? spec.displayHeight / texture.height : (spec.displayWidth ?? 100) / texture.width;
      if (v) {
        if (v.obj.scale !== obj.scale) v.scaleTween = new Tween(v.scaleTween.value, base * displayScale(obj), 1.0);
        v.sprite.tint = tintFor(obj.tint);
        v.obj = obj;
        continue;
      }
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5, 1);
      sprite.position.set(obj.x, obj.y);
      sprite.tint = tintFor(obj.tint);
      sprite.alpha = 0;
      const layer = obj.layer === 'front' ? this.layers.front : obj.layer === 'back' ? this.layers.back : this.layers.floor;
      layer.addChild(sprite);
      // 같은 층 안에서는 아래쪽(y가 큰) 것이 앞에 오게
      layer.children.sort((a, b) => a.y - b.y);
      this.statics.set(obj.id, {
        obj, sprite, baseScale: base, fade: 1,
        scaleTween: new Tween(base * displayScale(obj) * 0.6, base * displayScale(obj), 1.2),
        alphaTween: new Tween(0, 1, 1.2),
        swayPhase: mulberry32(seedFromString(obj.id))() * Math.PI * 2,
      });
    }
  }

  private drawLight(state: TankState) {
    const t = state.light.temp;
    this.lightOverlay.clear();
    if (Math.abs(t) < 0.01) return;
    this.lightOverlay.rect(0, 0, WORLD.width, WORLD.height).fill({ color: t > 0 ? 0xf59e0b : 0x38bdf8, alpha: Math.min(0.28, Math.abs(t) * 0.3) });
  }

  private syncEffects(effects: string[]) {
    for (const [id, s] of this.fxSprites) if (!effects.includes(id)) { s.destroy(); this.fxSprites.delete(id); }
    for (const id of effects) {
      if (this.fxSprites.has(id)) continue;
      const tex = this.tex(id);
      if (!tex) continue;
      const s = new Sprite(tex);
      if (id === 'fx.lightray') {
        s.anchor.set(0.5, 0);
        s.position.set(380, 0);
        s.width = 360;
        s.height = WORLD.height;
      } else {
        s.anchor.set(0.5);
        s.position.set(840, 80);
        s.width = s.height = 64;
      }
      this.layers.fx.addChild(s);
      this.fxSprites.set(id, s);
    }
  }

  private drawMoss(stage: number) {
    this.shownMossStage = stage;
    const g = this.mossGraphics;
    g.clear();
    this.mossMask.clear().rect(0, 0, WORLD.width, WORLD.height).fill({ color: 0xffffff });
    if (stage <= 0) return;
    const rng = mulberry32(1234);
    const count = [0, 12, 26, 44][stage] ?? 0;
    for (let i = 0; i < count; i++) {
      // 가장자리 위주로. 안쪽 생태계는 또렷하게 보이도록 가운데는 비운다
      const side = Math.floor(rng() * 4);
      const along = rng();
      const depth = rng() * (30 + stage * 18);
      const x = side === 0 ? along * WORLD.width : side === 1 ? WORLD.width - depth : side === 2 ? along * WORLD.width : depth;
      const y = side === 0 ? depth : side === 1 ? along * WORLD.height : side === 2 ? WORLD.height - depth : along * WORLD.height;
      g.circle(x, y, 18 + rng() * (24 + stage * 10)).fill({ color: 0x84a98c, alpha: 0.28 + rng() * 0.25 });
    }
    if (stage >= 3) g.rect(0, 0, WORLD.width, WORLD.height).fill({ color: 0xe7e5e4, alpha: 0.12 });
  }

  private tick(dt: number) {
    if (!this.state) return;
    this.time += dt;
    const rm = this.opts.reducedMotion;
    for (const f of this.fish.values()) f.tick(dt, this.state, rm);
    const fishBoxes = [...this.fish.values()].map((f) => f.bounds());
    for (const v of this.statics.values()) {
      v.scaleTween.step(dt);
      v.alphaTween.step(dt);
      const target = this.frontFadeTarget(v, fishBoxes);
      v.fade += (target - v.fade) * Math.min(1, dt * 4);
      v.sprite.alpha = v.alphaTween.value * v.fade;
      v.sprite.scale.set(v.scaleTween.value);
      const sway = this.assets.manifest.elements[v.obj.el]?.sway;
      v.sprite.skew.x = sway && !rm ? sway.amplitude * Math.sin(this.time * sway.frequency * Math.PI * 2 + v.swayPhase) : 0;
    }
    for (const [id, s] of this.fxSprites) {
      s.alpha = rm ? 0.8 : id === 'fx.lightray' ? 0.55 + 0.25 * Math.sin(this.time * 0.6) : 0.7 + 0.3 * Math.sin(this.time * 1.8);
    }
    if (!rm) this.tickBubbles(dt);
    if (this.wipe) this.tickWipe(dt);
  }

  private tickBubbles(dt: number) {
    const energy = this.state?.behavior.speed ?? 1;
    const rate = 0.8 + Math.max(0, energy - 1) * 3; // 활발할수록 기포가 많다
    this.bubbleTimer -= dt;
    const tex = this.tex('bubble');
    if (tex && this.bubbleTimer <= 0 && this.bubbles.length < 24) {
      this.bubbleTimer = 1 / rate;
      const s = new Sprite(tex);
      s.anchor.set(0.5);
      const size = 6 + Math.random() * 10;
      s.width = s.height = size;
      s.position.set(80 + Math.random() * 840, WORLD.height - 70);
      this.layers.fx.addChild(s);
      this.bubbles.push({ s, vy: 45 + Math.random() * 35, wobble: 4 + Math.random() * 6, phase: Math.random() * 6 });
    }
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i]!;
      b.phase += dt * 3;
      b.s.y -= b.vy * dt;
      b.s.x += Math.sin(b.phase) * b.wobble * dt;
      b.s.alpha = Math.min(1, b.s.y / 120);
      if (b.s.y < 10) {
        b.s.destroy();
        this.bubbles.splice(i, 1);
      }
    }
  }

  private tickWipe(dt: number) {
    const w = this.wipe!;
    w.t += dt / 1.6;
    const x = Math.min(1, w.t) * (WORLD.width + 40);
    w.bar.x = x;
    this.mossMask.clear().rect(x, 0, WORLD.width - x + 40, WORLD.height).fill({ color: 0xffffff });
    if (w.t >= 1) {
      w.bar.destroy();
      this.wipe = null;
      this.drawMoss(this.opts.mossStage);
    }
  }

  destroy() {
    this.destroyed = true;
    const wasReady = this.ready;
    this.ready = false;
    if (wasReady) this.app.destroy(true, { children: true });
  }
}
