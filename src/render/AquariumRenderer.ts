// 엄격한 보안 정책(CSP)에서 eval 없이 셰이더 코드를 만들도록 PixiJS 대체 구현을 켠다(호스팅 환경 호환).
import 'pixi.js/unsafe-eval';
import { Application, ColorMatrixFilter, Container, Graphics, Rectangle, Sprite, UPDATE_PRIORITY, type Texture } from 'pixi.js';
import { lightGrade } from './lighting';
import { fadeTexture, glowTexture, makeLightRays, makeStar, moteTexture, type FxView } from './proceduralFx';
import { atmosphere, backgroundGrade, hasBackgroundGrade, RENDER_STYLE, type RenderStyle } from './atmosphere';
import { QUALITY, qualityResolution, type RenderQuality } from './quality';
import { FrameRecorder } from '../perf/frameStats';

/** 코드로 그리는 효과 목록(명시적 등록). 새 효과는 여기에 추가한다 */
const PROCEDURAL_FX: Record<string, () => FxView> = {
  'fx.lightray': makeLightRays,
  'fx.stars-bright': makeStar,
};
const warnedFx = new Set<string>();
import { WORLD } from '../engine/config';
import { mulberry32, seedFromString } from '../engine/random';
import type { PlacedObject, TankState } from '../engine/types';
import { applyOverrides, loadManifest, loadTextures, type AssetOverrides, type LoadedAssets } from '../assets/manifest';
import { FishView } from './FishView';
import { TraceView } from './TraceView';
import { School } from './school';
import type { ElementAsset } from '../assets/manifest';
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
  /** 최근 감정 이력의 흔들림(moodSpreadOf). 분위기 렌더링에만 쓰고 엔진에는 영향 없음. 없으면 0 */
  moodSpread?: number;
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
  /** 0.3.0 감정 흔적 중 물속에 떠 있는 것(별빛 해파리): 기준 높이와 오르내림 위상 */
  float?: { baseY: number; phase: number };
}

/**
 * 0.3.0 감정 흔적의 화면 배치(렌더러 전용, 엔진 좌표와 별개).
 * 엔진은 흔적을 바닥 두 줄(먼 줄·앞줄)에 놓지만, 물고기·해파리 상징은 물속에서 움직이게 그린다.
 */
const EMOTION_SWIM = {
  /** 신남: 같은 물고기 그림으로 무리(단계 1→3: 3→5마리). 대열은 render/school.ts */
  school: { el: 'emotion.fish-school', laneY: 330 },
  /** 외로움: 혼자, 아래쪽에서 천천히 */
  lonely: { el: 'emotion.lantern-fish', laneY: 425 },
  /** 평온: 물속에 떠서 천천히 오르내림 */
  float: { el: 'emotion.star-jelly', y: 260, range: 60, amp: 10, period: 7 },
  /** 먼 줄(back)은 작게 그려 깊이를 준다 */
  farScale: 0.8,
} as const;

interface Bubble { s: Sprite; vy: number; wobble: number; phase: number }

export class AquariumRenderer {
  private app = new Application();
  private world = new Container();
  /** 감정 조명 색 보정을 받는 장면(배경~빛). 유리·이끼(glass)는 밖에 두어 감정에 따라 이끼 색이 바뀌지 않게 한다 */
  private scene = new Container();
  private layers = {
    background: new Container(),
    /** 감정 분위기 물색·보조 빛(배경 위, 생물 뒤라 생물 색을 덮지 않음) */
    atmos: new Container(),
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
  /** 0.3.0 감정 흔적(그림이 없을 때 임시 도형) */
  private traces = new Map<string, TraceView>();
  /** 0.3.0 감정 흔적 중 헤엄치는 것(신남 무리·외로움 물고기). 무리는 여러 마리이고 0번이 이끈다 */
  private swimTraces = new Map<string, FishView[]>();
  private schools = new Map<string, School>();
  private bubbles: Bubble[] = [];
  private bubbleTimer = 0;
  private lightOverlay = new Graphics();
  private moss = new Container();
  private mossGraphics = new Graphics();
  private mossMask = new Graphics();
  private wipe: { t: number; bar: Graphics } | null = null;
  private fxViews = new Map<string, FxView>();
  /** 감정 조명 색 보정(덧칠 대신). legacyLighting이면 쓰지 않는다 */
  private grade = new ColorMatrixFilter();
  private glow: Sprite | null = null;
  private legacyLighting = false;
  private state: TankState | null = null;
  private opts: RenderOptions = { mossStage: 0, reducedMotion: false };
  private time = 0;
  private ready = false;
  private shownMossStage = 0;

  private assets!: LoadedAssets;
  private destroyed = false;

  private still = false;
  /** 렌더링 품질(모바일 성능 검증). 그리는 방식만 바꾸고 상태·개수는 바꾸지 않는다 */
  private quality: RenderQuality = 'normal';
  /** 렌더링 버전: v0(기존) / atmos-1(감정 분위기). 비교·평가용으로 바꿀 수 있다 */
  private renderStyle: RenderStyle = RENDER_STYLE;
  private atmosTop: Sprite | null = null;
  private atmosBottom: Sprite | null = null;
  private atmosWarm: Sprite | null = null;
  private atmosCool: Sprite | null = null;
  /** 감정 배경(atmos-2): 배경 그림 한 장. 감정 색감은 필터 결과를 텍스처로 한 번 구워(generateTexture) 바꿔 끼우므로 매 프레임 필터 비용이 없다 */
  private bgSprite: Sprite | null = null;
  private bgRaw: Texture | null = null;
  private bgGraded: Texture | null = null;
  private bgGrade = new ColorMatrixFilter();
  private bgGradeKey = '';
  /** 기억 보기: 요소를 누르면 그 요소 id를 알려 준다. 없으면 누르기 판정을 아예 켜지 않는다 */
  private tapHandler: ((objectId: string) => void) | null = null;
  /** 변화 큼일 때 따뜻한/차가운 보조 빛이 번갈아 오가는 움직임(실시간 화면만, 정지 그림·움직임 줄이기에선 멈춤) */
  private glowBase = { warm: 0, cool: 0, swing: 0 };
  private motes: Array<{ s: Sprite; warm: boolean; vx: number; vy: number; phase: number; base: number }> = [];
  private moteTarget = { count: 0, warmShare: 0.5, warmColor: 0xffffff, coolColor: 0xffffff, speed: 1 };
  /** 어항 FPS: PixiJS가 실제로 화면을 그린 프레임 시각(그리기 뒤 UTILITY 우선순위에서 기록) */
  private renderFrames = new FrameRecorder();

  /**
   * PixiJS를 시작하고 매니페스트의 그림을 불러온다. 불러오지 못한 파일 목록을 돌려준다.
   * still을 주면 화면에 붙이지 않고 고정 크기로 만들어, renderStill()로 정지 그림만 뽑는다(검증실 갤러리).
   */
  async init(host: HTMLElement | null, opts: { still?: { width: number; height: number }; overrides?: AssetOverrides; legacyLighting?: boolean; quality?: RenderQuality; renderStyle?: RenderStyle } = {}): Promise<string[]> {
    this.still = !!opts.still;
    this.renderStyle = opts.renderStyle ?? this.renderStyle;
    this.legacyLighting = !!opts.legacyLighting;
    this.quality = opts.quality ?? this.quality;
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
        resolution: qualityResolution(this.quality, window.devicePixelRatio || 1),
      });
    }
    if (this.destroyed) { this.app.destroy(true); return []; }
    this.assets = await loadTextures(applyOverrides(await loadManifest(), opts.overrides), this.app.renderer);
    if (this.destroyed) { this.app.destroy(true); return []; }
    if (host && !this.still) host.appendChild(this.app.canvas);
    this.app.stage.addChild(this.world);
    this.world.addChild(this.scene);
    for (const [name, layer] of Object.entries(this.layers)) (name === 'glass' ? this.world : this.scene).addChild(layer);

    // 수조 영역 밖으로 그려지지 않게 자른다
    const clip = new Graphics().roundRect(0, 0, WORLD.width, WORLD.height, 18).fill({ color: 0xffffff });
    this.world.addChild(clip);
    this.world.mask = clip;

    this.layers.light.addChild(this.lightOverlay);
    this.buildAtmosphere();
    if (!this.legacyLighting) {
      // 왼쪽 위(배경의 수면 빛 방향)에서 퍼지는 가산 빛. 색은 감정 온도에 따라 tint
      this.glow = new Sprite(glowTexture());
      this.glow.anchor.set(0.5);
      this.glow.position.set(170, -40);
      this.glow.width = 1300;
      this.glow.height = 1000;
      this.glow.blendMode = 'add';
      this.glow.alpha = 0;
      this.layers.light.addChild(this.glow);
      this.applyQualityEffects();
    }
    this.moss.addChild(this.mossGraphics);
    this.moss.mask = this.mossMask;
    this.layers.glass.addChild(this.moss, this.mossMask);
    const frame = new Graphics().roundRect(1, 1, WORLD.width - 2, WORLD.height - 2, 18).stroke({ width: 3, color: 0xffffff, alpha: 0.35 });
    this.layers.glass.addChild(frame);

    this.layout();
    if (!this.still) {
      this.app.renderer.on('resize', () => this.layout());
      this.app.ticker.add((t) => this.tick(Math.min(0.05, t.deltaMS / 1000)));
      // Application의 그리기(render)는 LOW 우선순위. UTILITY는 그 뒤에 돌아서, 실제로 그린 프레임만 기록된다
      this.app.ticker.add(() => this.renderFrames.mark(performance.now()), undefined, UPDATE_PRIORITY.UTILITY);
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

  /** 일반 ↔ 저사양을 같은 어항에서 바로 바꾼다. 해상도·색 보정·가산 빛·기포·반짝임만 바뀐다 */
  setQuality(q: RenderQuality) {
    if (q === this.quality) return;
    this.quality = q;
    if (!this.ready || this.still) return;
    this.app.renderer.resolution = qualityResolution(q, window.devicePixelRatio || 1);
    this.layout();
    this.applyQualityEffects();
    if (this.state) this.drawLight(this.state);
    const max = QUALITY[q].maxBubbles;
    while (this.bubbles.length > max) this.bubbles.shift()!.s.destroy();
    if (this.state) this.drawAtmosphere(this.state);
  }

  private applyQualityEffects() {
    if (this.legacyLighting) return;
    const spec = QUALITY[this.quality];
    this.scene.filters = spec.colorGrade ? [this.grade] : [];
    if (this.glow) this.glow.visible = spec.glow;
  }

  /** 렌더링 버전을 바로 바꾼다(같은 어항 비교용). 엔진 상태·생물 수는 그대로 */
  setRenderStyle(style: RenderStyle) {
    if (style === this.renderStyle) return;
    this.renderStyle = style;
    if (this.ready && this.state) this.drawAtmosphere(this.state);
  }

  private buildAtmosphere() {
    const fade = fadeTexture();
    const glow = glowTexture();
    const top = new Sprite(fade);
    top.width = WORLD.width;
    top.height = WORLD.height * 0.7;
    const bottom = new Sprite(fade);
    bottom.width = WORLD.width;
    bottom.height = WORLD.height * 0.85;
    bottom.scale.y = -Math.abs(bottom.scale.y); // 아래에서 위로 옅어지게 뒤집기
    bottom.y = WORLD.height;
    // 뿌옇게 바래지 않게: 위층은 빛을 더하고(add), 아래층은 색을 걸러 깊이를 준다(multiply)
    top.blendMode = 'add';
    bottom.blendMode = 'multiply';
    const warm = new Sprite(glow);
    warm.anchor.set(0.5);
    warm.position.set(180, 40);
    warm.width = 1000;
    warm.height = 760;
    warm.blendMode = 'add';
    const cool = new Sprite(glow);
    cool.anchor.set(0.5);
    cool.position.set(WORLD.width - 160, WORLD.height - 90);
    cool.width = 1000;
    cool.height = 700;
    cool.blendMode = 'add';
    for (const sp of [top, bottom, warm, cool]) sp.alpha = 0;
    this.layers.atmos.addChild(top, bottom, warm, cool);
    this.atmosTop = top;
    this.atmosBottom = bottom;
    this.atmosWarm = warm;
    this.atmosCool = cool;
  }

  /**
   * 감정 배경 색감(atmos-2만). 저사양에서도 그대로 둔다: 필터 결과를 그림 크기 텍스처로 한 번 구워(generateTexture)
   * 배경 스프라이트에 바꿔 끼우므로, 감정이 바뀔 때만 한 번 그리고 매 프레임 비용은 없다.
   */
  private applyBackgroundGrade(state: TankState) {
    const on = hasBackgroundGrade(this.renderStyle);
    const g = on ? backgroundGrade({ temp: state.light.temp, energy: state.light.energy, spread: this.opts.moodSpread ?? 0 }) : null;
    const key = g && g.strength > 0 ? g.matrix.map((v) => v.toFixed(4)).join(',') : 'off';
    if (key === this.bgGradeKey) return;
    this.bgGradeKey = key;
    const sprite = this.bgSprite;
    const raw = this.bgRaw;
    if (!sprite || !raw) return;
    const old = this.bgGraded;
    this.bgGraded = null;
    if (g && g.strength > 0) {
      this.bgGrade.matrix = g.matrix as unknown as ColorMatrixFilter['matrix'];
      const src = new Sprite(raw);
      src.filters = [this.bgGrade];
      this.bgGraded = this.app.renderer.generateTexture({ target: src, frame: new Rectangle(0, 0, raw.width, raw.height), resolution: 1 });
      src.destroy();
      sprite.texture = this.bgGraded;
    } else {
      sprite.texture = raw;
    }
    sprite.width = WORLD.width;
    sprite.height = WORLD.height;
    old?.destroy(true);
  }

  /** 감정 분위기: 생물 뒤 물색 덧칠 + 보조 빛 + 입자 목표. v0이면 끈다 */
  private drawAtmosphere(state: TankState) {
    const on = this.renderStyle !== 'v0';
    this.layers.atmos.visible = on;
    this.applyBackgroundGrade(state);
    if (!on) {
      this.moteTarget.count = 0;
      for (const m of this.motes) m.s.destroy();
      this.motes = [];
      return;
    }
    const a = atmosphere({ temp: state.light.temp, energy: state.light.energy, spread: this.opts.moodSpread ?? 0 });
    const set = (sp: Sprite | null, t: { color: number; alpha: number }) => { if (sp) { sp.tint = t.color; sp.alpha = t.alpha; } };
    set(this.atmosTop, a.waterTop);
    set(this.atmosBottom, a.waterBottom);
    set(this.atmosWarm, a.glowWarm);
    set(this.atmosCool, a.glowCool);
    this.glowBase = { warm: a.glowWarm.alpha, cool: a.glowCool.alpha, swing: hasBackgroundGrade(this.renderStyle) ? a.contrast : 0 };
    this.moteTarget = {
      count: Math.round(QUALITY[this.quality].maxParticles * a.particles.density),
      warmShare: a.particles.warmShare,
      warmColor: a.particles.warmColor,
      coolColor: a.particles.coolColor,
      speed: a.particles.speed,
    };
    // 목표보다 많으면 줄이고, 색 비율이 바뀌었으면 기존 입자 색을 다시 정한다
    while (this.motes.length > this.moteTarget.count) this.motes.pop()!.s.destroy();
    this.recolorMotes();
  }

  private recolorMotes() {
    const t = this.moteTarget;
    const warmN = Math.round(this.motes.length * t.warmShare);
    this.motes.forEach((m, i) => {
      m.warm = i < warmN;
      m.s.tint = m.warm ? t.warmColor : t.coolColor;
      m.vy = (m.warm ? -1 : 1) * Math.abs(m.vy);
    });
  }

  /** 입자 하나(위치는 r1·r2 0~1로). 따뜻한 입자는 위로, 차가운 입자는 아래로 천천히 */
  private spawnMote(r1: number, r2: number, r3: number) {
    const s = new Sprite(moteTexture());
    s.anchor.set(0.5);
    const size = 5 + r3 * 7;
    s.width = s.height = size;
    s.position.set(40 + r1 * (WORLD.width - 80), 40 + r2 * (WORLD.height - 180));
    s.blendMode = 'add';
    const base = 0.35 + r3 * 0.35;
    s.alpha = base;
    this.layers.fx.addChild(s);
    const m = { s, warm: true, vx: (r2 - 0.5) * 6, vy: 6 + r1 * 10, phase: r3 * 6.28, base };
    this.motes.push(m);
    return m;
  }

  private tickMotes(dt: number, reducedMotion: boolean) {
    const t = this.moteTarget;
    if (this.motes.length < t.count) {
      this.spawnMote(Math.random(), Math.random(), Math.random());
      this.recolorMotes();
    }
    if (reducedMotion) return;
    for (const m of this.motes) {
      m.phase += dt * 1.3;
      m.s.x += (m.vx + Math.sin(m.phase) * 4) * dt * t.speed;
      m.s.y += m.vy * dt * t.speed;
      m.s.alpha = m.base * (0.7 + 0.3 * Math.sin(m.phase * 0.8));
      if (m.s.y < 30) m.s.y = WORLD.height - 150;
      if (m.s.y > WORLD.height - 140) m.s.y = 40;
      if (m.s.x < 20) m.s.x = WORLD.width - 20;
      if (m.s.x > WORLD.width - 20) m.s.x = 20;
    }
  }

  /** 정지 그림용: 입자를 정해진 자리에 놓는다(같은 어항이면 같은 그림) */
  private layoutStillMotes() {
    for (const m of this.motes) m.s.destroy();
    this.motes = [];
    const h = (i: number, k: number) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
    for (let i = 0; i < this.moteTarget.count; i++) this.spawnMote(h(i, 1), h(i, 2), h(i, 3));
    this.recolorMotes();
  }

  /** 성능 측정용: 어항이 실제로 그린 프레임 기록 */
  frames(): FrameRecorder {
    return this.renderFrames;
  }

  /**
   * 진단용(검증 화면 전용): 어항 갱신을 제한하거나 멈춘다. 측정기가 어항 FPS를 제대로 잡는지 확인할 때 쓴다.
   * 0이면 제한 없음, 음수면 멈춤.
   */
  setFrameLimit(maxFps: number) {
    if (!this.ready || this.still) return;
    const t = this.app.ticker;
    if (maxFps < 0) { t.stop(); return; }
    t.maxFPS = maxFps;
    if (!t.started) { this.renderFrames.pause(); t.start(); }
  }

  /** 성능 측정용: 실제 렌더링 해상도·캔버스 크기와 화면에 그리고 있는 생물 수 */
  info() {
    const r = this.app.renderer;
    const c = this.app.canvas;
    const kinds = { fish: this.fish.size, plant: 0, rock: 0, symbol: 0, emotion: 0 };
    for (const v of this.statics.values()) if (v.obj.kind !== 'fish') kinds[v.obj.kind]++;
    kinds.emotion += this.traces.size + this.swimTraces.size + this.schools.size;
    return {
      quality: this.quality,
      dpr: window.devicePixelRatio || 1,
      resolution: r.resolution,
      canvasCss: [Math.round(r.screen.width), Math.round(r.screen.height)] as [number, number],
      canvasPx: [c.width, c.height] as [number, number],
      backend: r.name ?? (r.type === 1 ? 'webgl' : r.type === 2 ? 'webgpu' : 'canvas'),
      drawn: kinds,
      bubbles: this.bubbles.length,
      motes: this.motes.length,
      renderStyle: this.renderStyle,
    };
  }

  setState(state: TankState, opts: RenderOptions) {
    const themeChanged = !this.state || this.state.themeId !== state.themeId;
    this.state = state;
    this.opts = opts;
    if (!this.ready) return;
    if (themeChanged) this.drawTheme(state.themeId);
    this.syncObjects(state.objects);
    this.drawLight(state);
    this.drawAtmosphere(state);
    this.syncEffects(state.effects);
    if (!this.wipe) this.drawMoss(opts.mossStage);
  }

  /**
   * 정지 그림 한 장(data URL). init({ still })로 만든 렌더러에서만 쓴다.
   * 다른 어항의 오브젝트 id가 겹칠 수 있어 매번 오브젝트를 비우고 다시 그린다. 상태는 읽기만 한다.
   */
  renderStill(state: TankState, opts: Pick<RenderOptions, 'mossStage' | 'moodSpread'>, type: 'image/jpeg' | 'image/png' = 'image/jpeg'): string {
    if (!this.ready || !this.still) throw new Error('still_renderer_not_ready');
    for (const f of this.fish.values()) f.destroy();
    this.fish.clear();
    for (const v of this.statics.values()) v.sprite.destroy();
    this.statics.clear();
    for (const v of this.traces.values()) v.destroy();
    this.traces.clear();
    for (const list of this.swimTraces.values()) for (const f of list) f.destroy();
    this.swimTraces.clear();
    for (const sc of this.schools.values()) sc.destroy();
    this.schools.clear();
    this.setState(state, { mossStage: opts.mossStage, reducedMotion: true, moodSpread: opts.moodSpread });
    this.layoutStillMotes();
    for (const f of this.fish.values()) f.settle(state);
    for (const list of this.swimTraces.values()) for (const f of list) f.settle(state);
    for (const sc of this.schools.values()) sc.settle(state);
    const fishBoxes = [...this.fish.values(), ...[...this.swimTraces.values()].flat(), ...[...this.schools.values()].flatMap((sc) => sc.members)].map((f) => f.bounds());
    for (const v of this.statics.values()) {
      v.scaleTween.finish();
      v.alphaTween.finish();
      v.sprite.scale.set(v.scaleTween.value);
      v.sprite.skew.x = 0;
      v.fade = this.frontFadeTarget(v, fishBoxes);
      v.sprite.alpha = v.fade;
    }
    for (const fx of this.fxViews.values()) fx.still();
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
    this.bgSprite = null;
    this.bgRaw = null;
    const bg = this.tex(`theme:${themeId}:background`);
    if (bg) {
      const s = new Sprite(bg);
      s.width = WORLD.width;
      s.height = WORLD.height;
      this.layers.background.addChild(s);
      this.bgSprite = s;
      this.bgRaw = bg;
    }
    this.bgGradeKey = ''; // 그림이 바뀌었으니 색감 텍스처를 다시 만든다
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
    for (const [id, v] of this.traces) if (!ids.has(id)) { v.destroy(); this.traces.delete(id); }
    for (const [id, list] of this.swimTraces) if (!ids.has(id)) { for (const f of list) f.destroy(); this.swimTraces.delete(id); }
    for (const [id, sc] of this.schools) if (!ids.has(id)) { sc.destroy(); this.schools.delete(id); }

    const lanes = fishLaneLayout(objects, this.assets.manifest.elements);
    for (const obj of objects) {
      if (obj.kind === 'emotion' && this.syncEmotionArt(obj)) continue;
      if (obj.kind === 'emotion') {
        const ex = this.traces.get(obj.id);
        if (ex) { ex.update(obj); continue; }
        const v = new TraceView(obj);
        this.makeTappable(v.root, obj.id);
        const layer = obj.layer === 'back' ? this.layers.back : this.layers.floor;
        layer.addChild(v.root);
        layer.children.sort((a, b) => a.y - b.y);
        this.traces.set(obj.id, v);
        continue;
      }
      const spec = this.assets.manifest.elements[obj.el];
      const texture = this.tex(obj.el);
      if (!spec || !texture) continue;
      if (obj.kind === 'fish') {
        const existing = this.fish.get(obj.id);
        if (existing) existing.update(obj, lanes.get(obj.id));
        else {
          const f = new FishView(obj, texture, spec, lanes.get(obj.id));
          // 물고기는 몸이 가늘어 누르기 어려우니 그림 상자 전체를 누를 수 있게
          f.root.hitArea = new Rectangle(-texture.width / 2, -texture.height / 2, texture.width, texture.height);
          this.makeTappable(f.root, obj.id);
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
      this.makeTappable(sprite, obj.id);
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

  /**
   * 0.3.0 감정 흔적을 그림으로 그린다. 그림이 없으면 false(임시 도형 TraceView로).
   * - 신남: 같은 id의 물고기 여러 마리(같은 움직임으로 무리), 단계마다 한 마리씩 늘어남
   * - 외로움: 물고기 한 마리, 아래쪽 레인
   * - 평온: 물속에 떠서 오르내림
   * - 나머지: 바닥 장식. 먼 줄은 작게. 자란 단계는 크기(엔진 scale 1 → 1.3)로
   * 감정 흔적은 물빛 보정(tint)을 하지 않는다(감정 색을 그대로 보이게).
   */
  private syncEmotionArt(obj: PlacedObject): boolean {
    const spec = this.assets.manifest.elements[obj.el];
    const texture = this.tex(obj.el);
    if (!spec || !texture) return false;
    const far = obj.layer === 'back' ? EMOTION_SWIM.farScale : 1;
    if (obj.el === EMOTION_SWIM.lonely.el) {
      const list = this.swimTraces.get(obj.id);
      if (list) list[0]!.update({ ...obj, kind: 'fish', tint: 0 }, EMOTION_SWIM.lonely.laneY);
      else this.swimTraces.set(obj.id, [this.addSwimmer(obj, texture, spec, EMOTION_SWIM.lonely.laneY, obj.id)]);
      return true;
    }
    if (obj.el === EMOTION_SWIM.school.el) {
      // 무리: 0번이 이끌고 나머지는 따른다. 성장·대열 폭 처리는 render/school.ts의 School
      let school = this.schools.get(obj.id);
      if (!school) {
        school = new School((o, laneY, extra) => this.addSwimmer(o, texture, spec, laneY, obj.id, extra), EMOTION_SWIM.school.laneY);
        this.schools.set(obj.id, school);
      }
      school.sync(obj, this.opts.reducedMotion);
      return true;
    }
    const base = ((spec.displayHeight ? spec.displayHeight / texture.height : (spec.displayWidth ?? 100) / texture.width)) * far;
    const v = this.statics.get(obj.id);
    if (v) {
      if (v.obj.scale !== obj.scale) v.scaleTween = new Tween(v.scaleTween.value, base * obj.scale, 1.0);
      v.obj = obj;
      return true;
    }
    const sprite = new Sprite(texture);
    const floating = obj.el === EMOTION_SWIM.float.el;
    sprite.alpha = 0;
    this.makeTappable(sprite, obj.id);
    let layer: Container;
    let float: StaticView['float'];
    if (floating) {
      // 물속에 떠 있음: 가운데 기준, 높이는 흔적마다 조금씩 다르게
      sprite.anchor.set(0.5, 0.5);
      const r = mulberry32(seedFromString(obj.id + ':float'));
      const baseY = EMOTION_SWIM.float.y + (r() * 2 - 1) * EMOTION_SWIM.float.range;
      sprite.position.set(obj.x, baseY);
      float = { baseY, phase: r() * Math.PI * 2 };
      layer = this.layers.mid;
    } else {
      sprite.anchor.set(0.5, 1);
      sprite.position.set(obj.x, obj.y);
      layer = obj.layer === 'back' ? this.layers.back : this.layers.floor;
    }
    layer.addChild(sprite);
    if (!floating) layer.children.sort((a, b) => a.y - b.y);
    this.statics.set(obj.id, {
      obj, sprite, baseScale: base, fade: 1,
      scaleTween: new Tween(base * obj.scale * 0.6, base * obj.scale, 1.2),
      alphaTween: new Tween(0, 1, 1.2),
      swayPhase: mulberry32(seedFromString(obj.id))() * Math.PI * 2,
      ...(float ? { float } : {}),
    });
    return true;
  }

  /** 헤엄치는 감정 흔적 하나(물고기 그림). 누르면 tapId(논리 오브젝트)의 기억 카드 */
  private addSwimmer(obj: PlacedObject, texture: Texture, spec: ElementAsset, laneY: number, tapId: string, extraHalfWidth = 0): FishView {
    const f = new FishView({ ...obj, kind: 'fish', tint: 0 }, texture, spec, laneY, { extraHalfWidth });
    f.root.hitArea = new Rectangle(-texture.width / 2, -texture.height / 2, texture.width, texture.height);
    this.makeTappable(f.root, tapId);
    this.layers.mid.addChild(f.root);
    return f;
  }

  /** 기억 보기: 요소를 눌렀을 때 알려 줄 함수. null이면 끈다(검증실·정지 그림은 끈 채로 둔다) */
  setObjectTapHandler(fn: ((objectId: string) => void) | null) {
    this.tapHandler = fn;
    for (const [id, f] of this.fish) this.makeTappable(f.root, id);
    for (const [id, v] of this.statics) this.makeTappable(v.sprite, id);
    for (const [id, v] of this.traces) this.makeTappable(v.root, id);
    for (const [id, list] of this.swimTraces) for (const f of list) this.makeTappable(f.root, id);
    for (const [id, sc] of this.schools) for (const f of sc.members) this.makeTappable(f.root, id);
  }

  private makeTappable(d: Container, objectId: string) {
    d.removeAllListeners('pointertap');
    if (!this.tapHandler) {
      d.eventMode = 'none';
      return;
    }
    d.eventMode = 'static';
    d.cursor = 'pointer';
    d.on('pointertap', () => this.tapHandler?.(objectId));
  }

  private drawLight(state: TankState) {
    const t = state.light.temp;
    this.lightOverlay.clear();
    if (this.legacyLighting) {
      // 이전 방식(비교용): 수조 전체에 반투명 덧칠
      if (Math.abs(t) < 0.01) return;
      this.lightOverlay.rect(0, 0, WORLD.width, WORLD.height).fill({ color: t > 0 ? 0xf59e0b : 0x38bdf8, alpha: Math.min(0.28, Math.abs(t) * 0.3) });
      return;
    }
    if (!QUALITY[this.quality].colorGrade) {
      // 저사양: 색 보정 필터 대신 덧칠 한 장(감정 방향은 보이게, 비용은 작게)
      if (Math.abs(t) >= 0.01) this.lightOverlay.rect(0, 0, WORLD.width, WORLD.height).fill({ color: t > 0 ? 0xf59e0b : 0x38bdf8, alpha: Math.min(0.2, Math.abs(t) * 0.22) });
      return;
    }
    const g = lightGrade(state.light);
    this.grade.matrix = g.matrix as unknown as ColorMatrixFilter['matrix'];
    if (this.glow) {
      this.glow.tint = g.glow.color;
      this.glow.alpha = g.glow.alpha;
    }
  }

  /** 빛줄기·밝은 별은 코드로 그린다(배경 빛줄기와 방향을 맞추고, 그림 파일 없이 가산 빛으로). 이전 방식이면 SVG 그림 */
  private syncEffects(effects: string[]) {
    for (const [id, fx] of this.fxViews) if (!effects.includes(id)) { fx.root.destroy({ children: true }); this.fxViews.delete(id); }
    for (const id of effects) {
      if (this.fxViews.has(id)) continue;
      let fx: FxView | null = null;
      if (!this.legacyLighting) {
        const make = PROCEDURAL_FX[id];
        if (!make) {
          // 모르는 효과는 엉뚱한 그림(별 등)으로 그리지 않고 건너뛴다
          if (!warnedFx.has(id)) { warnedFx.add(id); console.warn(`[irurium] 지원하지 않는 효과라 그리지 않아요: ${id}`); }
          continue;
        }
        fx = make();
      } else {
        const tex = this.tex(id);
        if (!tex) continue;
        const s = new Sprite(tex);
        const root = new Container();
        root.addChild(s);
        if (id === 'fx.lightray') { s.anchor.set(0.5, 0); s.position.set(380, 0); s.width = 360; s.height = WORLD.height; }
        else { s.anchor.set(0.5); s.position.set(840, 80); s.width = s.height = 64; }
        fx = {
          root,
          tick: (time, rm) => { s.alpha = rm ? 0.8 : id === 'fx.lightray' ? 0.55 + 0.25 * Math.sin(time * 0.6) : 0.7 + 0.3 * Math.sin(time * 1.8); },
          still: () => { s.alpha = 0.8; },
        };
      }
      this.layers.fx.addChild(fx.root);
      this.fxViews.set(id, fx);
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
    for (const list of this.swimTraces.values()) for (const f of list) f.tick(dt, this.state, rm);
    for (const sc of this.schools.values()) sc.tick(dt, this.state, rm);
    const fishBoxes = [...this.fish.values(), ...[...this.swimTraces.values()].flat(), ...[...this.schools.values()].flatMap((sc) => sc.members)].map((f) => f.bounds());
    for (const v of this.statics.values()) {
      v.scaleTween.step(dt);
      v.alphaTween.step(dt);
      const target = this.frontFadeTarget(v, fishBoxes);
      v.fade += (target - v.fade) * Math.min(1, dt * 4);
      v.sprite.alpha = v.alphaTween.value * v.fade;
      v.sprite.scale.set(v.scaleTween.value);
      const sway = this.assets.manifest.elements[v.obj.el]?.sway;
      v.sprite.skew.x = sway && !rm ? sway.amplitude * Math.sin(this.time * sway.frequency * Math.PI * 2 + v.swayPhase) : 0;
      if (v.float) v.sprite.y = v.float.baseY + (rm ? 0 : EMOTION_SWIM.float.amp * Math.sin((this.time / EMOTION_SWIM.float.period) * Math.PI * 2 + v.float.phase));
    }
    const calm = rm || !QUALITY[this.quality].shimmer;
    for (const fx of this.fxViews.values()) fx.tick(this.time, calm);
    if (!rm) this.tickBubbles(dt);
    this.tickMotes(dt, rm);
    this.tickSwingGlow(rm);
    if (this.wipe) this.tickWipe(dt);
  }

  /** 변화 큼: 따뜻한 빛과 차가운 빛이 10초 주기로 번갈아 세졌다 약해진다(감정이 오가는 느낌). 대비가 없으면 그대로 */
  private tickSwingGlow(reducedMotion: boolean) {
    const k = this.glowBase.swing;
    if (!this.atmosWarm || !this.atmosCool || k <= 0) return;
    const w = reducedMotion ? 0 : Math.sin((this.time / 10) * Math.PI * 2) * 0.45 * k;
    this.atmosWarm.alpha = this.glowBase.warm * (1 + w);
    this.atmosCool.alpha = this.glowBase.cool * (1 - w);
  }

  private tickBubbles(dt: number) {
    const energy = this.state?.behavior.speed ?? 1;
    const rate = 0.8 + Math.max(0, energy - 1) * 3; // 활발할수록 기포가 많다
    this.bubbleTimer -= dt;
    const tex = this.tex('bubble');
    if (tex && this.bubbleTimer <= 0 && this.bubbles.length < QUALITY[this.quality].maxBubbles) {
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
