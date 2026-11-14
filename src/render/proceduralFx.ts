import { Container, Sprite, Texture } from 'pixi.js';

/**
 * 코드로 그리는 빛 효과(그림 파일 없음). 세미 리얼 배경에 이미 수면 빛줄기가 그려져 있어서,
 * 효과 빛줄기는 같은 방향(왼쪽 위 → 오른쪽 아래)의 부드러운 가산 빛으로 겹쳐 "배경 빛이 더 밝아지는" 느낌으로 만든다.
 */

const cache = new Map<string, Texture>();

function canvasTexture(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): Texture {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = Texture.from(c);
  cache.set(key, t);
  return t;
}

/** 왼쪽 위에서 퍼지는 둥근 빛(흰색, tint로 색을 입힌다) */
export function glowTexture(): Texture {
  return canvasTexture('glow', 256, 256, (g) => {
    const r = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.45, 'rgba(255,255,255,0.45)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 256, 256);
  });
}

/** 빛줄기 한 가닥: 가운데가 밝고 양옆·아래로 사라짐 */
function rayTexture(): Texture {
  return canvasTexture('ray', 64, 512, (g) => {
    const img = g.createImageData(64, 512);
    for (let y = 0; y < 512; y++) {
      const fy = Math.pow(1 - y / 512, 1.4);
      for (let x = 0; x < 64; x++) {
        const dx = (x - 31.5) / 32;
        const a = Math.exp(-dx * dx * 4) * fy;
        const i = (y * 64 + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(a * 255);
      }
    }
    g.putImageData(img, 0, 0);
  });
}

/** 밝은 별: 둥근 빛 + 네 갈래 반짝임 */
function starTexture(): Texture {
  return canvasTexture('star', 128, 128, (g) => {
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,250,230,1)');
    r.addColorStop(0.18, 'rgba(255,240,200,0.75)');
    r.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
    g.globalCompositeOperation = 'lighter';
    for (const [w, h] of [[128, 3], [3, 128]] as const) {
      const lg = w > h ? g.createLinearGradient(0, 0, 128, 0) : g.createLinearGradient(0, 0, 0, 128);
      lg.addColorStop(0, 'rgba(255,255,255,0)');
      lg.addColorStop(0.5, 'rgba(255,255,255,0.9)');
      lg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = lg;
      g.fillRect(64 - w / 2, 64 - h / 2, w, h);
    }
  });
}

export interface FxView { root: Container; tick(time: number, reducedMotion: boolean): void; still(): void }

/** 빛줄기 효과: 배경 빛줄기 방향에 맞춘 4가닥, 천천히 일렁임 */
export function makeLightRays(): FxView {
  const root = new Container();
  const tex = rayTexture();
  const rays = [
    { x: 150, w: 70, a: 0.22, p: 0 },
    { x: 250, w: 110, a: 0.18, p: 1.7 },
    { x: 360, w: 60, a: 0.2, p: 3.1 },
    { x: 470, w: 90, a: 0.14, p: 4.4 },
  ].map((r) => {
    const s = new Sprite(tex);
    s.anchor.set(0.5, 0);
    s.position.set(r.x, -30);
    s.width = r.w;
    s.height = 640;
    s.rotation = -0.42; // 아래로 갈수록 오른쪽(배경 빛줄기 방향)
    s.blendMode = 'add';
    s.tint = 0xd8f0ff;
    root.addChild(s);
    return { s, ...r };
  });
  return {
    root,
    tick(time, rm) {
      for (const r of rays) r.s.alpha = rm ? r.a : r.a * (0.7 + 0.3 * Math.sin(time * 0.5 + r.p));
    },
    still() {
      for (const r of rays) r.s.alpha = r.a;
    },
  };
}

/** 밝은 별 효과 */
export function makeStar(): FxView {
  const root = new Container();
  const s = new Sprite(starTexture());
  s.anchor.set(0.5);
  s.position.set(840, 80);
  s.width = s.height = 96;
  s.blendMode = 'add';
  root.addChild(s);
  return {
    root,
    tick(time, rm) {
      s.alpha = rm ? 0.9 : 0.75 + 0.25 * Math.sin(time * 1.6);
      const k = rm ? 1 : 1 + 0.06 * Math.sin(time * 1.6);
      s.width = s.height = 96 * k;
    },
    still() {
      s.alpha = 0.9;
      s.width = s.height = 96;
    },
  };
}
