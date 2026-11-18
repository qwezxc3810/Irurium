import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION, SUPPORTED_ENGINES, engineFor } from '../config';
import { GOLDEN_REPLAY } from './golden';
import { littlePrinceConfig, littlePrinceEntries } from '../scenarios';
import { TankSession } from '../session';
import { allScenarios } from '../../lab/samples';
import { runScenario } from '../../lab/runner';
import frozen from './frozen-0.2.0.json';

describe('엔진 버전별 계산 (0.2.0 어항은 0.2.0으로 끝까지)', () => {
  it('지금 엔진은 0.3.0, 계산 가능한 버전은 0.2.0·0.3.0', () => {
    expect(ENGINE_VERSION).toBe('0.3.0');
    expect([...SUPPORTED_ENGINES]).toEqual(['0.2.0', '0.3.0']);
    expect(engineFor('0.1.0')).toBe('0.2.0'); // 옛 어항은 0.2.0 도입 때와 같이 이어서 계산
  });

  it('골든: 0.2.0·0.3.0 각각 그 버전 규칙으로 같은 결과', () => {
    expect(TankSession.replay(littlePrinceConfig(), littlePrinceEntries(), '0.2.0')).toBe(GOLDEN_REPLAY['0.2.0']);
    expect(TankSession.replay(littlePrinceConfig(), littlePrinceEntries(), '0.3.0')).toBe(GOLDEN_REPLAY['0.3.0']);
  });

  it('0.2.0 동작 고정: 검증실 샘플 전체(75개 어항)를 0.2.0으로 돌리면 0.3.0 작업 전과 같은 스냅샷 체인', () => {
    const got: Record<string, string> = {};
    for (const sc of allScenarios()) for (const r of runScenario(sc, '0.2.0')) got[r.key] = r.chainHash;
    expect(got).toEqual(frozen);
  });

  it('어항 엔진 버전은 0번 스냅샷에 저장되고, 이어지는 스냅샷도 같은 버전', () => {
    const old = new TankSession(littlePrinceConfig(), 0, '0.2.0');
    let t = 0;
    for (const e of littlePrinceEntries().slice(0, 3)) old.addEntry(e, (t += 1000));
    expect(old.engineVersion).toBe('0.2.0');
    expect(old.snapshots.every((s) => s.engineVersion === '0.2.0')).toBe(true);
    expect(old.head.state.objects.some((o) => o.kind === 'emotion')).toBe(false);
    expect(old.head.ledger.trace).toBeUndefined();
    const fresh = new TankSession(littlePrinceConfig());
    for (const e of littlePrinceEntries().slice(0, 3)) fresh.addEntry(e, (t += 1000));
    expect(fresh.engineVersion).toBe('0.3.0');
    expect(fresh.snapshots.every((s) => s.engineVersion === '0.3.0')).toBe(true);
  });

  it('무결성(I2 재계산)은 각 스냅샷의 엔진 버전 규칙으로', () => {
    for (const v of SUPPORTED_ENGINES) {
      const s = new TankSession(littlePrinceConfig(), 0, v);
      let t = 0;
      for (const e of littlePrinceEntries()) s.addEntry(e, (t += 1000));
      s.finalize('completed', (t += 1000));
      expect(s.checkInvariants({ deep: true })).toEqual([]);
      expect(s.integrityScope().notRecomputed).toBe(0);
      const copy = TankSession.fromJSON(s.toJSON());
      expect(copy.engineVersion).toBe(v);
    }
  });
});
