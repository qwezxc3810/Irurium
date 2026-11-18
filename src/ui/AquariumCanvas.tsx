import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { AquariumRenderer, type RenderOptions } from '../render/AquariumRenderer';
import type { TankState } from '../engine/types';
import type { AssetOverrides } from '../assets/manifest';
import type { RenderQuality } from '../render/quality';
import type { RenderStyle } from '../render/atmosphere';

export interface AquariumCanvasHandle {
  playCleaning(): void;
  /** 성능 측정용 렌더링 정보(렌더러가 아직 없으면 null) */
  renderInfo(): ReturnType<AquariumRenderer['info']> | null;
  /** 어항이 실제로 그린 프레임 기록(성능 측정) */
  renderFrames(): ReturnType<AquariumRenderer['frames']> | null;
  /** 진단용 어항 갱신 제한: 0 제한 없음, 음수 멈춤 */
  setFrameLimit(maxFps: number): void;
}

interface Props {
  state: TankState;
  options: RenderOptions;
  /** 처음 만들 때만 쓰인다. 바꾸려면 key를 바꿔 다시 만든다. */
  assetOverrides?: AssetOverrides;
  /** 이전 조명 방식(덧칠)으로 그리기 — 검증실 비교용 */
  legacyLighting?: boolean;
  label?: string;
  /** 렌더링 품질. 바뀌면 같은 렌더러에서 바로 적용(다시 만들지 않음) */
  quality?: RenderQuality;
  /** 렌더링 버전(기존 v0 / 분위기 atmos-1). 없으면 기본(분위기) */
  renderStyle?: RenderStyle;
  /** 기억 보기: 어항 속 요소를 누르면 그 요소 id로 불린다. 없으면 누르기 판정을 켜지 않는다 */
  onObjectTap?: (objectId: string) => void;
}

/** PixiJS 렌더러를 React에 붙이는 얇은 껍데기. 상태는 props로만 받는다. */
export const AquariumCanvas = forwardRef<AquariumCanvasHandle, Props>(function AquariumCanvas({ state, options, assetOverrides, legacyLighting, label = '내 어항', quality = 'normal', renderStyle, onObjectTap }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<AquariumRenderer | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!host.current) return;
    const r = new AquariumRenderer();
    renderer.current = r;
    r.setState(state, options);
    r.init(host.current, { overrides: assetOverrides, legacyLighting, quality, renderStyle })
      .then((m) => { setMissing(m); setLoading(false); })
      .catch((e: unknown) => { setError(String(e)); setLoading(false); });
    return () => {
      r.destroy();
      renderer.current = null;
    };
    // 렌더러는 한 번만 만든다. 상태 변경은 아래 effect가 전달한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    renderer.current?.setState(state, options);
  }, [state, options]);

  useEffect(() => {
    renderer.current?.setQuality(quality);
  }, [quality]);

  useEffect(() => {
    if (renderStyle) renderer.current?.setRenderStyle(renderStyle);
  }, [renderStyle]);

  // 최신 콜백을 ref로 들고, 렌더러에는 켜고 끄기만 알린다(매 렌더마다 다시 걸지 않게)
  const tapRef = useRef(onObjectTap);
  tapRef.current = onObjectTap;
  const tapOn = !!onObjectTap;
  useEffect(() => {
    if (loading) return;
    renderer.current?.setObjectTapHandler(tapOn ? (id) => tapRef.current?.(id) : null);
  }, [tapOn, loading]);

  useImperativeHandle(ref, () => ({
    playCleaning: () => renderer.current?.playCleaning(),
    renderInfo: () => {
      try { return loading ? null : renderer.current?.info() ?? null; } catch { return null; }
    },
    renderFrames: () => (loading ? null : renderer.current?.frames() ?? null),
    setFrameLimit: (n: number) => renderer.current?.setFrameLimit(n),
  }), [loading]);

  return (
    <div className="aquarium-wrap">
      <div className="aquarium-box">
        <div ref={host} className="aquarium" role="img" aria-label={label} />
        {loading && <div className="aquarium-loading">어항을 준비하고 있어요…</div>}
      </div>
      {error && <p className="warn">어항을 그리지 못했어요: {error}</p>}
      {missing.length > 0 && <p className="warn">불러오지 못한 그림이 있어 대체 그림으로 보여요: {missing.join(', ')}</p>}
    </div>
  );
});
