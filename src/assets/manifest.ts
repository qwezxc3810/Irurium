import { Assets, Graphics, Texture, type Renderer } from 'pixi.js';

/**
 * 그래픽 리소스 매니페스트(public/assets/manifest.json).
 * 엔진은 요소 id(예: 'fish.medaka')만 알고, 어떤 그림 파일을 쓸지는 이 매니페스트가 정한다.
 * 그림을 바꿀 때 코드를 고치지 않아도 되게 하는 것이 목적이다. 규격은 docs/ASSET_SPEC.md.
 */

export interface SwimSpec { amplitude: number; frequency: number }
export interface SwaySpec { amplitude: number; frequency: number }

export interface ElementAsset {
  src: string;
  /** 논리 좌표(1000×600)에서의 표시 폭. 물고기·수석에 쓴다. */
  displayWidth?: number;
  /** 논리 좌표에서의 표시 높이. 수초·상징에 쓴다. */
  displayHeight?: number;
  swim?: SwimSpec;
  sway?: SwaySpec;
}

export interface AssetManifest {
  version: number;
  themes: Record<string, { background: string; floor: string }>;
  elements: Record<string, ElementAsset>;
  fx: Record<string, string>;
}

export interface LoadedAssets {
  manifest: AssetManifest;
  textures: Map<string, Texture>;
  /** 불러오지 못한 파일. 화면에는 대체 그림이 나온다. */
  missing: string[];
}

export const ASSET_BASE = `${import.meta.env.BASE_URL}assets/`;

export async function loadManifest(base = ASSET_BASE): Promise<AssetManifest> {
  const res = await fetch(`${base}manifest.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`manifest_load_failed:${res.status}`);
  return (await res.json()) as AssetManifest;
}

/** 모든 그림을 불러온다. 실패한 그림은 대체 그림(실루엣)으로 바꿔 화면이 깨지지 않게 한다. */
export async function loadTextures(manifest: AssetManifest, renderer: Renderer, base = ASSET_BASE): Promise<LoadedAssets> {
  const entries: Array<[string, string]> = [];
  for (const [themeId, t] of Object.entries(manifest.themes)) {
    entries.push([`theme:${themeId}:background`, t.background], [`theme:${themeId}:floor`, t.floor]);
  }
  for (const [id, a] of Object.entries(manifest.elements)) entries.push([id, a.src]);
  for (const [id, src] of Object.entries(manifest.fx)) entries.push([id, src]);

  const textures = new Map<string, Texture>();
  const missing: string[] = [];
  await Promise.all(
    entries.map(async ([key, src]) => {
      try {
        // SVG는 2배 해상도로 래스터화해 휴대폰 화면에서도 선명하게 한다. PNG·WebP는 그대로.
        const isSvg = src.endsWith('.svg');
        const tex = await Assets.load<Texture>(isSvg ? { src: base + src, data: { resolution: 2 } } : base + src);
        textures.set(key, tex);
      } catch {
        missing.push(src);
        textures.set(key, fallbackTexture(renderer, key));
      }
    }),
  );
  return { manifest, textures, missing };
}

function fallbackTexture(renderer: Renderer, key: string): Texture {
  const g = new Graphics();
  if (key.startsWith('fish.')) g.ellipse(64, 32, 60, 26).fill({ color: 0x94a3b8 });
  else if (key.startsWith('plant.')) g.rect(28, 0, 8, 160).fill({ color: 0x4d7c0f });
  else if (key.startsWith('theme:')) g.rect(0, 0, 100, 60).fill({ color: 0x16324f });
  else g.circle(32, 32, 30).fill({ color: 0x78716c });
  return renderer.generateTexture(g);
}
