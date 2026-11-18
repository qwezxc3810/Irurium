import { describe, expect, it } from 'vitest';
import manifest from '../../../public/assets/manifest.json';
import type { ElementAsset } from '../../assets/manifest';
import { elementOf, themeOf } from '../../engine/catalog';
import { computeFinale, genesisState } from '../../engine/compute';
import { ENGINE_VERSION, FISH_SPACE } from '../../engine/config';
import { hashOf } from '../../engine/random';
import type { SessionData } from '../../engine/session';
import type { TankState } from '../../engine/types';
import { FISH_BAND_TARGET, occlusionRows } from '../occlusion';
import { runSuite } from '../runner';
import { parseUserData, userRun, verifyUserData } from '../userData';
import { structureProblems } from '../../engine/session';
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
    expect(ENGINE_VERSION).toBe('0.3.0');
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

  it('대표 생물이 들어갈 공간이 없으면 가장 먼저 태어난 물고기가 대표가 되고, 공간이 없으니 자라지 않는다', () => {
    const r = suite.runs['long-steady']![0]!;
    const f = r.frames[r.frames.length - 1]!;
    const base = { state: JSON.parse(JSON.stringify(f.state)) as TankState };
    const fish = base.state.objects.filter((o) => o.kind === 'fish');
    // 예산을 거의 다 채운다: 가장 큰 물고기들을 상한까지 키움
    for (const o of fish) o.scale = 1.6;
    const before = load(base.state, r.cfg.themeId);
    expect(before + 92 * 1.2).toBeGreaterThan(FISH_SPACE.bandHeight * FISH_SPACE.maxFill);
    const out = computeFinale({ state: base.state, ledger: genesisState(r.cfg).ledger }, r.cfg, 999);
    const oldest = [...fish].sort((a, b) => a.bornSeq - b.bornSeq)[0]!;
    const ch = out.changes.find((c) => c.objectId);
    expect(ch?.objectId).toBe(oldest.id);
    expect(ch?.text).toBe('가장 오래 함께한 물고기가 대표 생물이 되었어요');
    expect(out.state.objects.find((o) => o.id === oldest.id)!.scale).toBe(1.6);
    expect(out.state.objects.some((o) => o.el === 'fish.foxfish')).toBe(false);
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

  const tampered = (fn: (t: SessionData) => void) => {
    const t = JSON.parse(raw) as SessionData;
    fn(t);
    return verifyUserData(parseUserData(JSON.stringify(t))).problems;
  };

  it('기준(baseId)을 없는 값으로 바꾸면 버전과 관계없이 잡아낸다(I5)', () => {
    const p = tampered((t) => { t.snapshots[5]!.baseId = 's-none'; });
    expect(p.some((x) => /I5: .*기준 스냅샷.*없음/.test(x)), p.join(' / ')).toBe(true);
    expect(p.some((x) => x.includes('입력 해시(I6)·다시 계산(I2)은 하지 않았어요'))).toBe(true);
  });

  it('중간 스냅샷이 빠져 끊긴 기준 체인을 잡아낸다(I5)', () => {
    const p = tampered((t) => { t.snapshots = t.snapshots.filter((s) => s.id !== 's3-r1'); });
    expect(p.some((x) => /I5: s4-r1의 기준 스냅샷\(s3-r1\)이 없음/.test(x)), p.join(' / ')).toBe(true);
  });

  it('엔진 I5와 같은 범위: 갈래(fork)·스냅샷 id 중복·같은 clientId 두 번·기록 순번 오류를 잡는다', () => {
    const fork = tampered((t) => { t.snapshots.push({ ...t.snapshots[5]!, id: 's6-fork' }); });
    expect(fork.some((x) => x.includes('I5: 머리에서 이어지지 않은')), fork.join(' / ')).toBe(true);
    const dupId = tampered((t) => { t.snapshots.push(t.snapshots[3]!); });
    expect(dupId.some((x) => x.includes('I5: 스냅샷 id가 겹침')), dupId.join(' / ')).toBe(true);
    const dupClient = tampered((t) => { t.entries[4]!.clientId = t.entries[3]!.clientId; });
    expect(dupClient.some((x) => x.includes('I5: 같은 기록이 두 번')), dupClient.join(' / ')).toBe(true);
    const seq = tampered((t) => { t.entries[2]!.seq = 9; });
    expect(seq.some((x) => x.includes('I5: 기록 순번')), seq.join(' / ')).toBe(true);
  });

  it('검증실과 엔진의 구조 검사 결과가 같다', () => {
    const t = JSON.parse(raw) as SessionData;
    t.snapshots.push({ ...t.snapshots[5]!, id: 's6-fork' });
    t.entries[4]!.clientId = t.entries[3]!.clientId;
    const lab = verifyUserData(parseUserData(JSON.stringify(t))).problems.filter((x) => x.startsWith('I5'));
    expect(lab).toEqual(structureProblems(t));
    expect(lab.length).toBeGreaterThan(0);
  });

  it('순환하는 기준 체인과 맞지 않는 순번을 잡아낸다(I5)', () => {
    const cyc = tampered((t) => { t.snapshots[1]!.baseId = t.snapshots[4]!.id; });
    expect(cyc.some((x) => x.includes('I5')), cyc.join(' / ')).toBe(true);
    const genesis = tampered((t) => { t.snapshots[0]!.baseId = t.snapshots[2]!.id; });
    expect(genesis.some((x) => x.includes('I5'))).toBe(true);
  });

  it('0.1.0 스냅샷의 입력이나 엔진 버전 표시만 바꿔도 잡아낸다(I6, 다시 계산 없이)', () => {
    const inp = tampered((t) => { t.snapshots[4]!.input!.amount += 5; });
    expect(inp.some((x) => x.includes('I6')), inp.join(' / ')).toBe(true);
    const ver = tampered((t) => { t.snapshots[4]!.engineVersion = '0.2.0'; });
    expect(ver.some((x) => x.includes('I6')), ver.join(' / ')).toBe(true);
  });

  it('머리(headId)가 없는 스냅샷을 가리키면 가져오기부터 거부한다', () => {
    const t = JSON.parse(raw) as SessionData;
    t.headId = 's-none';
    expect(() => parseUserData(JSON.stringify(t))).toThrow('머리');
  });

  it('저장된 상태를 그대로 보여 준다(지금 엔진으로 바꿔치기하지 않음)', () => {
    const r = userRun(data);
    const head = data.snapshots.find((s) => s.id === data.headId)!;
    expect(hashOf(r.frames[r.frames.length - 1]!.state)).toBe(hashOf(head.state));
    expect(JSON.stringify(data)).toBe(raw);
  });
});
