import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION } from '../../engine/config';
import { GOLDEN_REPLAY } from '../../engine/__tests__/golden';
import { littlePrinceConfig, littlePrinceEntries } from '../../engine/scenarios';
import { TankSession } from '../../engine/session';
import { frameAt, runSuite } from '../../lab/runner';
import { PERF_SCENES } from '../../lab/perfScenes';
import { QUALITY, qualityResolution } from '../../render/quality';
import { detectEnvironment, sourceLabel } from '../env';
import { computeFrameStats } from '../frameStats';
import { formatReport, type PerfResult } from '../report';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-A155N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const HEADLESS = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0 Safari/537.36';

describe('프레임 지표 계산', () => {
  it('일정한 60fps', () => {
    const s = computeFrameStats(Array.from({ length: 600 }, () => 1000 / 60));
    expect(s.avgFps).toBeCloseTo(60, 5);
    expect(s.low1Fps).toBeCloseTo(60, 5);
    expect(s.meanMs).toBeCloseTo(16.667, 2);
    expect(s.longFrames).toBe(0);
  });

  it('느린 프레임이 섞이면 1% 느린 프레임이 평균보다 크게 떨어진다', () => {
    const d = Array.from({ length: 1000 }, (_, i) => (i % 100 === 0 ? 50 : 1000 / 60));
    const s = computeFrameStats(d);
    expect(s.frames).toBe(1000);
    expect(s.longFrames).toBe(10);
    expect(s.longShare).toBeCloseTo(0.01, 5);
    expect(s.low1Fps).toBeCloseTo(20, 5); // 가장 느린 1%(10개)가 전부 50ms
    expect(s.avgFps).toBeGreaterThan(55);
    expect(s.maxMs).toBe(50);
    expect(s.p99Ms).toBeCloseTo(1000 / 60, 5);
  });

  it('빈 값·잘못된 값은 0으로', () => {
    expect(computeFrameStats([]).avgFps).toBe(0);
    expect(computeFrameStats([NaN, -1, 0]).frames).toBe(0);
  });
});

describe('측정 환경: 실제 휴대폰과 시뮬레이션 구분', () => {
  it('자동화·헤드리스 브라우저는 휴대폰 정보가 있어도 시뮬레이션', () => {
    expect(detectEnvironment({ userAgent: IPHONE, webdriver: true, maxTouchPoints: 5 }).kind).toBe('simulated');
    expect(detectEnvironment({ userAgent: HEADLESS, maxTouchPoints: 0 }).kind).toBe('simulated');
  });

  it('휴대폰 브라우저 + 터치는 휴대폰으로 추정, 터치가 없으면 데스크톱', () => {
    expect(detectEnvironment({ userAgent: ANDROID, maxTouchPoints: 5 }).kind).toBe('mobile');
    expect(detectEnvironment({ userAgent: IPHONE, maxTouchPoints: 0 }).kind).toBe('desktop');
    expect(detectEnvironment({ userAgent: DESKTOP, maxTouchPoints: 0 }).kind).toBe('desktop');
  });

  it('"실제 휴대폰"은 자동 판정이 휴대폰이고 측정자가 확인했을 때만', () => {
    const phone = detectEnvironment({ userAgent: ANDROID, maxTouchPoints: 5 });
    const sim = detectEnvironment({ userAgent: ANDROID, webdriver: true, maxTouchPoints: 5 });
    const desk = detectEnvironment({ userAgent: DESKTOP });
    expect(sourceLabel(phone, 'real-phone').real).toBe(true);
    expect(sourceLabel(phone, 'unset').real).toBe(false);
    expect(sourceLabel(phone, 'unset').text).toContain('미확인');
    expect(sourceLabel(phone, 'not-real').real).toBe(false);
    expect(sourceLabel(sim, 'real-phone').real).toBe(false);
    expect(sourceLabel(sim, 'real-phone').text).toContain('시뮬레이션');
    expect(sourceLabel(desk, 'real-phone').real).toBe(false);
  });

  it('복사 텍스트 맨 위에 측정 출처가 적힌다', () => {
    const r: PerfResult = {
      scene: '꾸준형 200일', quality: 'low', seconds: 30, stats: computeFrameStats(Array(1800).fill(1000 / 60)),
      render: { dpr: 3, resolution: 1, canvasCss: [360, 216], canvasPx: [360, 216], backend: 'webgl' },
      hidden: 0, at: '17:00:00', objects: { fish: 4, plant: 9, rock: 5, symbol: 2 },
    };
    const sim = formatReport([r], detectEnvironment({ userAgent: HEADLESS }), 'unset').split('\n');
    expect(sim[0]).toContain(`엔진 ${ENGINE_VERSION}`);
    expect(sim[1]).toMatch(/^측정 출처: ⚠️ 개발 환경 시뮬레이션/);
    const real = formatReport([r], detectEnvironment({ userAgent: ANDROID, maxTouchPoints: 5 }), 'real-phone');
    expect(real.split('\n')[1]).toBe('측정 출처: ✅ 실제 휴대폰(측정자 확인)');
    expect(real).toContain('꾸준형 200일 · 저사양 모드 · 30초');
    expect(real).toContain('평균 60.0 fps · 1% 느린 프레임 60.0 fps');
    expect(real).toContain('DPR 3 → 렌더링 1');
  });
});

describe('저사양 모드는 그리는 방식만 바꾼다', () => {
  it('해상도 상한: 일반 2, 저사양 1', () => {
    expect(qualityResolution('normal', 3)).toBe(2);
    expect(qualityResolution('normal', 1.5)).toBe(1.5);
    expect(qualityResolution('low', 3)).toBe(1);
    expect(qualityResolution('low', 0.75)).toBe(0.75);
    expect(qualityResolution('low', NaN)).toBe(1);
  });

  it('품질 설정에는 화면 연출 항목만 있다(생물 수·엔진 값 없음)', () => {
    for (const spec of Object.values(QUALITY)) {
      expect(Object.keys(spec).sort()).toEqual(['colorGrade', 'glow', 'maxBubbles', 'maxResolution', 'shimmer']);
    }
  });

  it('엔진 버전과 계산은 그대로다', () => {
    expect(ENGINE_VERSION).toBe('0.2.0');
    expect(TankSession.replay(littlePrinceConfig(), littlePrinceEntries())).toBe(GOLDEN_REPLAY[ENGINE_VERSION]);
  });

  it('측정 장면 3개(어린왕자 14일·꾸준형 100일·200일)는 엔진이 만든 샘플 상태를 그대로 쓴다', () => {
    const suite = runSuite();
    expect(PERF_SCENES.map((s) => s.name)).toEqual(['어린왕자 14일', '꾸준형 100일', '꾸준형 200일']);
    for (const s of PERF_SCENES) {
      const r = suite.runs[s.run]!.find((x) => x.key === s.key)!;
      const f = frameAt(r, s.day);
      expect(f.day, s.name).toBe(s.day);
      expect(f.state.objects.some((o) => o.kind === 'fish'), s.name).toBe(true);
    }
  });
});
