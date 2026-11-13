import { describe, expect, it } from 'vitest';
import manifest from '../../../public/assets/manifest.json';
import type { ElementAsset } from '../../assets/manifest';
import { TankSession } from '../../engine/session';
import { littlePrinceConfig, littlePrinceEntries } from '../../engine/scenarios';
import { runSuite } from '../../lab/runner';
import { OCCLUSION_TARGET, occlusionRows } from '../../lab/occlusion';
import { DISPLAY, displayScale, fishLaneLayout } from '../display';

/** 이슈 #6: 화면 표시 규칙. 엔진은 바꾸지 않는다. */
const assets = manifest.elements as unknown as Record<string, ElementAsset>;

describe('화면 표시 규칙', () => {
  it('1배 이하는 그대로, 넘는 성장은 줄여서 보여 준다(순서는 유지)', () => {
    const p = (scale: number, layer: 'back' | 'front' = 'back') => displayScale({ kind: 'plant', layer, scale });
    expect(p(0.8)).toBe(0.8);
    expect(p(1)).toBe(1);
    expect(p(1.5)).toBeCloseTo(1.25);
    expect(p(1.2)).toBeLessThan(p(1.3));
    expect(p(1.5, 'front')).toBeCloseTo(1.25 * DISPLAY.frontPlantHeight);
    expect(displayScale({ kind: 'rock', layer: 'floor', scale: 1.4 })).toBe(1.4);
  });

  it('물고기 헤엄 높이 배치는 같은 상태면 언제나 같다', () => {
    const st = TankSession.replayState(littlePrinceConfig(), littlePrinceEntries());
    expect([...fishLaneLayout(st.objects, assets)]).toEqual([...fishLaneLayout(st.objects, assets)]);
  });

  it('엔진 계산은 그대로다(골든 해시)', () => {
    expect(TankSession.replay(littlePrinceConfig(), littlePrinceEntries())).toBe('897f99bd:a2f000ff');
  });
});

describe('가림 지표 회귀(이슈 #6)', () => {
  const rows = occlusionRows(runSuite(), assets);

  it('모든 측정 어항에서 앞쪽 수초의 실제 가림이 기준 미만이고 수초 꼭대기가 기준선 아래', () => {
    for (const r of rows) {
      expect(r.after.effectiveCover, r.label).toBeLessThan(OCCLUSION_TARGET.effectiveCover);
      expect(r.after.plantTop, r.label).toBeGreaterThanOrEqual(OCCLUSION_TARGET.plantTopMin);
    }
  });

  it('지금 규칙은 이전 규칙보다 가림·헤엄 띠 겹침이 늘지 않는다', () => {
    for (const r of rows) {
      expect(r.after.effectiveCover, r.label).toBeLessThanOrEqual(r.before.frontCover);
      expect(r.after.bandOverlap, r.label).toBeLessThanOrEqual(r.before.bandOverlap + 1e-9);
    }
  });
});
