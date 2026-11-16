import type { VeSession } from './visualEval';

/**
 * 블라인드 평가의 탭 소유권.
 * 진행 중 평가(KEY_CURRENT)는 기기 저장소(localStorage)에 두고, 어느 탭이 그 평가의 주인인지는 KEY_OWNER에 탭 토큰으로 남긴다.
 * 탭 토큰은 탭마다 sessionStorage에 두므로 같은 탭은 새로고침해도 같고, 다른 탭은 다르다.
 * - 주인 탭만 평가 화면을 보고 답을 저장한다(새로고침하면 이어서).
 * - 다른 탭은 처음 열 때도, 새로고침해도 '진행 중' 안내만 본다.
 * - 끝내거나 그만두면 잠금을 푼다. 주인 탭이 닫혀 잠금만 남으면, 다른 탭에서 '그 평가 버리기'로 풀 수 있다
 *   (그러면 원래 주인 탭이 다시 답해도 저장되지 않는다).
 * 한계: 브라우저의 '탭 복제'는 sessionStorage까지 복사해서 두 탭이 같은 토큰을 가질 수 있다.
 */

export const KEY_CURRENT = 'irurium.visualEval.current';
export const KEY_OWNER = 'irurium.visualEval.owner';
export const KEY_TAB = 'irurium.visualEval.tab';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function read<T>(s: Store | null, key: string): T | null {
  try { const v = s?.getItem(key); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
}
function write(s: Store | null, key: string, value: unknown) {
  try { s?.setItem(key, JSON.stringify(value)); } catch { /* 저장소가 막혀 있으면 넘어감 */ }
}
function remove(s: Store | null, key: string) {
  try { s?.removeItem(key); } catch { /* 무시 */ }
}

/** 이 탭의 토큰(없으면 만든다) */
export function tabToken(tab: Store | null, make: () => string = () => Math.random().toString(36).slice(2) + Date.now().toString(36)): string {
  const t = read<string>(tab, KEY_TAB);
  if (t) return t;
  const n = make();
  write(tab, KEY_TAB, n);
  return n;
}

export type LockView = { kind: 'none' } | { kind: 'owner'; session: VeSession } | { kind: 'busy'; session: VeSession };

/** 이 탭에서 보여 줄 것: 진행 중 평가가 없음 / 내가 주인 / 다른 탭이 주인 */
export function viewFor(local: Store | null, token: string): LockView {
  const session = read<VeSession>(local, KEY_CURRENT);
  if (!session) return { kind: 'none' };
  return read<string>(local, KEY_OWNER) === token ? { kind: 'owner', session } : { kind: 'busy', session };
}

/** 평가 시작: 진행 중 평가가 없을 때만 이 탭이 주인이 된다 */
export function claim(local: Store | null, token: string, session: VeSession): boolean {
  if (read<VeSession>(local, KEY_CURRENT)) return false;
  write(local, KEY_OWNER, token);
  write(local, KEY_CURRENT, session);
  return true;
}

/** 답 저장: 주인 탭만. 주인이 아니면 저장하지 않고 false */
export function saveProgress(local: Store | null, token: string, session: VeSession): boolean {
  if (read<string>(local, KEY_OWNER) !== token) return false;
  write(local, KEY_CURRENT, session);
  return true;
}

/** 끝내거나 그만둠: 주인 탭만 잠금을 푼다 */
export function release(local: Store | null, token: string): boolean {
  if (read<string>(local, KEY_OWNER) !== token) return false;
  remove(local, KEY_CURRENT);
  remove(local, KEY_OWNER);
  return true;
}

/** 주인 탭이 사라져 잠금만 남았을 때 다른 탭에서 그 평가를 버린다(답은 판정에 쓰이지 않음) */
export function abandon(local: Store | null) {
  remove(local, KEY_CURRENT);
  remove(local, KEY_OWNER);
}
