import type { PlacedObject, TankState } from '../engine/types';
import type { ElementAsset } from '../assets/manifest';

/**
 * 화면 표시 규칙(이슈 #6: 오래 자란 어항에서 수초가 물고기를 가림).
 * 엔진 상태(스냅샷)는 그대로 두고 "어떻게 보여 줄지"만 정한다. 그래서 ENGINE_VERSION과 기존 스냅샷에 영향이 없고,
 * 이미 자란 어항에도 바로 적용된다. 렌더러와 검증실 가림 지표가 같은 함수를 쓴다.
 */

export const DISPLAY = {
  /** 1배를 넘는 성장은 화면에서 이 비율만큼만 커진다(수초 1.5배 → 1.25배로 보임). 성장은 보이되 화면을 덮지 않게 */
  plantGrowthGain: 0.5,
  fishGrowthGain: 0.6,
  /** 앞쪽(front) 수초는 전경용으로 낮게: 원래 높이의 60% */
  frontPlantHeight: 0.6,
  /** 물고기가 앞쪽 수초 뒤를 지날 때 수초 투명도 */
  frontPlantFadeAlpha: 0.55,
  /** 엔진의 헤엄 레인(3개)을 화면에서 위아래로 흩는 칸 간격과 칸 수(-3~+3칸) */
  laneSpread: 22,
  laneSteps: 3,
  swimTop: 110,
  swimBottom: 440,
} as const;

/** 물고기 하나의 화면 높이(논리 좌표). 매니페스트에 size가 없으면 대략값 */
export function fishHeight(obj: Pick<PlacedObject, 'kind' | 'layer' | 'scale' | 'el'>, asset: ElementAsset | undefined): number {
  if (!asset?.size) return 50 * displayScale(obj);
  const [tw, th] = asset.size;
  return ((asset.displayWidth ?? 100) * displayScale(obj) * th) / tw;
}

const yOverlap = (a: number, ha: number, b: number, hb: number) => Math.max(0, Math.min(a + ha / 2, b + hb / 2) - Math.max(a - ha / 2, b - hb / 2));

/**
 * 물고기 헤엄 높이 배치(화면용). 엔진 레인은 170·290·400 세 개뿐이라 물고기가 많아지면 같은 높이에 몰려 겹친다.
 * 먼저 태어난 물고기부터 차례로, 엔진 레인에서 ±3칸(22px 간격) 안에서 이미 놓인 물고기와 세로로 가장 덜 겹치는 높이를 고른다.
 * 태어난 순서로 놓기 때문에 새 물고기가 생겨도 기존 물고기의 높이는 바뀌지 않는다(PR #8 리뷰: 불필요한 세로 이동 방지).
 * 물고기는 좌우로 헤엄치므로 세로 띠가 겹치지 않아야 실제로 덜 겹친다. 같은 상태면 언제나 같은 결과(결정적).
 */
export function fishLaneLayout(objects: PlacedObject[], assets: Record<string, ElementAsset>): Map<string, number> {
  const fish = objects
    .filter((o) => o.kind === 'fish')
    .map((o) => ({ o, h: fishHeight(o, assets[o.el]) }))
    .sort((a, b) => a.o.bornSeq - b.o.bornSeq || a.o.id.localeCompare(b.o.id));
  const placed: Array<{ y: number; h: number }> = [];
  const out = new Map<string, number>();
  for (const { o, h } of fish) {
    let best = o.y;
    let bestCost = Infinity;
    for (let k = 0; k <= DISPLAY.laneSteps; k++) {
      for (const sign of k === 0 ? [0] : [-1, 1]) {
        const y = Math.max(DISPLAY.swimTop + h / 2, Math.min(DISPLAY.swimBottom - h / 2, o.y + sign * k * DISPLAY.laneSpread));
        const cost = placed.reduce((c, p) => c + yOverlap(y, h, p.y, p.h), 0);
        if (cost < bestCost - 1e-6) { bestCost = cost; best = y; }
      }
    }
    placed.push({ y: best, h });
    out.set(o.id, best);
  }
  return out;
}

/** 엔진의 성장 배율(scale)을 화면 배율로 바꾼다. 1배 이하는 그대로, 넘는 부분만 줄여서 보여 준다. */
export function displayScale(obj: Pick<PlacedObject, 'kind' | 'layer' | 'scale'>): number {
  const gain = obj.kind === 'plant' ? DISPLAY.plantGrowthGain : obj.kind === 'fish' ? DISPLAY.fishGrowthGain : 1;
  const s = obj.scale <= 1 ? obj.scale : 1 + (obj.scale - 1) * gain;
  return obj.kind === 'plant' && obj.layer === 'front' ? s * DISPLAY.frontPlantHeight : s;
}

export interface Box { x0: number; y0: number; x1: number; y1: number }

/**
 * 논리 좌표(1000×600)에서 오브젝트가 차지하는 상자. 물고기는 가운데 기준, 나머지는 아래 가운데 기준.
 * size(그림 원본 픽셀 크기)가 매니페스트에 없으면 null(측정 불가).
 */
export function objectBox(obj: PlacedObject, asset: ElementAsset | undefined, at?: { x: number; y: number }): Box | null {
  if (!asset?.size) return null;
  const [tw, th] = asset.size;
  const s = displayScale(obj);
  let w: number;
  let h: number;
  if (asset.displayHeight) { h = asset.displayHeight * s; w = (h * tw) / th; }
  else { w = (asset.displayWidth ?? 100) * s; h = (w * th) / tw; }
  const x = at?.x ?? obj.x;
  const y = at?.y ?? obj.y;
  if (obj.kind === 'fish') return { x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2 };
  return { x0: x - w / 2, x1: x + w / 2, y0: y - h, y1: y };
}

const area = (b: Box) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
const inter = (a: Box, b: Box): Box => ({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });
export const overlaps = (a: Box, b: Box) => area(inter(a, b)) > 0;

export interface Occlusion {
  fish: number;
  frontPlants: number;
  /** 물고기 상자 면적 중 앞쪽 수초에 겹친 비율(0~1) */
  frontCover: number;
  /** 투명 처리를 반영한 실제 가림(겹친 부분은 frontPlantFadeAlpha만큼만 가림) */
  effectiveCover: number;
  /** 물고기끼리 겹친 면적 / 물고기 전체 면적(시작 위치 기준) */
  fishOverlap: number;
  /** 물고기 헤엄 띠(세로)끼리 겹친 길이 합 / 물고기 높이 합. 좌우로 헤엄치며 언젠가 겹칠 정도 */
  bandOverlap: number;
  /** 수초 꼭대기 중 가장 높은 곳(y, 작을수록 높음) */
  plantTop: number;
}

/**
 * [검증용 지표] 물고기 가림. 물고기는 상태의 시작 위치(레인)에 감정 깊이를 반영한 높이로 놓고 잰다(헤엄치며 바뀌므로 근사값).
 * fade=false면 투명 처리 없이(이전 표시 방식 비교용).
 */
export function measureOcclusion(state: TankState, assets: Record<string, ElementAsset>, opts: { legacy?: boolean } = {}): Occlusion {
  const lanes = fishLaneLayout(state.objects, assets);
  const box = (o: PlacedObject): Box | null => {
    if (!opts.legacy) {
      const y = o.kind === 'fish' ? Math.max(90, Math.min(450, (lanes.get(o.id) ?? o.y) - state.behavior.depth * 70)) : o.y;
      return objectBox(o, assets[o.el], { x: o.x, y });
    }
    // 이전 표시 방식: 성장 배율 그대로, 앞쪽 수초도 원래 높이
    const a = assets[o.el];
    if (!a?.size) return null;
    const [tw, th] = a.size;
    const h0 = a.displayHeight ? a.displayHeight * o.scale : ((a.displayWidth ?? 100) * o.scale * th) / tw;
    const w0 = a.displayHeight ? (h0 * tw) / th : (a.displayWidth ?? 100) * o.scale;
    const y = o.kind === 'fish' ? Math.max(90, Math.min(450, o.y - state.behavior.depth * 70)) : o.y;
    return o.kind === 'fish' ? { x0: o.x - w0 / 2, x1: o.x + w0 / 2, y0: y - h0 / 2, y1: y + h0 / 2 } : { x0: o.x - w0 / 2, x1: o.x + w0 / 2, y0: y - h0, y1: y };
  };
  const fish = state.objects.filter((o) => o.kind === 'fish').map(box).filter((b): b is Box => !!b);
  const front = state.objects.filter((o) => o.kind === 'plant' && o.layer === 'front').map(box).filter((b): b is Box => !!b);
  const plants = state.objects.filter((o) => o.kind === 'plant').map(box).filter((b): b is Box => !!b);
  let total = 0;
  let covered = 0;
  let fadedCover = 0;
  for (const f of fish) {
    const a = area(f);
    total += a;
    const c = Math.min(a, front.reduce((s, p) => s + area(inter(f, p)), 0));
    covered += c;
    const anyBehind = front.some((p) => overlaps(f, p));
    fadedCover += opts.legacy || !anyBehind ? c : c * DISPLAY.frontPlantFadeAlpha;
  }
  let pair = 0;
  let band = 0;
  for (let i = 0; i < fish.length; i++) for (let j = i + 1; j < fish.length; j++) {
    pair += area(inter(fish[i]!, fish[j]!));
    band += Math.max(0, Math.min(fish[i]!.y1, fish[j]!.y1) - Math.max(fish[i]!.y0, fish[j]!.y0));
  }
  const heights = fish.reduce((sum, f) => sum + (f.y1 - f.y0), 0);
  return {
    fish: fish.length,
    frontPlants: front.length,
    frontCover: total ? covered / total : 0,
    effectiveCover: total ? fadedCover / total : 0,
    fishOverlap: total ? pair / total : 0,
    bandOverlap: heights ? band / heights : 0,
    plantTop: plants.length ? Math.min(...plants.map((p) => p.y0)) : 600,
  };
}
