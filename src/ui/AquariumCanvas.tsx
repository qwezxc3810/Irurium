import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { AquariumRenderer, type RenderOptions } from '../render/AquariumRenderer';
import type { TankState } from '../engine/types';
import type { AssetOverrides } from '../assets/manifest';

export interface AquariumCanvasHandle {
  playCleaning(): void;
}

interface Props {
  state: TankState;
  options: RenderOptions;
  /** 처음 만들 때만 쓰인다. 바꾸려면 key를 바꿔 다시 만든다. */
  assetOverrides?: AssetOverrides;
  label?: string;
}

/** PixiJS 렌더러를 React에 붙이는 얇은 껍데기. 상태는 props로만 받는다. */
export const AquariumCanvas = forwardRef<AquariumCanvasHandle, Props>(function AquariumCanvas({ state, options, assetOverrides, label = '내 어항' }, ref) {
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
    r.init(host.current, { overrides: assetOverrides })
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

  useImperativeHandle(ref, () => ({ playCleaning: () => renderer.current?.playCleaning() }), []);

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
