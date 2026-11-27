import { useEffect, useRef } from 'react';
import { ASSET_BASE } from '../assets/manifest';
import { GUIDE, stageScaleFor, type TraceNotice } from './encyclopedia';

/** 흔적이 생기거나 자란 순간의 짧은 안내. 변화 카드 맨 위에 붙는다 */
export function TraceNotices({ notices, onMemory, onGuide }: { notices: TraceNotice[]; onMemory: (objectId: string) => void; onGuide: (symbolId: string) => void }) {
  if (notices.length === 0) return null;
  return (
    <div className="trace-notices">
      {notices.map((n) => (
        <div key={n.objectId} className="trace-notice">
          <img src={`${ASSET_BASE}${n.guide.src}`} alt="" width={48} height={48} />
          <div className="trace-notice-body">
            <b>{n.headline}</b>
            {n.kind === 'grown' && <span className="hint"> · {n.stage}단계</span>}
            <p className="hint">{n.guide.meaning}</p>
            <div className="row tight">
              <button type="button" className="link" onClick={() => onMemory(n.objectId)}>기억 보기</button>
              <button type="button" className="link" onClick={() => onGuide(n.guide.symbolId)}>감정 도감</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * 감정 도감: 12가지 마음과 그 흔적. 외우라고 묻지 않고, 필요할 때 펼쳐 보는 곳.
 * 그림은 지금 어항 폭 기준의 '1단계 실제 크기'로 보여 준다(자라면 단계마다 조금씩 커짐).
 */
export function EmotionGuide({ counts, canvasWidth, focus, onClose }: { counts: Record<string, number>; canvasWidth: number; focus?: string | null; onClose: () => void }) {
  const k = stageScaleFor(canvasWidth);
  const ref = useRef<HTMLElement>(null);
  const box = Math.round(Math.max(...GUIDE.map((g) => g.displayHeight)) * k) + 8;
  useEffect(() => {
    const el = focus ? ref.current?.querySelector(`[data-symbol="${focus}"]`) : ref.current;
    el?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [focus]);
  return (
    <section className="card guide" aria-label="감정 도감" ref={ref}>
      <div className="memory-head">
        <h2>감정 도감</h2>
        <button type="button" className="ghost" onClick={onClose} aria-label="닫기">닫기</button>
      </div>
      <p className="hint">기록에 고른 첫 번째 마음(대표)이 쪽수만큼 모이면 이런 흔적이 어항에 남아요. 그림은 지금 화면에서의 실제 크기예요.</p>
      <ul className="guide-grid">
        {GUIDE.map((g) => {
          const h = Math.round(g.displayHeight * k);
          const n = counts[g.symbolId] ?? 0;
          return (
            <li key={g.symbolId} className={focus === g.symbolId ? 'guide-item focus' : 'guide-item'} data-symbol={g.symbolId}>
              <div className="guide-art" style={{ width: box, height: box }}><img src={`${ASSET_BASE}${g.src}`} alt={g.symbolName} height={h} width={Math.round(h * g.aspect)} /></div>
              <div>
                <b>{g.emotion.name}</b>{g.emotion.aliases.length > 0 && <span className="hint"> ({g.emotion.aliases.join('·')})</span>}
                <div className="guide-symbol">{g.symbolName}{n > 0 && <span className="guide-count">내 어항에 {n}</span>}</div>
                <p className="hint">{g.meaning}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
