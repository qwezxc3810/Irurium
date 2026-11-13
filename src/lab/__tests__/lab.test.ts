import { describe, expect, it } from 'vitest';
import { littlePrinceConfig, littlePrinceEntries } from '../../engine/scenarios';
import { TankSession } from '../../engine/session';
import { hashOf } from '../../engine/random';
import { distinctness, evaluateHypotheses } from '../hypotheses';
import { runSuite, runTank } from '../runner';
import { allScenarios } from '../samples';
import { SAMPLE_PREFIX } from '../types';
import { deepFreeze, derivedTanks, fingerprintOf, parseUserData, userRun, verifyUserData } from '../userData';

/**
 * 검증실 테스트. 개수를 늘리는 것보다 "검증 결과를 믿어도 되는가"를 지키는 데 집중한다.
 */

const suite = runSuite();

describe('엔진을 바꾸지 않았다(기존 스냅샷 보호)', () => {
  it('main(b809973)과 같은 어린왕자 재생 해시가 나온다', () => {
    // 이 값이 바뀌면 엔진 계산이 달라진 것이다. 그때는 ENGINE_VERSION을 올리고 이 값을 의도적으로 갱신해야 한다.
    expect(TankSession.replay(littlePrinceConfig(), littlePrinceEntries())).toBe('897f99bd:a2f000ff');
  });

  it('검증실의 사례 C는 앱 데모와 같은 어항을 만든다(엔진을 흉내 내지 않고 그대로 씀)', () => {
    const replay = TankSession.replayState(littlePrinceConfig(), littlePrinceEntries());
    // 사례 C는 14일차에 완독해 완성 스냅샷이 붙으므로, 완성 답변을 끈 실행의 마지막 상태를 replay와 비교
    const pre = runTank({ ...allScenarios().find((s) => s.id === 'case-C')!.tanks[0]!, finishOnLastPage: false });
    expect(hashOf(pre.frames[pre.frames.length - 1]!.state)).toBe(hashOf(replay));
  });
});

describe('샘플과 실제 기록 구분', () => {
  it('모든 샘플 어항·기록은 sample: 접두사를 가진다', () => {
    for (const sc of allScenarios()) {
      expect(sc.origin).toBe('sample');
      for (const t of sc.tanks) {
        expect(t.cfg.tankId.startsWith(SAMPLE_PREFIX)).toBe(true);
        for (const e of t.entries) expect(e.clientId.startsWith(SAMPLE_PREFIX)).toBe(true);
      }
    }
  });

  it('샘플 실행기는 실제 어항 id를 거부한다', () => {
    const t = allScenarios()[0]!.tanks[0]!;
    expect(() => runTank({ ...t, cfg: { ...t.cfg, tankId: 'tank-real' } })).toThrow();
  });

  it('실제 기록은 얼린 채로 읽기만 하고, 검증 뒤에도 스냅샷이 그대로다', () => {
    const s = new TankSession({ ...littlePrinceConfig(), tankId: 'tank-user' });
    let t = Date.UTC(2026, 10, 13, 12);
    for (const e of littlePrinceEntries().slice(0, 6)) s.addEntry(e, (t += 6 * 3_600_000));
    const json = JSON.stringify(s.toJSON());
    const data = parseUserData(json);
    const before = fingerprintOf(data);
    expect(Object.isFrozen(data.snapshots[1]!.state.objects)).toBe(true);

    const report = verifyUserData(data);
    const run = userRun(data);
    const derived = derivedTanks(data, [1, 2]).map((d) => runTank(d, 'derived'));

    expect(report.problems).toEqual([]);
    expect(run.origin).toBe('user');
    expect(derived.every((d) => d.origin === 'derived' && d.cfg.tankId.startsWith('derived:'))).toBe(true);
    expect(fingerprintOf(data)).toBe(before);
    expect(JSON.stringify(data)).toBe(json);
    // 저장된 상태를 그대로 보여 준다(다시 계산한 값으로 바꾸지 않음)
    expect(run.frames[run.frames.length - 1]!.state).toBe(data.snapshots.find((x) => x.id === data.headId)!.state);
  });

  it('바뀐 스냅샷은 무결성 검사에서 드러나고, 샘플은 실제 기록으로 가져올 수 없다', () => {
    const s = new TankSession({ ...littlePrinceConfig(), tankId: 'tank-user' });
    s.addEntry(littlePrinceEntries()[0]!, 1000);
    const raw = s.toJSON();
    raw.snapshots[1]!.state.light.temp = 0.99;
    expect(verifyUserData(deepFreeze(raw)).problems.length).toBeGreaterThan(0);
    const sample = { ...s.toJSON(), cfg: { ...raw.cfg, tankId: 'sample:x' } };
    expect(() => parseUserData(JSON.stringify(sample))).toThrow();
  });
});

describe('실제 기록의 종료 상태 표시 (PR #2 리뷰)', () => {
  const H = 3_600_000;
  /** 2026-11-13부터 하루 한 번씩 n개 기록한 실제 어항(앱과 같은 TankSession) */
  function userSession(n: number) {
    const s = new TankSession({ ...littlePrinceConfig(), tankId: 'tank-user' });
    let t = Date.UTC(2026, 10, 13, 12);
    littlePrinceEntries().filter((e, i, a) => a.findIndex((x) => x.localDate === e.localDate) === i).slice(0, n).forEach((e) => {
      s.addEntry(e, t);
      t += 24 * H;
    });
    return { s, t };
  }

  it('마무리(wrapped)한 어항은 JSON으로 가져와도 active가 아니라 마지막 프레임에 wrapped로 표시된다', () => {
    const { s, t } = userSession(5);
    s.finalize('wrapped', t);
    const json = JSON.stringify(s.toJSON());
    const data = parseUserData(json);
    const run = userRun(data);
    const last = run.frames[run.frames.length - 1]!;

    expect(data.lifecycle).toBe('wrapped');
    expect(last.lifecycle).toBe('wrapped');
    expect(last.moss).toBe(0);
    // 마무리 날짜가 데이터에 없으므로 지난 날짜로 소급하지 않는다
    expect(run.frames.slice(0, -1).every((f) => f.lifecycle === 'active')).toBe(true);
    // 마지막 기록 날짜 뒤의 날짜를 만들어 내지 않는다
    expect(last.date).toBe(data.entries[data.entries.length - 1]!.localDate);
    // 한계를 화면에 알린다
    expect(run.notes.join(' ')).toContain('마무리');
    // 원본은 그대로
    expect(JSON.stringify(data)).toBe(json);
  });

  it('마무리한 실제 어항의 가상 실험(derived)도 마무리로 끝난다', () => {
    const { s, t } = userSession(4);
    s.finalize('wrapped', t);
    const data = parseUserData(JSON.stringify(s.toJSON()));
    const [d] = derivedTanks(data, [7]).map((x) => runTank(x, 'derived'));
    expect(d!.frames[d!.frames.length - 1]!.lifecycle).toBe('wrapped');
    expect(d!.frames.slice(0, -1).every((f) => f.lifecycle === 'active')).toBe(true);
  });

  it('완성(completed)한 어항은 완성 스냅샷이 생긴 날부터 완성으로 표시된다', () => {
    const { s, t } = userSession(5);
    s.finalize('completed', t);
    const run = userRun(parseUserData(JSON.stringify(s.toJSON())));
    expect(run.frames[run.frames.length - 1]!.lifecycle).toBe('completed');
    expect(run.frames.filter((f) => f.lifecycle === 'completed').length).toBe(1);
    expect(run.notes).toEqual([]);
  });

  it('진행 중인 어항은 끝까지 active', () => {
    const { s } = userSession(5);
    const run = userRun(parseUserData(JSON.stringify(s.toJSON())));
    expect(run.frames.every((f) => f.lifecycle === 'active')).toBe(true);
  });
});

describe('재현성과 감정 차이 (요구 6)', () => {
  it('같은 기록·같은 시드로 다시 돌리면 모든 어항의 스냅샷 해시가 같다', () => {
    const again = runSuite();
    for (const sc of suite.scenarios) {
      expect(again.runs[sc.id]!.map((r) => r.chainHash)).toEqual(suite.runs[sc.id]!.map((r) => r.chainHash));
    }
  });

  it('감정만 다른 어항끼리의 차이가 시드만 다른 어항끼리의 차이보다 크다', () => {
    const d = distinctness(suite);
    expect(d.ok).toBe(true);
    expect(d.okAB).toBe(true);
  });

  it('모든 샘플 어항이 불변 규칙과 하루 규칙(R1~R6)을 지킨다', () => {
    for (const r of Object.values(suite.runs).flat()) {
      expect(r.invariants, r.key).toEqual([]);
      for (const rule of r.rules) expect(rule.ok, `${r.key} ${rule.id} ${rule.detail}`).toBe(true);
    }
  });
});

describe('가설 판정', () => {
  const hyps = evaluateHypotheses(suite);

  it('H1~H11을 모두 판정하고 근거를 남긴다', () => {
    expect(hyps.map((h) => h.id)).toEqual(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8', 'H9', 'H10', 'H11']);
    for (const h of hyps) {
      expect(h.reason.length).toBeGreaterThan(10);
      expect(h.measures.length).toBeGreaterThan(0);
    }
  });

  it('사람 평가가 필요한 가설은 자동 측정만으로 통과 처리하지 않는다', () => {
    const human = hyps.filter((h) => h.needsHuman);
    expect(human.map((h) => h.id)).toEqual(['H1', 'H2', 'H3', 'H8', 'H11']);
    for (const h of human) expect(h.verdict).not.toBe('pass');
  });
});
