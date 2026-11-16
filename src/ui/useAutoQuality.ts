import { useEffect, useRef, useState, type RefObject } from 'react';
import type { AquariumCanvasHandle } from './AquariumCanvas';
import type { RenderQuality } from '../render/quality';
import { AUTO, AUTO_KEY, autoStart, autoStep, initialQuality, loadDecision, PREF_KEY, safeStorage, type AutoState, type QualityPref } from '../perf/autoQuality';
import { computeFrameStats } from '../perf/frameStats';

/**
 * 사용자 선택(자동/일반/저사양)과 어항 FPS로 지금 쓸 품질을 정한다.
 * 자동일 때만 판정하고, 저사양으로 내리면 기기에 기억한다.
 */
/** restartKey가 바뀌면(저장된 판정을 지운 뒤 등) 처음부터 다시 판정한다 */
export function useAutoQuality(canvas: RefObject<AquariumCanvasHandle | null>, pref: QualityPref, restartKey = 0) {
  const [state, setState] = useState<AutoState>(() => start(pref));
  const stateRef = useRef(state);
  stateRef.current = state;

  // 선택은 저장한다
  useEffect(() => {
    try { safeStorage()?.setItem(PREF_KEY, pref); } catch { /* 저장 못 해도 동작은 같다 */ }
  }, [pref]);

  // 선택이 바뀌거나 다시 판정할 때 처음부터
  const first = useRef(true);
  const lastKey = useRef(restartKey);
  useEffect(() => {
    // "다시 시험하기"는 그 버튼을 누른 순간에만(선택을 바꾼 것은 다시 시험이 아님)
    const retest = restartKey !== lastKey.current;
    lastKey.current = restartKey;
    if (first.current) { first.current = false; return; }
    setState(start(pref, retest));
  }, [pref, restartKey]);

  useEffect(() => {
    if (pref !== 'auto') return;
    let last = performance.now();
    const onVis = () => {
      if (document.visibilityState === 'hidden') canvas.current?.renderFrames()?.pause();
    };
    document.addEventListener('visibilitychange', onVis);
    const id = window.setInterval(() => {
      const now = performance.now();
      const dt = Math.min(2000, now - last);
      last = now;
      const rec = canvas.current?.renderFrames();
      if (!rec) return;
      const before = stateRef.current;
      const next = autoStep(before, {
        dtMs: dt,
        stats: computeFrameStats(rec.recent(AUTO.windowMs, now)),
        visible: document.visibilityState !== 'hidden',
      });
      if (next !== before) setState(next);
      if (before.quality !== 'low' && next.quality === 'low' && next.reason) {
        try { safeStorage()?.setItem(AUTO_KEY, JSON.stringify({ quality: 'low', at: Date.now(), reason: next.reason })); } catch { /* 무시 */ }
      }
    }, 1000);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [pref, restartKey, canvas]);

  const status = pref !== 'auto'
    ? `${state.quality === 'low' ? '저사양' : '일반'}(직접 선택)`
    : `${state.quality === 'low' ? '저사양' : '일반'}(자동)${state.reason ? ` — ${state.reason}` : ''}`;
  return { quality: state.quality as RenderQuality, status };
}

function start(pref: QualityPref, retest = false): AutoState {
  const n = typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }) : null;
  const init = initialQuality(pref, loadDecision(safeStorage()), Date.now(), { memoryGb: n?.deviceMemory ?? null, cores: n?.hardwareConcurrency ?? null }, retest);
  return autoStart(init.quality, init.reason);
}

/** 자동 판정 기억을 지운다(설정에서 "다시 판정") */
export function clearAutoDecision() {
  try { safeStorage()?.removeItem(AUTO_KEY); } catch { /* 무시 */ }
}
