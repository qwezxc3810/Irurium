import { describe, expect, it } from 'vitest';
import { newSession } from '../visualEval';
import { abandon, claim, KEY_CURRENT, KEY_OWNER, release, saveProgress, tabToken, viewFor } from '../visualEvalLock';

/** 브라우저 저장소 흉내: localStorage는 탭끼리 공유, sessionStorage는 탭마다(새로고침해도 유지) */
class Mem {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}
let n = 0;
const make = () => `tab-${++n}`;
const session = () => newSession('', 7, new Date(Date.UTC(2026, 10, 16)), 'vitest', 'synthetic-test');
const answered = (s: ReturnType<typeof session>, k: number) => ({ ...s, answers: s.order.slice(0, k).map((o) => ({ pairId: o.pairId, swap: o.swap, same: 'same' as const, emotionLeft: 'warm' as const, emotionRight: 'cool' as const, diff: 3 as const })) });

function setup() {
  const local = new Mem();
  const tabA = new Mem();
  const tabB = new Mem();
  const a = tabToken(tabA, make);
  const s = session();
  expect(claim(local, a, s)).toBe(true);
  return { local, tabA, tabB, a, s };
}

describe('평가 탭 소유권', () => {
  it('같은 탭은 새로고침해도 같은 토큰이고 평가를 이어서 한다', () => {
    const { local, tabA, a, s } = setup();
    expect(saveProgress(local, a, answered(s, 3))).toBe(true);
    const reloaded = tabToken(tabA, make); // 새로고침: sessionStorage 유지
    expect(reloaded).toBe(a);
    const v = viewFor(local, reloaded);
    expect(v.kind).toBe('owner');
    expect(v.kind === 'owner' && v.session.answers.length).toBe(3);
  });

  it('다른 탭은 처음 열 때 진행 중 안내(busy)만 본다', () => {
    const { local, tabB } = setup();
    expect(viewFor(local, tabToken(tabB, make)).kind).toBe('busy');
  });

  it('다른 탭이 busy가 된 뒤 새로고침해도 busy로 남는다', () => {
    const { local, tabB } = setup();
    const b = tabToken(tabB, make);
    expect(viewFor(local, b).kind).toBe('busy');
    expect(viewFor(local, tabToken(tabB, make)).kind).toBe('busy');
  });

  it('양쪽이 답을 저장하려 하면 주인 탭만 저장되고 다른 탭은 거부된다', () => {
    const { local, tabB, a, s } = setup();
    const b = tabToken(tabB, make);
    expect(saveProgress(local, a, answered(s, 2))).toBe(true);
    expect(saveProgress(local, b, answered(s, 15))).toBe(false);
    const v = viewFor(local, a);
    expect(v.kind === 'owner' && v.session.answers.length).toBe(2);
    expect(claim(local, b, session())).toBe(false); // 다른 탭이 새 평가로 덮어쓸 수도 없다
  });

  it('끝내거나 그만두면 주인 탭만 잠금을 푼다', () => {
    const { local, tabB, a } = setup();
    const b = tabToken(tabB, make);
    expect(release(local, b)).toBe(false);
    expect(viewFor(local, a).kind).toBe('owner');
    expect(release(local, a)).toBe(true);
    expect(local.getItem(KEY_CURRENT)).toBeNull();
    expect(local.getItem(KEY_OWNER)).toBeNull();
    expect(viewFor(local, b).kind).toBe('none');
    expect(claim(local, b, session())).toBe(true);
  });

  it('주인 탭이 사라져 잠금만 남으면 다른 탭에서 버릴 수 있고, 그 뒤 원래 탭의 답은 저장되지 않는다', () => {
    const { local, tabB, a, s } = setup();
    const b = tabToken(tabB, make);
    abandon(local);
    expect(claim(local, b, session())).toBe(true);
    expect(saveProgress(local, a, answered(s, 21))).toBe(false);
    expect(viewFor(local, a).kind).toBe('busy');
  });
});
