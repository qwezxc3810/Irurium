import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION } from '../../engine/config';
import { GOLDEN_REPLAY } from '../../engine/__tests__/golden';
import { littlePrinceConfig, littlePrinceEntries } from '../../engine/scenarios';
import { TankSession } from '../../engine/session';
import { frameAt, runSuite } from '../../lab/runner';
import { PERF_SCENES } from '../../lab/perfScenes';
import { QUALITY, qualityResolution } from '../../render/quality';
import { detectEnvironment, guessBrowser, sourceLabel } from '../env';
import rendererSource from '../../render/AquariumRenderer.ts?raw';
import { computeFrameStats, FrameRecorder } from '../frameStats';
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

  it('복사 텍스트: 맨 위 측정 출처, 어항 FPS가 1차 지표, rAF는 진단으로 따로', () => {
    const r: PerfResult = {
      scene: '꾸준형 200일', quality: 'low', plannedSeconds: 30, measuredMs: 30140, warmupMs: 2000,
      aquarium: computeFrameStats(Array(900).fill(1000 / 30)), raf: computeFrameStats(Array(1800).fill(1000 / 60)),
      render: { dpr: 3, resolution: 1, canvasCss: [360, 216], canvasPx: [360, 216], backend: 'webgl' },
      invalid: null, frameLimit: 0, gaps: 0, at: '17:00:00', objects: { fish: 4, plant: 9, rock: 5, symbol: 2 },
    };
    const sim = formatReport([r], detectEnvironment({ userAgent: HEADLESS }), 'unset').split('\n');
    expect(sim[0]).toContain(`엔진 ${ENGINE_VERSION}`);
    expect(sim[1]).toMatch(/^측정 출처: ⚠️ 개발 환경 시뮬레이션/);
    const real = formatReport([r], detectEnvironment({ userAgent: ANDROID, maxTouchPoints: 5 }), 'real-phone');
    expect(real.split('\n')[1]).toBe('측정 출처: ✅ 실제 휴대폰(측정자 확인)');
    expect(real).toContain('꾸준형 200일 · 저사양 모드 · 실측 30.1초(워밍업 2초 뒤)');
    expect(real).toContain('어항 FPS(PixiJS 렌더링 프레임) 평균 30.0 · 1% 느린 프레임 30.0');
    expect(real).toContain('[진단] 브라우저 갱신 간격(rAF, 어항 성능 아님) 평균 60.0fps');
    expect(real).toContain('DPR 3 → 렌더링 1');
    expect(real).not.toContain('무효');
    const bad = formatReport([{ ...r, invalid: '측정 중 화면이 숨겨졌어요', frameLimit: 15 }], detectEnvironment({ userAgent: DESKTOP }), 'unset');
    expect(bad).toContain('⚠️ 무효(참고용): 측정 중 화면이 숨겨졌어요');
    expect(bad).toContain('진단용 어항 갱신 제한: 15fps 제한');
    const cond = formatReport([r], detectEnvironment({ userAgent: ANDROID, maxTouchPoints: 5 }), 'real-phone', { model: '갤럭시 A15', browser: '삼성 인터넷 27', powerSaving: 'off', brightness: '자동' });
    expect(cond).toContain('측정 조건(측정자 기록): 기종 갤럭시 A15 · 브라우저 삼성 인터넷 27 · 절전 모드 끔 · 화면 밝기 자동');
    expect(formatReport([r], detectEnvironment({ userAgent: DESKTOP }), 'unset')).toContain('기종 안 적음 · 브라우저 안 적음 · 절전 모드 모름 · 화면 밝기 안 적음');
  });

  it('브라우저 이름 추정(인앱 브라우저 먼저)', () => {
    expect(guessBrowser(ANDROID)).toBe('크롬 130');
    expect(guessBrowser(IPHONE)).toBe('사파리 18');
    expect(guessBrowser('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0 Mobile Safari/537.36')).toBe('삼성 인터넷 27');
    expect(guessBrowser(ANDROID + ' KAKAOTALK 10.8.0')).toBe('카카오톡 인앱');
    expect(guessBrowser('unknown')).toBe('');
    // 실측(2026-11-16, 갤럭시 Z 폴드7)에서 '크롬 157'로 잘못 채워졌던 브라우저 정보
    const claudeWv = 'Mozilla/5.0 (Linux; Android 10; K; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/157.0.0.0 Mobile Safari/537.36 Claude/1.261113.19';
    expect(guessBrowser(claudeWv)).toBe('Claude 앱 웹뷰');
    expect(guessBrowser(claudeWv.replace(/ Claude\/[\d.]+/, ''))).toBe('안드로이드 웹뷰(앱 안 브라우저)');
  });
});

describe('프레임 기록기', () => {
  it('측정 구간(시작~끝) 안에서 끝난 간격만 꺼낸다(타이머가 늦어도 구간 밖은 빠짐)', () => {
    const rec = new FrameRecorder();
    for (let t = 0; t <= 2000; t += 20) rec.mark(t);
    const d = rec.between(500, 1500);
    expect(d.length).toBe(50);
    expect(d.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it('pause() 뒤 첫 간격은 버린다(숨김 구간이 섞이지 않음), 1초 넘는 간격은 gaps로', () => {
    const rec = new FrameRecorder();
    rec.mark(0); rec.mark(16); rec.pause(); rec.mark(600); rec.mark(616);
    expect(rec.between(0, 1000)).toEqual([16, 16]);
    rec.mark(3000);
    expect(rec.gaps).toBe(1);
    // 측정 구간 안에서 멈춘 횟수만 센다
    expect(rec.gapsBetween(0, 2000)).toBe(0);
    expect(rec.gapsBetween(2000, 3500)).toBe(1);
  });
});

describe('어항 FPS와 브라우저 rAF 분리', () => {
  /** PixiJS Ticker처럼 maxFPS면 최소 간격이 지나야 갱신, 멈추면 갱신 없음 */
  function simulate(maxFps: number, stopped: boolean) {
    const aq = new FrameRecorder();
    const raf = new FrameRecorder();
    let lastTick = -Infinity;
    const minGap = maxFps > 0 ? 1000 / maxFps : 0;
    for (let i = 0; i <= 60 * 10; i++) {
      const t = i * (1000 / 60);
      raf.mark(t); // 브라우저 갱신은 늘 60Hz
      if (stopped) continue;
      if (t - lastTick + 0.5 >= minGap) { lastTick = t; aq.mark(t); } // 어항은 그린 프레임만
    }
    return { aq: computeFrameStats(aq.between(0, 10000)), raf: computeFrameStats(raf.between(0, 10000)) };
  }

  it('어항 갱신을 30fps로 제한하면 어항 FPS만 줄고 rAF는 그대로', () => {
    const free = simulate(0, false);
    const capped = simulate(30, false);
    expect(free.aq.avgFps).toBeCloseTo(60, 0);
    expect(capped.aq.avgFps).toBeCloseTo(30, 0);
    expect(capped.raf.avgFps).toBeCloseTo(60, 0);
  });

  it('어항이 멈추면 어항 프레임 0개, rAF는 그대로', () => {
    const stopped = simulate(0, true);
    expect(stopped.aq.frames).toBe(0);
    expect(stopped.raf.avgFps).toBeCloseTo(60, 0);
  });

  it('렌더러가 PixiJS 그리기(LOW) 뒤 UTILITY 우선순위에서 어항 프레임을 기록한다', () => {
    expect(rendererSource).toMatch(/ticker\.add\(\(\) => this\.renderFrames\.mark\(performance\.now\(\)\), undefined, UPDATE_PRIORITY\.UTILITY\)/);
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
