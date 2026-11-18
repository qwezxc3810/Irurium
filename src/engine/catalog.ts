import type { Layer, ObjectKind } from './types';

/**
 * 요소 카탈로그. 엔진은 여기 있는 id만 알고, 실제 그림 파일은 public/assets/manifest.json이 정한다.
 * 그래픽을 바꿀 때는 매니페스트만 고치면 된다. 새 요소를 추가할 때만 이 파일을 고친다.
 */
export interface ElementDef {
  id: string;
  name: string;
  kind: ObjectKind;
  layers: Layer[];
  /** 이 요소가 어울리는 감정 위치 */
  mood: { temp: number; energy: number };
  /** 한 어항에 같은 요소 최대 개수 */
  maxPerTank: number;
  /** 물고기만: 크기 배율 1일 때 몸 높이(논리 좌표). 헤엄 공간 예산(FISH_SPACE)에 쓴다. 그림 비율과 대략 맞춘다 */
  bodyHeight?: number;
  /** 처음 놓일 때 크기 배율 */
  baseScale: number;
  /** true면 성장으로는 나오지 않고 특별 변화·완성에서만 */
  specialOnly?: boolean;
  finaleOnly?: boolean;
}

export interface ThemeDef {
  id: string;
  name: string;
  elements: ElementDef[];
  /** 완성 때 나오는 대표 생물 */
  finaleElement: string;
}

export const STARLIT_DESERT: ThemeDef = {
  id: 'starlit-desert',
  name: '별빛 사막',
  finaleElement: 'fish.foxfish',
  elements: [
    { id: 'fish.medaka', name: '모래빛 송사리', kind: 'fish', layers: ['mid'], mood: { temp: 0.3, energy: 0.5 }, maxPerTank: 5, bodyHeight: 36, baseScale: 1 },
    { id: 'fish.goldfish', name: '노을 금붕어', kind: 'fish', layers: ['mid'], mood: { temp: 0.8, energy: 0.1 }, maxPerTank: 2, bodyHeight: 100, baseScale: 1 },
    { id: 'fish.bluefin', name: '푸른 밤 물고기', kind: 'fish', layers: ['mid'], mood: { temp: -0.5, energy: -0.4 }, maxPerTank: 4, bodyHeight: 92, baseScale: 1 },
    { id: 'fish.foxfish', name: '여우 물고기', kind: 'fish', layers: ['mid'], mood: { temp: 0.6, energy: 0.2 }, maxPerTank: 1, bodyHeight: 92, baseScale: 1.2, finaleOnly: true },
    { id: 'plant.stem', name: '모래풀', kind: 'plant', layers: ['back'], mood: { temp: 0.1, energy: -0.4 }, maxPerTank: 4, baseScale: 0.8 },
    { id: 'plant.leafy', name: '잎 풍성한 수초', kind: 'plant', layers: ['back', 'front'], mood: { temp: 0.6, energy: 0.2 }, maxPerTank: 3, baseScale: 0.8 },
    { id: 'plant.foxtail', name: '여우꼬리풀', kind: 'plant', layers: ['back'], mood: { temp: -0.2, energy: -0.3 }, maxPerTank: 2, baseScale: 0.8 },
    { id: 'rock.round', name: '둥근 수석', kind: 'rock', layers: ['floor'], mood: { temp: 0.1, energy: -0.3 }, maxPerTank: 3, baseScale: 1 },
    { id: 'rock.sharp', name: '모난 수석', kind: 'rock', layers: ['floor'], mood: { temp: -0.4, energy: 0.3 }, maxPerTank: 3, baseScale: 1 },
    { id: 'symbol.rose-coral', name: '장미 산호', kind: 'symbol', layers: ['floor'], mood: { temp: -0.4, energy: 0.4 }, maxPerTank: 1, baseScale: 1, specialOnly: true },
    { id: 'symbol.sand-lantern', name: '모래 등불', kind: 'symbol', layers: ['floor'], mood: { temp: 0.6, energy: -0.1 }, maxPerTank: 1, baseScale: 1, specialOnly: true },
  ],
};

export const THEMES: Record<string, ThemeDef> = { [STARLIT_DESERT.id]: STARLIT_DESERT };

export function themeOf(id: string): ThemeDef {
  return THEMES[id] ?? STARLIT_DESERT;
}

/**
 * 0.3.0 감정 흔적(감정 사전 상징). 테마 요소 목록(성장 후보)과 따로 두어 0.2.0 성장 선택에 섞이지 않게 한다.
 * 그림은 아직 없다(렌더러가 임시 도형으로 그림). 이름은 docs/EMOTION_DICTIONARY.md 표 B.
 */
export const EMOTION_SYMBOLS: ElementDef[] = [
  ['emotion.sunset-coral', '노을빛 꽃산호', 0.8, 0.1],
  ['emotion.pearl-clam', '반짝이 진주조개', 0.6, 0.7],
  ['emotion.fish-school', '작은 물고기 떼', 0.7, 0.8],
  ['emotion.stone-tower', '쌓아 올린 돌탑', 0.6, 0.4],
  ['emotion.star-jelly', '별빛 해파리', 0.2, -0.7],
  ['emotion.bottle-letter', '유리병 편지', -0.2, -0.3],
  ['emotion.lantern-fish', '등불 물고기', -0.6, -0.5],
  ['emotion.tear-pearl', '푸른 눈물 진주', -0.7, -0.6],
  ['emotion.tangled-weed', '엉킨 해초', -0.5, 0.4],
  ['emotion.foggy-compass', '안개 낀 나침반', -0.4, -0.2],
  ['emotion.black-urchin', '검은 성게', -0.4, 0.5],
  ['emotion.sleeping-conch', '잠든 소라고둥', 0, -0.8],
].map(([id, name, temp, energy]) => ({
  id: id as string, name: name as string, kind: 'emotion' as const, layers: ['back', 'floor'] as Layer[],
  mood: { temp: temp as number, energy: energy as number }, maxPerTank: 4, baseScale: 1, specialOnly: true,
}));

export function elementOf(themeId: string, elId: string): ElementDef | undefined {
  return themeOf(themeId).elements.find((e) => e.id === elId) ?? EMOTION_SYMBOLS.find((e) => e.id === elId);
}

/** 특수 효과 id. 렌더러가 매니페스트의 fx 항목으로 그린다. */
export const EFFECTS = {
  starsBright: 'fx.stars-bright',
  lightray: 'fx.lightray',
} as const;
