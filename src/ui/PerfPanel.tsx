import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import './perf.css';
import type { AquariumCanvasHandle } from './AquariumCanvas';
import { QUALITY_LABEL, type RenderQuality } from '../render/quality';
import { currentEnvironment, guessBrowser, sourceLabel, type Declared } from '../perf/env';
import { computeFrameStats, RafMeter, type FrameStats } from '../perf/frameStats';
import { EMPTY_CONDITIONS, formatReport, limitLabel, type MeasureConditions, type PerfResult } from '../perf/report';

/**
 * 성능 측정 패널(개발·검증 환경 전용). 일반 사용자 화면에는 붙이지 않는다(perfEnabled 참고).
 * 1차 지표는 어항 FPS(PixiJS가 실제로 그린 프레임). 독립 requestAnimationFrame 간격은 진단용으로만 따로 보여 준다.
 */

export const MEASURE_SECONDS = 30;
export const WARMUP_MS = 2000;
const LIVE_WINDOW_MS = 2000;
const LIMITS = [0, 30, 15, -1];

/** 앱 화면에서 패널을 보일지: 개발 서버(npm run dev)이거나 주소에 ?perf=1 */
export function perfEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  try { return new URLSearchParams(window.location.search).get('perf') === '1'; } catch { return false; }
}

const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '-');


interface Props {
  canvas: RefObject<AquariumCanvasHandle | null>;
  scene: string;
  quality: RenderQuality;
  onQuality: (q: RenderQuality) => void;
  results: PerfResult[];
  onResult: (r: PerfResult) => void;
  onClear?: () => void;
}

interface Run {
  phase: 'warmup' | 'measure';
  clicked: number;
  start: number;
  scene: string;
  quality: RenderQuality;
  limit: number;
  hidden: boolean;
}

export function PerfPanel({ canvas, scene, quality, onQuality, results, onResult, onClear }: Props) {
  const env = useMemo(() => currentEnvironment(), []);
  const [declared, setDeclared] = useState<Declared>('unset');
  const [cond, setCond] = useState<MeasureConditions>(() => ({ ...EMPTY_CONDITIONS, browser: guessBrowser(navigator.userAgent) }));
  const raf = useRef(new RafMeter());
  const [live, setLive] = useState<{ aq: FrameStats; raf: FrameStats } | null>(null);
  const [info, setInfo] = useState<ReturnType<AquariumCanvasHandle['renderInfo']>>(null);
  const [run, setRun] = useState<Run | null>(null);
  const runRef = useRef<Run | null>(null);
  runRef.current = run;
  const [left, setLeft] = useState(0);
  const [limit, setLimit] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);
  const src = sourceLabel(env, declared);

  useEffect(() => {
    const m = raf.current;
    m.start();
    const id = window.setInterval(() => {
      const now = performance.now();
      const aq = canvas.current?.renderFrames();
      setLive({ aq: computeFrameStats(aq ? aq.recent(LIVE_WINDOW_MS, now) : []), raf: computeFrameStats(m.rec.recent(LIVE_WINDOW_MS, now)) });
      setInfo(canvas.current?.renderInfo() ?? null);
    }, 500);
    return () => { window.clearInterval(id); m.stop(); };
  }, [canvas]);

  // 화면이 숨겨지면 두 기록기 모두 끊고, 진행 중 측정은 무효(참고용)로 표시한다
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'hidden') return;
      raf.current.rec.pause();
      canvas.current?.renderFrames()?.pause();
      if (runRef.current) setRun({ ...runRef.current, hidden: true });
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [canvas]);

  // 진단용 갱신 제한을 렌더러에 전달(장면이 바뀌어 새 렌더러가 생겨도 다시 적용)
  useEffect(() => {
    canvas.current?.setFrameLimit(limit);
    const id = window.setTimeout(() => canvas.current?.setFrameLimit(limit), 1500);
    return () => window.clearTimeout(id);
  }, [limit, scene, canvas]);

  // 측정 중 장면·품질·제한을 바꾸면 그 측정은 버린다(섞인 값이 되지 않게)
  useEffect(() => {
    if (run && (run.scene !== scene || run.quality !== quality || run.limit !== limit)) setRun(null);
  }, [scene, quality, limit, run]);

  useEffect(() => {
    if (!run) return;
    const id = window.setInterval(() => {
      const now = performance.now();
      if (run.phase === 'warmup') {
        setLeft(MEASURE_SECONDS);
        if (now - run.clicked >= WARMUP_MS) setRun({ ...run, phase: 'measure', start: now });
        return;
      }
      const elapsed = now - run.start;
      setLeft(Math.max(0, Math.ceil(MEASURE_SECONDS - elapsed / 1000)));
      if (elapsed < MEASURE_SECONDS * 1000) return;
      window.clearInterval(id);
      // 측정 구간은 시작~끝 시각. 타이머가 늦게 돌아도 실측 길이를 그대로 적는다
      const end = now;
      const aqRec = canvas.current?.renderFrames();
      const ri = canvas.current?.renderInfo();
      const aq = computeFrameStats(aqRec ? aqRec.between(run.start, end) : []);
      const stalls = aqRec ? aqRec.gapsBetween(run.start, end) : 0;
      onResult({
        scene: run.scene, quality: run.quality,
        plannedSeconds: MEASURE_SECONDS, measuredMs: end - run.start, warmupMs: WARMUP_MS,
        aquarium: aq,
        raf: computeFrameStats(raf.current.rec.between(run.start, end)),
        render: ri
          ? { dpr: ri.dpr, resolution: ri.resolution, canvasCss: ri.canvasCss, canvasPx: ri.canvasPx, backend: ri.backend }
          : { dpr: window.devicePixelRatio || 1, resolution: 0, canvasCss: [0, 0], canvasPx: [0, 0], backend: '알 수 없음' },
        invalid: run.hidden ? '측정 중 화면이 숨겨졌어요(다른 앱·화면 꺼짐). 숨김 구간은 뺐지만 다시 재 주세요'
          : aq.frames === 0 ? '어항 프레임이 기록되지 않았어요'
          : stalls > 0 ? `화면이 보이는 동안 어항이 1초 넘게 멈춘 구간이 ${stalls}번 있었어요. 그 간격은 FPS 계산에서 빠져서 실제보다 좋게 나올 수 있어요` : null,
        frameLimit: run.limit,
        gaps: stalls,
        at: new Date().toLocaleTimeString('ko-KR', { hour12: false }),
        objects: ri ? ri.drawn : { fish: 0, plant: 0, rock: 0, symbol: 0 },
      });
      setRun(null);
    }, 200);
    return () => window.clearInterval(id);
  }, [run, canvas, onResult]);

  const startRun = () => {
    const now = performance.now();
    setLeft(MEASURE_SECONDS);
    setRun({ phase: 'warmup', clicked: now, start: 0, scene, quality, limit, hidden: false });
  };

  const report = formatReport(results, env, declared, cond);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied('복사했어요');
    } catch {
      setCopied('자동 복사가 막혀 있어요. 아래 글상자를 길게 눌러 직접 복사해 주세요');
    }
    window.setTimeout(() => setCopied(null), 4000);
  };

  const runLabel = !run ? `${MEASURE_SECONDS}초 측정` : run.phase === 'warmup' ? '준비 중(2초)…' : `측정 중… ${left}초`;

  return (
    <section className="perf-panel" aria-label="성능 측정 패널">
      <div className="perf-head">
        <strong>성능 측정</strong>
        <span className={src.real ? 'perf-src real' : 'perf-src sim'}>{src.real ? '실제 휴대폰' : '시뮬레이션·미확인'}</span>
        <span className="perf-note">개발·검증용 화면이에요</span>
      </div>

      <div className="perf-row">
        <span>모드</span>
        {(['normal', 'low'] as RenderQuality[]).map((q) => (
          <button key={q} type="button" className={q === quality ? 'chip on' : 'chip'} onClick={() => onQuality(q)} aria-pressed={q === quality}>{QUALITY_LABEL[q]}</button>
        ))}
        <span className="perf-hint">저사양: 렌더링 해상도 1 · 색 보정 필터 대신 덧칠 · 가산 빛 끔 · 기포 8개 · 반짝임 끔 (엔진·생물 수는 그대로)</span>
      </div>

      <p className="perf-hint"><b>어항 FPS</b>는 PixiJS가 어항을 실제로 그린 프레임으로 재요(최근 2초).</p>
      <div className="perf-grid">
        <div><b>{f1(live?.aq.avgFps ?? NaN)}</b><span>어항 FPS 평균</span></div>
        <div><b>{f1(live?.aq.low1Fps ?? NaN)}</b><span>어항 1% 느린 프레임 FPS</span></div>
        <div><b>{f1(live?.aq.meanMs ?? NaN)}<small>ms</small></b><span>어항 프레임 지연 평균 · 99% {f1(live?.aq.p99Ms ?? NaN)}ms</span></div>
        <div><b>{info ? `${info.dpr}→${info.resolution}` : '-'}</b><span>DPR → 렌더링 해상도</span></div>
      </div>
      <p className="perf-hint perf-diag">[진단] 브라우저 갱신 간격(rAF): {f1(live?.raf.avgFps ?? NaN)}fps — 어항이 그린 횟수가 아니라 브라우저 화면 갱신 간격이에요. 성능 판정에 쓰지 않아요.</p>
      {info && (
        <p className="perf-hint">캔버스 {info.canvasCss.join('×')} (실제 픽셀 {info.canvasPx.join('×')}) · {info.backend} · 그리는 생물: 물고기 {info.drawn.fish} · 수초 {info.drawn.plant} · 수석 {info.drawn.rock} · 상징 {info.drawn.symbol}</p>
      )}

      <div className="perf-row">
        <button type="button" onClick={startRun} disabled={!!run}>{runLabel}</button>
        <span className="perf-hint">{scene} · {QUALITY_LABEL[quality]} 모드. 2초 준비 뒤 30초를 재요. 측정 중에는 화면을 끄거나 다른 앱으로 넘어가지 마세요(넘어가면 무효로 표시, 장면·모드를 바꾸면 취소).</span>
      </div>

      <div className="perf-row">
        <span className="perf-hint">[진단] 어항 갱신 제한</span>
        {LIMITS.map((n) => (
          <button key={n} type="button" className={n === limit ? 'chip on' : 'chip'} onClick={() => setLimit(n)} aria-pressed={n === limit}>{limitLabel(n)}</button>
        ))}
        <span className="perf-hint">측정기가 어항 FPS를 제대로 잡는지 확인용. 평소에는 "제한 없음"으로 재요.</span>
      </div>

      <fieldset className="perf-env">
        <legend>측정 기기</legend>
        <p className="perf-hint">자동 판정: {env.kind === 'mobile' ? '휴대폰' : env.kind === 'simulated' ? '시뮬레이션(자동화·헤드리스)' : '데스크톱'} — {env.reasons.join(', ')}</p>
        <div className="perf-row">
          <label><input type="radio" name="perf-declared" checked={declared === 'real-phone'} onChange={() => setDeclared('real-phone')} /> 실제 휴대폰에서 재고 있어요</label>
          <label><input type="radio" name="perf-declared" checked={declared === 'not-real'} onChange={() => setDeclared('not-real')} /> 아니에요(PC·개발자 도구 흉내)</label>
        </div>
        <p className={src.real ? 'perf-src-line real' : 'perf-src-line sim'}>측정 출처: {src.text}</p>
        <div className="perf-cond">
          <label>기종 <input value={cond.model} placeholder="예: 갤럭시 A15" onChange={(e) => setCond({ ...cond, model: e.target.value })} /></label>
          <label>브라우저 <input value={cond.browser} placeholder="예: 삼성 인터넷" onChange={(e) => setCond({ ...cond, browser: e.target.value })} /></label>
          <label>절전 모드 <select value={cond.powerSaving} onChange={(e) => setCond({ ...cond, powerSaving: e.target.value as MeasureConditions['powerSaving'] })}><option value="unknown">모름</option><option value="off">끔</option><option value="on">켬</option></select></label>
          <label>화면 밝기 <input value={cond.brightness} placeholder="예: 자동, 50%" onChange={(e) => setCond({ ...cond, brightness: e.target.value })} /></label>
        </div>
        <p className="perf-hint">같은 조건끼리 비교하려고 적어요. 결과 텍스트에 같이 들어가요.</p>
      </fieldset>

      {results.length > 0 && (
        <>
          <div className="perf-row">
            <button type="button" onClick={copy}>결과 텍스트 복사</button>
            {onClear && <button type="button" onClick={onClear}>결과 지우기</button>}
            {copied && <span className="perf-hint">{copied}</span>}
          </div>
          <textarea className="perf-text" readOnly value={report} rows={Math.min(28, 6 + results.length * 6)} onFocus={(e) => e.currentTarget.select()} />
        </>
      )}
    </section>
  );
}
