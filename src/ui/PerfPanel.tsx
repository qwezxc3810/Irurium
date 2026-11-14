import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import './perf.css';
import type { AquariumCanvasHandle } from './AquariumCanvas';
import { QUALITY_LABEL, type RenderQuality } from '../render/quality';
import { currentEnvironment, sourceLabel, type Declared } from '../perf/env';
import { computeFrameStats, FrameMeter, type FrameStats } from '../perf/frameStats';
import { formatReport, type PerfResult } from '../perf/report';

/**
 * 성능 측정 패널(개발·검증 환경 전용). 일반 사용자 화면에는 붙이지 않는다(perfEnabled 참고).
 * 렌더러와 따로 requestAnimationFrame 간격을 재고, 렌더링 품질만 바꿔 같은 어항을 비교한다.
 */

export const MEASURE_SECONDS = 30;

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

export function PerfPanel({ canvas, scene, quality, onQuality, results, onResult, onClear }: Props) {
  const env = useMemo(() => currentEnvironment(), []);
  const [declared, setDeclared] = useState<Declared>('unset');
  const meter = useRef(new FrameMeter(2000));
  const [live, setLive] = useState<FrameStats | null>(null);
  const [info, setInfo] = useState<ReturnType<AquariumCanvasHandle['renderInfo']>>(null);
  const [run, setRun] = useState<{ start: number; scene: string; quality: RenderQuality } | null>(null);
  const [left, setLeft] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);
  const src = sourceLabel(env, declared);

  useEffect(() => {
    const m = meter.current;
    m.start();
    const id = window.setInterval(() => {
      setLive(computeFrameStats(m.recent()));
      setInfo(canvas.current?.renderInfo() ?? null);
    }, 500);
    return () => { window.clearInterval(id); m.stop(); };
  }, [canvas]);

  // 측정 중 장면·품질을 바꾸면 그 측정은 버린다(섞인 값이 되지 않게)
  useEffect(() => {
    if (run && (run.scene !== scene || run.quality !== quality)) setRun(null);
  }, [scene, quality, run]);

  useEffect(() => {
    if (!run) return;
    const id = window.setInterval(() => {
      const elapsed = (performance.now() - run.start) / 1000;
      setLeft(Math.max(0, Math.ceil(MEASURE_SECONDS - elapsed)));
      if (elapsed < MEASURE_SECONDS) return;
      window.clearInterval(id);
      const m = meter.current;
      const ri = canvas.current?.renderInfo();
      onResult({
        scene: run.scene, quality: run.quality, seconds: MEASURE_SECONDS,
        stats: computeFrameStats(m.all()),
        render: ri
          ? { dpr: ri.dpr, resolution: ri.resolution, canvasCss: ri.canvasCss, canvasPx: ri.canvasPx, backend: ri.backend }
          : { dpr: window.devicePixelRatio || 1, resolution: 0, canvasCss: [0, 0], canvasPx: [0, 0], backend: '알 수 없음' },
        hidden: m.hidden,
        at: new Date().toLocaleTimeString('ko-KR', { hour12: false }),
        objects: ri ? ri.drawn : { fish: 0, plant: 0, rock: 0, symbol: 0 },
      });
      setRun(null);
    }, 250);
    return () => window.clearInterval(id);
  }, [run, canvas, onResult]);

  const startRun = () => {
    meter.current.reset();
    setLeft(MEASURE_SECONDS);
    setRun({ start: performance.now(), scene, quality });
  };

  const report = formatReport(results, env, declared);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied('복사했어요');
    } catch {
      setCopied('자동 복사가 막혀 있어요. 아래 글상자를 길게 눌러 직접 복사해 주세요');
    }
    window.setTimeout(() => setCopied(null), 4000);
  };

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

      <div className="perf-grid">
        <div><b>{f1(live?.avgFps ?? NaN)}</b><span>평균 FPS(최근 2초)</span></div>
        <div><b>{f1(live?.low1Fps ?? NaN)}</b><span>1% 느린 프레임 FPS</span></div>
        <div><b>{f1(live?.meanMs ?? NaN)}<small>ms</small></b><span>프레임 지연 평균 · 99% {f1(live?.p99Ms ?? NaN)}ms</span></div>
        <div><b>{info ? `${info.dpr}→${info.resolution}` : '-'}</b><span>DPR → 렌더링 해상도</span></div>
      </div>
      {info && (
        <p className="perf-hint">캔버스 {info.canvasCss.join('×')} (실제 픽셀 {info.canvasPx.join('×')}) · {info.backend} · 그리는 생물: 물고기 {info.drawn.fish} · 수초 {info.drawn.plant} · 수석 {info.drawn.rock} · 상징 {info.drawn.symbol}</p>
      )}

      <div className="perf-row">
        <button type="button" onClick={startRun} disabled={!!run}>{run ? `측정 중… ${left}초` : `${MEASURE_SECONDS}초 측정`}</button>
        <span className="perf-hint">{scene} · {QUALITY_LABEL[quality]} 모드. 측정 중에는 화면을 끄거나 다른 앱으로 넘어가지 마세요(장면·모드를 바꾸면 측정이 취소돼요).</span>
      </div>

      <fieldset className="perf-env">
        <legend>측정 기기</legend>
        <p className="perf-hint">자동 판정: {env.kind === 'mobile' ? '휴대폰' : env.kind === 'simulated' ? '시뮬레이션(자동화·헤드리스)' : '데스크톱'} — {env.reasons.join(', ')}</p>
        <div className="perf-row">
          <label><input type="radio" name="perf-declared" checked={declared === 'real-phone'} onChange={() => setDeclared('real-phone')} /> 실제 휴대폰에서 재고 있어요</label>
          <label><input type="radio" name="perf-declared" checked={declared === 'not-real'} onChange={() => setDeclared('not-real')} /> 아니에요(PC·개발자 도구 흉내)</label>
        </div>
        <p className={src.real ? 'perf-src-line real' : 'perf-src-line sim'}>측정 출처: {src.text}</p>
      </fieldset>

      {results.length > 0 && (
        <>
          <div className="perf-row">
            <button type="button" onClick={copy}>결과 텍스트 복사</button>
            {onClear && <button type="button" onClick={onClear}>결과 지우기</button>}
            {copied && <span className="perf-hint">{copied}</span>}
          </div>
          <textarea className="perf-text" readOnly value={report} rows={Math.min(24, 6 + results.length * 5)} onFocus={(e) => e.currentTarget.select()} />
        </>
      )}
    </section>
  );
}
