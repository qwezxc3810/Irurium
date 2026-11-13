/** 결정론적 난수와 해시. Math.random과 현재 시각은 엔진 어디에서도 쓰지 않는다. */

export type Rng = () => number;

/** mulberry32: 32비트 시드로 0~1 난수를 만든다. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 어항 시드와 기록 순번으로 그 기록 전용 난수열을 만든다. */
export function rngFor(seed: number, seq: number, salt = 0): Rng {
  return mulberry32((seed ^ Math.imul(seq + 1, 0x9e3779b1) ^ Math.imul(salt + 7, 0x85ebca6b)) >>> 0);
}

/** FNV-1a 32비트 해시. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 키 순서를 고정한 JSON. 해시 입력용. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const obj = value as Record<string, unknown>;
  return '{' + Object.keys(obj).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

export function hashOf(value: unknown): string {
  return fnv1a(stableStringify(value)).toString(16).padStart(8, '0');
}

export function seedFromString(text: string): number {
  return fnv1a(text);
}
