import { describe, expect, it } from 'vitest';
import manifest from '../../../public/assets/manifest.json';
import type { ElementAsset } from '../../assets/manifest';
import { elementOf, themeOf } from '../../engine/catalog';
import { ENGINE_VERSION, FISH_SPACE } from '../../engine/config';
import { hashOf } from '../../engine/random';
import type { SessionData } from '../../engine/session';
import type { TankState } from '../../engine/types';
import { FISH_BAND_TARGET, occlusionRows } from '../occlusion';
import { runSuite } from '../runner';
import { parseUserData, userRun, verifyUserData } from '../userData';
import fixture from './fixtures/session-0.1.0.json';

/**
 * 이슈 #9: 엔진 0.2.0 물고기 헤엄 공간 예산.
 * 이전 버전(0.1.0) 기록은 바꾸지 않고 그대로 읽히는지도 같이 지킨다.
 */

const suite = runSuite();
const assets = (manifest as unknown as { elements: Record<string, ElementAsset> }).elements;

function load(st: TankState, themeId: string): number {
  return st.objects.filter((o) => o.kind === 'fish').reduce((s, o) => s + (elementOf(themeId, o.el)?.bodyHeight ?? 0) * o.scale, 0);
}

describe('물고기 헤엄 공간 예산(엔진 0.2.0)', () => {
  it('엔진 버전을 올렸다', () => {
    expect(ENGINE_VERSION).toBe('0.2.0');
  });

  it('모든 샘플 어항에서 물고기 몸 높이 합이 예산을 넘지 않는다(완성 전에는 대표 생물 자리를 남김)', () => {
    for (const runs of Object.values(suite.runs)) {
      for (const r of runs) {
        const theme = themeOf(r.cfg.themeId);
        const fin = elementOf(theme.id, theme.finaleElement)!;
        const total = FISH_SPACE.bandHeight * FISH_SPACE.maxFill;
        const daily = total - (fin.bodyHeight ?? 0) * fin.baseScale;
        for (const f of r.frames) {
          const l = load(f.state, theme.id);
          expect(l, `${r.key} ${f.day}일`).toBeLessThanOrEqual((f.state.completed ? total : daily) + 1e-6);
        }
      }
    }
  });

  it('완성된 어항에는 대표 생물이 빠지지 않는다', () => {
    let completed = 0;
    for (const runs of Object.values(suite.runs)) {
      for (const r of runs) {
        const st = r.frames[r.frames.length - 1]!.state;
        if (!st.completed) continue;
        completed++;
        expect(st.objects.some((o) => o.el === themeOf(r.cfg.themeId).finaleElement), r.key).toBe(true);
      }
    }
    expect(completed).toBeGreaterThan(10);
  });

  it(`장기 어항 물고기 헤엄 띠 겹침이 ${FISH_BAND_TARGET * 100}% 미만이다(샘플 시작 위치 근사값)`, () => {
    for (const row of occlusionRows(suite, assets)) {
      expect(row.after.bandOverlap, row.label).toBeLessThan(FISH_BAND_TARGET);
    }
  });
});

describe('이전 엔진(0.1.0) 기록 보호', () => {
  const raw = JSON.stringify(fixture);
  const data = parseUserData(raw);

  it('고정 기록은 0.1.0으로 만든 것이다', () => {
    expect(new Set(data.snapshots.map((s) => s.engineVersion))).toEqual(new Set(['0.1.0']));
  });

  it('무결성 검사에서 문제로 잡히지 않는다(다시 계산하지 않고 내용 해시만 확인)', () => {
    const rep = verifyUserData(data);
    expect(rep.problems).toEqual([]);
    expect(rep.otherVersion).toBe(data.snapshots.length - 1);
    expect(rep.versions).toEqual(['0.1.0']);
  });

  it('내용을 바꾸면 여전히 잡아낸다', () => {
    const t = JSON.parse(raw) as SessionData;
    t.snapshots[3]!.state.objects[0]!.scale = 9;
    expect(verifyUserData(parseUserData(JSON.stringify(t))).problems.some((p) => p.includes('I3'))).toBe(true);
  });

  it('저장된 상태를 그대로 보여 준다(지금 엔진으로 바꿔치기하지 않음)', () => {
    const r = userRun(data);
    const head = data.snapshots.find((s) => s.id === data.headId)!;
    expect(hashOf(r.frames[r.frames.length - 1]!.state)).toBe(hashOf(head.state));
    expect(JSON.stringify(data)).toBe(raw);
  });
});
