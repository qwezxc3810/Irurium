import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION } from '../../engine/config';
import { GOLDEN_REPLAY } from '../../engine/__tests__/golden';
import { littlePrinceConfig, littlePrinceEntries } from '../../engine/scenarios';
import { seedFromString } from '../../engine/random';
import { TankSession } from '../../engine/session';
import { runVisualSet, waterGaps } from '../../lab/visualEval';
import { applyBackgroundGrade, atmosphere, backgroundGrade, hasBackgroundGrade, MAX_FILTER_ALPHA, MAX_GLOW_ALPHA, MAX_WATER_ALPHA, MIN_FILTER_LUMA, moodSpreadOf, RENDER_STYLE, SPREAD_FULL, SPREAD_START, TEMP_FULL } from '../atmosphere';
import { QUALITY } from '../quality';
import rendererSource from '../AquariumRenderer.ts?raw';

const rgb = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const dist = (a: number, b: number) => { const x = rgb(a); const y = rgb(b); return Math.hypot(x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!); };
const warmness = (c: number) => { const [r, , b] = rgb(c); return r! - b!; };

describe('감정 분위기(렌더링 전용)', () => {
  it('따뜻한 감정은 위층 물색이 붉은 쪽, 차가운 감정은 파란 쪽', () => {
    const w = atmosphere({ temp: 0.6, energy: 0.5, spread: 0.05 });
    const c = atmosphere({ temp: -0.25, energy: -0.4, spread: 0.05 });
    expect(warmness(w.waterTop.color)).toBeGreaterThan(30);
    expect(warmness(c.waterTop.color)).toBeLessThan(-30);
    expect(w.particles.warmShare).toBeGreaterThan(0.9);
    expect(c.particles.warmShare).toBeLessThan(0.1);
  });

  it('감정 변화가 크면 위는 따뜻한 빛, 아래는 차가운 빛이 함께(반반 나누지 않고 그라데이션 두 층)', () => {
    const s = atmosphere({ temp: 0, energy: 0.2, spread: SPREAD_FULL });
    expect(s.contrast).toBe(1);
    expect(warmness(s.waterTop.color)).toBeGreaterThan(0);
    expect(warmness(s.waterBottom.color)).toBeLessThan(0);
    expect(s.particles.warmShare).toBeGreaterThan(0.3);
    expect(s.particles.warmShare).toBeLessThan(0.7);
    expect(s.glowWarm.alpha).toBeGreaterThan(0.1); // 기존 조명과 겹쳐 뿌예지지 않게 따뜻한 보조 빛은 약하게;
    expect(s.glowCool.alpha).toBeGreaterThan(0.15);
  });

  it('같은 계열 감정끼리 오가는 흔들림(차분·쓸쓸·그리움 정도)은 대비로 보지 않는다', () => {
    expect(atmosphere({ temp: -0.22, energy: -0.45, spread: 0.32 }).contrast).toBe(0);
    expect(SPREAD_START).toBeGreaterThan(0.33);
  });

  it('고정 테마가 아니라 연속값: 감정이 조금 바뀌면 색도 조금만 바뀐다', () => {
    let prev = atmosphere({ temp: -0.6, energy: 0, spread: 0.1 });
    for (let t = -0.58; t <= 0.6; t += 0.02) {
      const a = atmosphere({ temp: t, energy: 0, spread: 0.1 });
      expect(dist(a.waterTop.color, prev.waterTop.color)).toBeLessThan(25);
      expect(Math.abs(a.waterTop.alpha - prev.waterTop.alpha)).toBeLessThan(0.05);
      prev = a;
    }
    // 중간값은 양 끝과 다르다(세 단계로 딱 끊기지 않음)
    const mid = atmosphere({ temp: TEMP_FULL / 2, energy: 0, spread: 0 });
    const full = atmosphere({ temp: TEMP_FULL, energy: 0, spread: 0 });
    const none = atmosphere({ temp: 0, energy: 0, spread: 0 });
    expect(dist(mid.waterTop.color, full.waterTop.color)).toBeGreaterThan(5);
    expect(dist(mid.waterTop.color, none.waterTop.color)).toBeGreaterThan(5);
  });

  it('어둡거나 탁해지지 않게 덧칠·빛 알파에 상한이 있다(극단값에서도)', () => {
    for (const temp of [-1, -0.5, 0, 0.5, 1]) for (const energy of [-1, 1]) for (const spread of [0, 1]) {
      const a = atmosphere({ temp, energy, spread });
      expect(a.waterTop.alpha).toBeLessThanOrEqual(MAX_WATER_ALPHA);
      expect(a.waterBottom.alpha).toBeLessThanOrEqual(MAX_FILTER_ALPHA);
      for (const t of [a.glowWarm, a.glowCool]) expect(t.alpha).toBeLessThanOrEqual(MAX_GLOW_ALPHA);
      // 아래층은 곱하기라 색이 밝아야 어두워지지 않는다
      const [r, g, b] = rgb(a.waterBottom.color);
      expect(0.2126 * r! + 0.7152 * g! + 0.0722 * b!).toBeGreaterThan(MIN_FILTER_LUMA);
    }
    expect(atmosphere({ temp: NaN, energy: NaN, spread: NaN }).waterTop.alpha).toBeGreaterThan(0);
  });

  describe('감정 흔들림(moodSpreadOf): 최근 14 달력일 기준', () => {
    // 2026-03-01부터 n일째 날짜
    const day = (n: number) => new Date(Date.UTC(2026, 2, 1 + n)).toISOString().slice(0, 10);
    const rec = (n: number, temp: number) => ({ date: day(n), temp });

    it('기본: 비어 있거나 하나뿐이면 0, 표준편차 계산', () => {
      expect(moodSpreadOf([], day(0))).toBe(0);
      expect(moodSpreadOf([rec(0, 0.5)], day(0))).toBe(0);
      expect(moodSpreadOf([rec(0, 0.5), rec(1, -0.5)], day(1))).toBeCloseTo(0.5);
    });

    it('매일 기록: 기준일 포함 최근 14일만 쓴다(15일 전은 빠짐)', () => {
      const trail = [...Array.from({ length: 30 }, (_, i) => rec(i, 1)), ...Array.from({ length: 14 }, (_, i) => rec(30 + i, 0))];
      expect(moodSpreadOf(trail, day(43))).toBe(0); // 30~43일: 모두 0
      expect(moodSpreadOf(trail, day(44))).toBe(0); // 31~44일: 여전히 0
      expect(moodSpreadOf(trail, day(42))).toBeGreaterThan(0); // 29~42일: 29일의 1이 섞임
    });

    it('7일 공백: 기록 없는 날은 중립으로 채우지 않고 빼고 계산한다', () => {
      const trail = [rec(0, 0.4), rec(1, 0.4), rec(9, 0.4), rec(10, 0.4)];
      expect(moodSpreadOf(trail, day(10))).toBe(0); // 0으로 채웠다면 흔들림이 생겼을 것
    });

    it('30일 공백 뒤 복귀: 오래전 감정은 최근 분위기에 섞이지 않는다', () => {
      const old = Array.from({ length: 13 }, (_, i) => rec(i, i % 2 ? 0.7 : -0.3)); // 크게 흔들리던 옛 기록
      const back = [rec(45, 0.5), rec(46, 0.5)];
      const trail = [...old, ...back];
      expect(moodSpreadOf(old, day(12))).toBeGreaterThan(0.4);
      expect(moodSpreadOf(trail, day(46))).toBe(0); // 기록 개수로 자르면 옛 기록 12개가 섞였을 것
      expect(moodSpreadOf(trail, day(45))).toBe(0); // 창 안 기록 1개 → 0
    });

    it('같은 날 여러 번 기록: 엔진이 하루 1개로 합쳐 두므로 하루 안의 감정 차이는 흔들림이 아니다', () => {
      const s = new TankSession({ tankId: 't', seed: seedFromString('spread'), themeId: 'starlit-desert', goal: { type: 'free', totalUnits: null, dailyTarget: null }, startDate: '2026-11-13' });
      let t = Date.UTC(2026, 10, 13);
      ['따뜻함', '쓸쓸함', '설렘', '차분함'].forEach((chip, i) =>
        s.addEntry({ clientId: `c${i}`, localDate: '2026-11-13', amount: 10, progressValue: (i + 1) * 10, moodChips: [chip], note: '' }, (t += 3_600_000)));
      expect(s.head.ledger.moodTrail).toHaveLength(1);
      expect(moodSpreadOf(s.head.ledger.moodTrail, '2026-11-13')).toBe(0);
    });

    it('기준일보다 뒤 기록과 잘못된 기준일은 쓰지 않는다', () => {
      const trail = [rec(0, 0.5), rec(1, 0.5), rec(2, -0.5)];
      expect(moodSpreadOf(trail, day(1))).toBe(0); // 2일 기록은 미래
      expect(moodSpreadOf(trail, 'not-a-date')).toBe(0);
    });

    it('없는 날짜(2026-02-31 등)는 기준일로도, 기록 날짜로도 쓰지 않는다', () => {
      expect(moodSpreadOf([{ date: '2026-02-27', temp: 0.5 }, { date: '2026-02-28', temp: -0.5 }], '2026-02-31')).toBe(0);
      expect(moodSpreadOf([{ date: '2026-02-30', temp: 0.9 }, { date: '2026-03-01', temp: 0.1 }, { date: '2026-03-02', temp: 0.1 }], '2026-03-02')).toBe(0);
      expect(moodSpreadOf([{ date: '2024-02-29', temp: 0.5 }, { date: '2024-03-01', temp: -0.5 }], '2024-03-01')).toBeCloseTo(0.5); // 윤년은 정상
    });
  });
});

describe('렌더러 연결과 보호', () => {
  it('뿌옇지 않게 위층은 가산(add), 아래층은 곱하기(multiply)로 섞는다', () => {
    expect(rendererSource).toMatch(/top\.blendMode = 'add'/);
    expect(rendererSource).toMatch(/bottom\.blendMode = 'multiply'/);
  });

  it('물색 덧칠은 배경 바로 위·생물 뒤 레이어(atmos)에 둔다(생물 색을 덮지 않음)', () => {
    const order = [...rendererSource.matchAll(/^\s{4}(\w+): new Container\(\),/gm)].map((m) => m[1]);
    expect(order.slice(0, 3)).toEqual(['background', 'atmos', 'back']);
    expect(order.indexOf('atmos')).toBeLessThan(order.indexOf('mid'));
  });

  it('저사양은 입자만 줄이고(일반 40 → 저사양 12) 물색 덧칠은 그대로', () => {
    expect(QUALITY.normal.maxParticles).toBe(40);
    expect(QUALITY.low.maxParticles).toBeLessThan(QUALITY.normal.maxParticles);
    // atmosphere()는 품질을 받지 않는다 → 저사양에서도 같은 물색
    expect(atmosphere.length).toBe(1);
  });

  it('기본 렌더링은 감정 배경(atmos-2), 엔진 버전·골든 해시는 그대로', () => {
    expect(RENDER_STYLE).toBe('atmos-2');
    expect(ENGINE_VERSION).toBe('0.3.0');
    expect(TankSession.replay(littlePrinceConfig(), littlePrinceEntries())).toBe(GOLDEN_REPLAY[ENGINE_VERSION]);
  });

  it('자동 비교: 감정 쌍 물색 차이는 분위기 렌더링에서 커지고, 시드 쌍(같은 감정)은 0 그대로', () => {
    const g = waterGaps(runVisualSet());
    for (const day of [14, 100, 200] as const) {
      const v0 = g.find((x) => x.day === day && x.style === 'v0')!;
      const at = g.find((x) => x.day === day && x.style === 'atmos-1')!;
      const a2 = g.find((x) => x.day === day && x.style === 'atmos-2')!;
      expect(at.emotionMean).toBeGreaterThan(v0.emotionMean); // 자동 참고값: 커지기만 확인(사람 평가로 판단)
      expect(a2.emotionMean).toBeGreaterThan(at.emotionMean);
      expect(at.seedMean).toBe(0);
      expect(a2.seedMean).toBe(0);
      expect(v0.seedMean).toBe(0);
    }
  });
});

describe('감정 배경 색감(atmos-2, 렌더링 전용)', () => {
  const WATER: [number, number, number] = [5, 59, 115]; // 배경 그림 평균색
  const hue = (c: [number, number, number]) => c[0] - c[2];

  it('감정이 없으면 원래 배경 그대로(항등 행렬)', () => {
    const g = backgroundGrade({ temp: 0, energy: 0, spread: 0 });
    expect(g.strength).toBe(0);
    expect(applyBackgroundGrade(WATER, g)).toEqual(WATER);
  });

  it('따뜻함은 붉은 쪽, 차가움은 채도 낮은 청색, 변화 큼은 둘 사이의 해 질 녘 색', () => {
    const w = applyBackgroundGrade(WATER, backgroundGrade({ temp: 0.6, energy: 0.4, spread: 0.05 }));
    const c = applyBackgroundGrade(WATER, backgroundGrade({ temp: -0.25, energy: -0.4, spread: 0.05 }));
    const s = applyBackgroundGrade(WATER, backgroundGrade({ temp: 0.05, energy: 0.1, spread: SPREAD_FULL }));
    expect(hue(w)).toBeGreaterThan(0);
    expect(hue(c)).toBeLessThan(0);
    expect(hue(s)).toBeGreaterThan(hue(c));
    expect(hue(s)).toBeLessThan(hue(w));
    // 세 감정의 배경색이 서로 충분히 다르다(RGB 거리 40 이상, 자동 참고값)
    const d = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
    expect(Math.min(d(w, c), d(w, s), d(c, s))).toBeGreaterThan(40);
  });

  it('너무 어둡지 않다: 감정 배경의 평균 밝기가 원래 배경보다 낮지 않다', () => {
    const luma = (c: number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    for (const m of [{ temp: 0.6, energy: 0.4, spread: 0 }, { temp: -0.3, energy: -0.5, spread: 0 }, { temp: 0, energy: 0, spread: SPREAD_FULL }]) {
      expect(luma(applyBackgroundGrade(WATER, backgroundGrade(m)))).toBeGreaterThanOrEqual(luma(WATER));
    }
  });

  it('연속적이다: 감정 온도를 조금 바꾸면 색도 조금만 바뀐다', () => {
    let prev = applyBackgroundGrade(WATER, backgroundGrade({ temp: -0.5, energy: 0, spread: 0 }));
    for (let t = -0.49; t <= 0.5; t += 0.01) {
      const cur = applyBackgroundGrade(WATER, backgroundGrade({ temp: t, energy: 0, spread: 0 }));
      expect(Math.hypot(cur[0] - prev[0], cur[1] - prev[1], cur[2] - prev[2])).toBeLessThan(12);
      prev = cur;
    }
  });

  it('배경 그림 한 장에만 걸고, 결과를 텍스처로 저장해 저사양에서도 유지한다', () => {
    expect(rendererSource).toMatch(/this\.bgSprite = s;/);
    expect(rendererSource).toMatch(/generateTexture\(\{ target: src/);
    expect(rendererSource).not.toMatch(/colorGrade[^\n]*bgGrade/);
    expect(hasBackgroundGrade('atmos-2')).toBe(true);
    expect(hasBackgroundGrade('atmos-1')).toBe(false);
  });

  it('변화 큼의 빛 오감은 움직임 줄이기에서 멈춘다', () => {
    expect(rendererSource).toMatch(/const w = reducedMotion \? 0 :/);
  });
});

import { EMOTION_SYMBOLS } from '../../engine/catalog';
const appFiles = Object.keys(import.meta.glob('../../../public/assets/emotions/*.webp'));
const originals = Object.keys(import.meta.glob('../../../art/originals/emotions/*.png'));
import manifestJson from '../../../public/assets/manifest.json';
describe('감정 상징 12종 그림(기본 그림)', () => {
  const els = (manifestJson as { elements: Record<string, { src: string; displayWidth?: number; displayHeight?: number; swim?: unknown }> }).elements;
  it('엔진의 감정 흔적 12종이 모두 매니페스트에 있고 파일이 있다', () => {
    expect(EMOTION_SYMBOLS).toHaveLength(12);
    for (const e of EMOTION_SYMBOLS) {
      const a = els[e.id];
      expect(a, e.id).toBeDefined();
      expect(appFiles, a!.src).toContain(`../../../public/assets/${a!.src}`);
      expect(originals).toContain(`../../../art/originals/emotions/${a!.src.split('/')[1]!.replace('.webp', '.png')}`);
    }
  });
  it('헤엄치는 상징(신남 무리·외로움)은 물고기 규격(폭·헤엄), 나머지는 높이 기준', () => {
    for (const id of ['emotion.fish-school', 'emotion.lantern-fish']) expect(els[id]!.displayWidth && els[id]!.swim).toBeTruthy();
    for (const e of EMOTION_SYMBOLS.filter((x) => !['emotion.fish-school', 'emotion.lantern-fish'].includes(x.id))) expect(els[e.id]!.displayHeight).toBeGreaterThan(0);
  });
  it('렌더러: 그림이 있으면 그림, 없으면 임시 도형. 신남은 단계마다 무리가 커지고, 평온은 떠다님', () => {
    expect(rendererSource).toMatch(/obj\.kind === 'emotion' && this\.syncEmotionArt\(obj\)/);
    expect(rendererSource).toMatch(/2 \+ \(obj\.stage \?\? 1\)/);
    expect(rendererSource).toMatch(/v\.float\.baseY \+ \(rm \? 0/);
  });
});
