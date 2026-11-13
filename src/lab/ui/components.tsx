import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { AquariumCanvas } from '../../ui/AquariumCanvas';
import type { RenderOptions } from '../../render/AquariumRenderer';
import type { TankState } from '../../engine/types';
import { elementOf } from '../../engine/catalog';
import { fmt, LIFECYCLE_LABEL, moodCompositionDistance } from '../metrics';
import { frameAt } from '../runner';
import { ORIGIN_LABEL, type DataOrigin, type DayFrame, type RunResult } from '../types';
import { stills } from './stills';

// ───────────────────────── 출처 표시 ─────────────────────────

export function OriginBadge({ origin }: { origin: DataOrigin }) {
  return <span className={`origin origin-${origin}`}>{ORIGIN_LABEL[origin]}</span>;
}

// ───────────────────────── 정지 그림 ─────────────────────────

export function Thumb({ frame, onClick, big }: { frame: DayFrame; onClick?: () => void; big?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [err, setErr] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect(); } }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setUrl(null);
    stills.get(frame.state, frame.moss).then((u) => alive && setUrl(u)).catch(() => alive && setErr(true));
    return () => { alive = false; };
  }, [visible, frame]);

  return (
    <button ref={ref} type="button" className={big ? 'thumb big' : 'thumb'} style={{ background: frame.metrics.waterHex }} onClick={onClick}
      aria-label={`${frame.day}일차 어항: 물고기 ${frame.metrics.fish}, 수초 ${frame.metrics.plant}, 수석 ${frame.metrics.rock}, 상징 ${frame.metrics.symbol}, ${frame.metrics.moodName}`}>
      {url ? <img src={url} alt="" /> : <span className="thumb-wait">{err ? '그림 실패' : '그리는 중'}</span>}
      {frame.lifecycle !== 'active' && <span className="thumb-flag">{LIFECYCLE_LABEL[frame.lifecycle]}</span>}
    </button>
  );
}

function dayMarks(r: RunResult, day: number): string {
  return r.events
    .filter((e) => e.day === day)
    .map((e) => (e.level === 'special' ? '★' : e.level === 'finale' ? '◎' : e.isNew ? '+' : '↑'))
    .join('');
}

// ───────────────────────── 갤러리 ─────────────────────────

export interface OpenFrame { run: RunResult; day: number }

export function Gallery({ runs, days, onOpen }: { runs: RunResult[]; days: number[]; onOpen: (o: OpenFrame) => void }) {
  return (
    <div className="gallery-wrap">
      <table className="gallery">
        <thead>
          <tr>
            <th className="sticky-col">어항</th>
            {days.map((d) => <th key={d}>{d}일</th>)}
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.key}>
              <th className="sticky-col row-label">
                <b>{r.label}</b>
                <small>시드 {r.cfg.seed.toString(16).slice(0, 6)}</small>
              </th>
              {days.map((d) => {
                if (d > r.frames.length) return <td key={d} className="empty-cell">-</td>;
                const f = frameAt(r, d);
                const m = f.metrics;
                return (
                  <td key={d}>
                    <Thumb frame={f} onClick={() => onOpen({ run: r, day: d })} />
                    <div className="cap">
                      <span title="물고기/수초/수석/상징">{m.fish}·{m.plant}·{m.rock}·{m.symbol}</span>
                      <span className="marks">{dayMarks(r, d)}{f.moss ? ` 이끼${f.moss}` : ''}</span>
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="legend-line">칸 아래: 물고기·수초·수석·상징 수 · + 새로 생김 · ↑ 자람 · ★ 특별 변화 · ◎ 완성 · 이끼 단계. 그림을 누르면 움직이는 어항과 그날 변화가 열려요.</p>
    </div>
  );
}

// ───────────────────────── 수치표 ─────────────────────────

export function Swatch({ hex }: { hex: string }) {
  return <span className="swatch" style={{ background: hex }} />;
}

export function FinalTable({ runs, day }: { runs: RunResult[]; day?: number }) {
  return (
    <div className="table-wrap">
      <table className="metrics">
        <thead>
          <tr>
            <th>어항</th><th>기록</th><th>물고기</th><th>수초</th><th>수석</th><th>상징</th><th>합계(채움)</th><th>성장 단계</th><th>평균 크기</th>
            <th>물빛 색감</th><th>온도·에너지</th><th>성장</th><th>특별 변화</th><th>상태</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const d = Math.min(day ?? r.frames.length, r.frames.length);
            const f = frameAt(r, d);
            const m = f.metrics;
            const ev = r.events.filter((e) => e.day <= d);
            const sp = ev.filter((e) => e.level === 'special');
            return (
              <tr key={r.key}>
                <td className="name">{r.label}</td>
                <td>{r.frames.slice(0, d).reduce((a, x) => a + x.entries, 0)}</td>
                <td>{m.fish}</td><td>{m.plant}</td><td>{m.rock}</td><td>{m.symbol}</td>
                <td>{m.total} ({m.fillPct}%)</td>
                <td>{m.stage} {m.stageName}</td>
                <td>{m.avgScale}</td>
                <td><Swatch hex={m.waterHex} /> {m.moodName}</td>
                <td>{fmt(m.lightTemp)} · {fmt(m.lightEnergy)}</td>
                <td>{ev.filter((e) => e.level === 'growth').length}</td>
                <td>{sp.length}{sp.length ? ` (${sp.map((e) => e.day).join(', ')}일)` : ''}</td>
                <td>{f.lifecycle !== 'active' ? LIFECYCLE_LABEL[f.lifecycle] : f.moss ? `이끼 ${f.moss}` : '진행 중'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function DailyTable({ run, days }: { run: RunResult; days: number[] }) {
  return (
    <div className="table-wrap">
      <table className="metrics">
        <thead>
          <tr><th>일</th><th>기록</th><th>물·초·석·상</th><th>합계</th><th>단계</th><th>평균 크기</th><th>물빛</th><th>온도·에너지</th><th>조명 이동</th><th>효과</th><th>이끼·상태</th><th>그날 변화</th></tr>
        </thead>
        <tbody>
          {days.filter((d) => d <= run.frames.length).map((d) => {
            const f = frameAt(run, d);
            const m = f.metrics;
            const ev = run.events.filter((e) => e.day === d);
            return (
              <tr key={d}>
                <td>{d}</td>
                <td>{f.entries || ''}</td>
                <td>{m.fish}·{m.plant}·{m.rock}·{m.symbol}</td>
                <td>{m.total}</td>
                <td>{m.stage} {m.stageName}</td>
                <td>{m.avgScale}</td>
                <td><Swatch hex={m.waterHex} /> {m.moodName}</td>
                <td>{fmt(m.lightTemp)} · {fmt(m.lightEnergy)}</td>
                <td>{f.lightUsed ? `${Math.round(f.lightUsed * 100)}%` : ''}</td>
                <td>{m.effects.map((e) => (e === 'fx.lightray' ? '빛줄기' : '별')).join('·')}</td>
                <td>{[f.moss ? `이끼 ${f.moss}` : '', f.lifecycle !== 'active' ? LIFECYCLE_LABEL[f.lifecycle] : ''].filter(Boolean).join(' · ')}</td>
                <td className="events">{ev.map((e, i) => <div key={i} className={`ev ev-${e.level}`}>{e.text}</div>)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 마지막 날 어항끼리의 차이(물빛+구성, 0~1) */
export function DistanceMatrix({ runs, day }: { runs: RunResult[]; day?: number }) {
  const states = runs.map((r) => frameAt(r, Math.min(day ?? r.frames.length, r.frames.length)).state);
  return (
    <div className="table-wrap">
      <table className="matrix">
        <thead><tr><th />{runs.map((r) => <th key={r.key}>{r.label}</th>)}</tr></thead>
        <tbody>
          {runs.map((r, i) => (
            <tr key={r.key}>
              <th>{r.label}</th>
              {runs.map((q, j) => {
                const v = i === j ? 0 : moodCompositionDistance(states[i]!, states[j]!);
                return <td key={q.key} style={{ background: `rgba(14,116,144,${Math.min(0.85, v * 1.2)})`, color: v > 0.45 ? '#fff' : undefined }}>{i === j ? '—' : fmt(v)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="legend-line">차이 = (물빛 차이 + 요소 구성 차이) ÷ 2. 0이면 같은 분위기·구성, 1이면 전혀 다름. 배치(위치)는 빼고 봐요.</p>
    </div>
  );
}

// ───────────────────────── 움직이는 어항 보기 ─────────────────────────

function useFps(active: boolean): number {
  const [fps, setFps] = useState(0);
  useEffect(() => {
    if (!active) return;
    let frames = 0;
    let last = performance.now();
    let raf = 0;
    const loop = (t: number) => {
      frames++;
      if (t - last >= 1000) { setFps(Math.round((frames * 1000) / (t - last))); frames = 0; last = t; }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return fps;
}

export function FrameModal({ open, onClose }: { open: OpenFrame | null; onClose: () => void }) {
  const [day, setDay] = useState(open?.day ?? 1);
  useEffect(() => { if (open) setDay(open.day); }, [open]);
  const fps = useFps(!!open);
  const run = open?.run;
  const frame = run ? frameAt(run, day) : null;
  const options = useMemo<RenderOptions>(() => ({ mossStage: frame?.moss ?? 0, reducedMotion: false }), [frame?.moss]);
  if (!open || !run || !frame) return null;
  const state: TankState = frame.state;
  const m = frame.metrics;
  const ev = run.events.filter((e) => e.day === day);
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="frame-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`${run.label} ${day}일차`}>
        <div className="row spread">
          <div>
            <OriginBadge origin={run.origin} />
            <h2 style={{ margin: '6px 0 0' }}>{run.label} · {day}일차 ({frame.date})</h2>
          </div>
          <button onClick={onClose}>닫기</button>
        </div>
        <AquariumCanvas state={state} options={options} />
        <div className="row spread">
          <div className="row">
            <button onClick={() => setDay((d) => Math.max(1, d - 1))} disabled={day <= 1}>◀ 전날</button>
            <input type="range" min={1} max={run.frames.length} value={day} onChange={(e) => setDay(Number(e.target.value))} aria-label="날짜" />
            <button onClick={() => setDay((d) => Math.min(run.frames.length, d + 1))} disabled={day >= run.frames.length}>다음 날 ▶</button>
          </div>
          <span className="hint" style={{ margin: 0 }}>화면 {fps}fps (이 기기 기준 · H8 실기기 측정용)</span>
        </div>
        <div className="modal-grid">
          <dl className="kv">
            <dt>기록</dt><dd>그날 {frame.entries}번 · 진행 {frame.progress || '-'}</dd>
            <dt>구성</dt><dd>물고기 {m.fish} · 수초 {m.plant} · 수석 {m.rock} · 상징 {m.symbol} (합계 {m.total}, {m.fillPct}%)</dd>
            <dt>성장 단계</dt><dd>{m.stage} {m.stageName} · 평균 크기 {m.avgScale} · 최대 {m.maxScale}</dd>
            <dt>물빛</dt><dd><Swatch hex={m.waterHex} /> {m.moodName} (온도 {fmt(m.lightTemp)}, 에너지 {fmt(m.lightEnergy)})</dd>
            <dt>물고기 행동</dt><dd>속도 ×{m.speed} · 깊이 {fmt(m.depth)}</dd>
            <dt>상태</dt><dd>{LIFECYCLE_LABEL[frame.lifecycle]}</dd>
            <dt>효과 · 이끼</dt><dd>{m.effects.map((e) => (e === 'fx.lightray' ? '빛줄기' : '밝은 별')).join(', ') || '없음'} · 이끼 {frame.moss}</dd>
          </dl>
          <div>
            <h3>그날 일어난 일</h3>
            {frame.changes.length === 0 ? <p className="hint">기록이 없던 날이에요.</p> : (
              <ul className="change-list">
                {frame.changes.map((c, i) => <li key={i} className={`ev ev-${c.level}`}>{c.text}</li>)}
              </ul>
            )}
            {ev.length > 0 && <p className="hint">주요 변화: {ev.map((e) => (e.el ? elementOf(run.cfg.themeId, e.el)?.name ?? e.el : '빛 효과')).join(', ')}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── 선 그래프(장기) ─────────────────────────

export interface Series { name: string; color: string; values: number[] }

/**
 * 단일 y축 선 그래프. 2px 선, 옅은 격자, 범례 + 끝점 이름표, 마우스를 올리면 그날 값.
 * 색은 dataviz 기준 팔레트(범주 1~4번)를 순서대로 쓴다.
 */
export function LineChart({ title, series, yMin, yMax, markers = [], unit = '' }: { title: string; series: Series[]; yMin: number; yMax: number; markers?: Array<{ day: number; label: string }>; unit?: string }) {
  const W = 640;
  const H = 200;
  const pad = { l: 34, r: 74, t: 12, b: 24 };
  const n = series[0]?.values.length ?? 0;
  const x = (i: number) => pad.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - pad.t - pad.b);
  const [hover, setHover] = useState<number | null>(null);
  const ticks = [yMin, (yMin + yMax) / 2, yMax];
  // 끝점 이름표가 겹치지 않게 위에서부터 최소 13px 간격으로 밀어낸다
  const endLabels = series
    .map((s) => ({ name: s.name, y: n > 0 ? y(s.values[n - 1]!) + 4 : 0 }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < endLabels.length; i++) endLabels[i]!.y = Math.max(endLabels[i]!.y, endLabels[i - 1]!.y + 13);
  const labelY = new Map(endLabels.map((l) => [l.name, l.y]));
  const xticks = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => v >= 0 && a.indexOf(v) === i);
  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (n - 1));
    setHover(i >= 0 && i < n ? i : null);
  };
  return (
    <figure className="chart">
      <figcaption>{title}</figcaption>
      <div className="chart-legend">
        {series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}
        {markers.length > 0 && <span><i className="marker-key" />특별 변화</span>}
      </div>
      <div className="chart-box">
        <svg viewBox={`0 0 ${W} ${H}`} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label={title}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid-line" />
              <text x={pad.l - 6} y={y(t) + 4} className="axis-text" textAnchor="end">{Number.isInteger(t) ? t : t.toFixed(1)}</text>
            </g>
          ))}
          {xticks.map((i) => <text key={i} x={x(i)} y={H - 6} className="axis-text" textAnchor="middle">{i + 1}일</text>)}
          {markers.map((mk) => (
            <circle key={mk.day} cx={x(mk.day - 1)} cy={H - pad.b} r={4} className="marker"><title>{mk.day}일 {mk.label}</title></circle>
          ))}
          {series.map((s) => (
            <g key={s.name}>
              <polyline fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
              {series.length <= 4 && n > 0 && <text x={x(n - 1) + 6} y={labelY.get(s.name)} className="end-label">{s.name}</text>}
            </g>
          ))}
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} className="crosshair" />
              {series.map((s) => <circle key={s.name} cx={x(hover)} cy={y(s.values[hover]!)} r={4} fill={s.color} stroke="#fff" strokeWidth={2} />)}
            </g>
          )}
        </svg>
        {hover !== null && (
          <div className="tooltip" style={{ left: `${(x(hover) / W) * 100}%` }}>
            <b>{hover + 1}일</b>
            {series.map((s) => <div key={s.name}><i style={{ background: s.color }} />{s.name} {fmt(s.values[hover]!, Number.isInteger(s.values[hover]) ? 0 : 2)}{unit}</div>)}
            {markers.filter((m) => m.day === hover + 1).map((m) => <div key={m.label}>★ {m.label}</div>)}
          </div>
        )}
      </div>
    </figure>
  );
}

export const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'] as const;
