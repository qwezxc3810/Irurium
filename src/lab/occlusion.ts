import type { ElementAsset } from '../assets/manifest';
import { measureOcclusion, type Occlusion } from '../render/display';
import { frameAt, type SuiteResult } from './runner';

/**
 * [검증용 지표] 이슈 #6 — 오래 자란 어항에서 물고기가 얼마나 가리는지.
 * 엔진 상태는 같고, 화면 표시 규칙(src/render/display.ts)만 이전 방식과 지금 방식을 비교한다.
 * 기준(초안): 실제 가림 10% 미만, 수초 꼭대기가 y 150보다 아래(물고기 위쪽 레인 170이 비어 보이게).
 */

export const OCCLUSION_TARGET = { effectiveCover: 0.1, plantTopMin: 150 } as const;

/** 이슈 #9 기준(초안): 물고기 헤엄 띠 겹침 25% 미만. 엔진 0.2.0의 헤엄 공간 예산으로 맞춘다 */
export const FISH_BAND_TARGET = 0.25;

/**
 * 엔진 0.1.0(main bb039c0) 측정값. 같은 표시 규칙(PR #8)으로 잰 값이라 0.2.0과 나란히 비교할 수 있다.
 * 0.1.0 엔진은 저장소에 남아 있지 않으므로 고정 기록으로 둔다.
 */
export const FISH_BASELINE_010: Record<string, { fish: number; band: number }> = {
  '사례 C 14일': { fish: 3, band: 0.17 },
  '사례 D 150일': { fish: 6, band: 0.35 },
  '꾸준형 100일': { fish: 7, band: 0.33 },
  '꾸준형 200일': { fish: 8, band: 0.63 },
  '띄엄형 200일': { fish: 7, band: 0.4 },
};

export interface OcclusionRow {
  label: string;
  day: number;
  before: Occlusion;
  after: Occlusion;
}

export const OCCLUSION_CASES: Array<[string, string, number, string]> = [
  ['case-C', 'C', 14, '사례 C 14일'],
  ['case-D', 'D', 150, '사례 D 150일'],
  ['long-steady', 'LS', 100, '꾸준형 100일'],
  ['long-steady', 'LS', 200, '꾸준형 200일'],
  ['long-sparse', 'LP', 200, '띄엄형 200일'],
];

export function occlusionRows(s: SuiteResult, assets: Record<string, ElementAsset>): OcclusionRow[] {
  return OCCLUSION_CASES.map(([id, key, day, label]) => {
    const r = s.runs[id]!.find((x) => x.key === key)!;
    const st = frameAt(r, day).state;
    return { label, day, before: measureOcclusion(st, assets, { legacy: true }), after: measureOcclusion(st, assets) };
  });
}

export const pct = (v: number) => `${Math.round(v * 100)}%`;
