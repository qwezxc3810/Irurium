import { useCallback, useMemo, useRef, useState } from 'react';
import { AquariumCanvas, type AquariumCanvasHandle } from '../../ui/AquariumCanvas';
import { PerfPanel } from '../../ui/PerfPanel';
import type { RenderOptions } from '../../render/AquariumRenderer';
import type { RenderQuality } from '../../render/quality';
import type { PerfResult } from '../../perf/report';
import { frameAt, type SuiteResult } from '../runner';
import { OriginBadge } from './components';

/** 측정 장면. 엔진이 만든 샘플 상태를 그대로 쓴다(성능 측정 때문에 상태를 바꾸지 않음) */
export const PERF_SCENES: Array<{ id: string; name: string; run: string; key: string; day: number }> = [
  { id: 'C14', name: '어린왕자 14일', run: 'case-C', key: 'C', day: 14 },
  { id: 'LS100', name: '꾸준형 100일', run: 'long-steady', key: 'LS', day: 100 },
  { id: 'LS200', name: '꾸준형 200일', run: 'long-steady', key: 'LS', day: 200 },
];

const OPTIONS: RenderOptions = { mossStage: 0, reducedMotion: false };

export function PerfTab({ suite }: { suite: SuiteResult }) {
  const [sceneId, setSceneId] = useState(PERF_SCENES[0]!.id);
  const [quality, setQuality] = useState<RenderQuality>('normal');
  const [results, setResults] = useState<PerfResult[]>([]);
  const canvas = useRef<AquariumCanvasHandle>(null);
  const scene = PERF_SCENES.find((s) => s.id === sceneId)!;
  const state = useMemo(() => frameAt(suite.runs[scene.run]!.find((r) => r.key === scene.key)!, scene.day).state, [suite, scene]);
  const counts = useMemo(() => {
    const c = { fish: 0, plant: 0, rock: 0, symbol: 0 };
    for (const o of state.objects) c[o.kind]++;
    return c;
  }, [state]);
  const onResult = useCallback((r: PerfResult) => setResults((x) => [...x, r]), []);

  return (
    <div className="stack">
      <section className="card">
        <div className="row spread"><h2 style={{ margin: 0 }}>모바일 성능 측정</h2><OriginBadge origin="sample" /></div>
        <p>같은 어항을 <b>일반 모드</b>와 <b>저사양 모드</b>로 바로 바꿔 가며 잴 수 있어요. 저사양 모드는 그리는 방식(렌더링 해상도, 색 보정, 가산 빛, 기포, 반짝임)만 바꾸고, 생성 엔진·스냅샷·물고기 수·수초 수는 그대로예요.</p>
        <p className="watch"><b>실제 휴대폰에서 재기</b> 휴대폰으로 이 검증실을 열고 → 장면 선택 → 모드 선택 → "30초 측정". 장면 3개 × 모드 2개를 잰 뒤 "측정 기기"에서 실제 휴대폰을 고르고 결과 텍스트를 복사해 보내 주세요.</p>
        <p className="hint">PC·개발자 도구 기기 흉내·자동화 브라우저에서 잰 값은 실제 휴대폰 값이 아니에요. 결과 텍스트 맨 위 "측정 출처"에 구분해서 적혀요.</p>
        <div className="chips">
          {PERF_SCENES.map((s) => (
            <button key={s.id} type="button" className={s.id === sceneId ? 'chip on' : 'chip'} onClick={() => setSceneId(s.id)}>{s.name}</button>
          ))}
        </div>
        <p className="hint">엔진 상태: 물고기 {counts.fish} · 수초 {counts.plant} · 수석 {counts.rock} · 상징 {counts.symbol}</p>
      </section>
      <section className="card">
        <AquariumCanvas key={sceneId} ref={canvas} state={state} options={OPTIONS} quality={quality} label={`${scene.name} 성능 측정`} />
        <PerfPanel canvas={canvas} scene={scene.name} quality={quality} onQuality={setQuality} results={results} onResult={onResult} onClear={() => setResults([])} />
      </section>
    </div>
  );
}
