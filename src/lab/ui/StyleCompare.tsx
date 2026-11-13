import { useMemo, useState } from 'react';
import type { TankState } from '../../engine/types';
import type { RenderOptions } from '../../render/AquariumRenderer';
import type { AssetOverrides } from '../../assets/manifest';
import { AquariumCanvas } from '../../ui/AquariumCanvas';
import { frameAt, type SuiteResult } from '../runner';
import { OriginBadge } from './components';

/**
 * 그래픽 스타일 비교(시험용). manifest.json은 그대로 두고, 같은 어항 상태를
 * 임시 SVG / 실사 / 세미 리얼 금붕어로 나란히 그린다. 엔진 결과는 셋 다 같다.
 * 스타일이 정해지면 manifest.json의 fish.goldfish만 바꾸면 앱 전체에 반영된다.
 */

interface Variant { id: string; name: string; note: string; src: string | null }

const VARIANTS: Variant[] = [
  { id: 'svg', name: '이전(임시 SVG)', note: '비교 기준', src: 'fish/goldfish.svg' },
  { id: 'real', name: '실사', note: 'ChatGPT 생성 ①', src: 'fish/goldfish-real.webp' },
  { id: 'semi', name: '세미 리얼', note: '선택됨 · 앱에 적용', src: null },
];

type LightMode = 'as-is' | 'neutral' | 'warm' | 'cool';
const LIGHTS: Array<[LightMode, string]> = [['as-is', '기록 그대로'], ['neutral', '조명 없음'], ['warm', '따뜻하게'], ['cool', '차갑게']];

/** 금붕어가 잘 보이도록 만든 시험 장면(엔진 결과가 아님) */
function closeUp(): TankState {
  return {
    schema: 1, themeId: 'starlit-desert', light: { temp: 0.3, energy: 0.1 }, behavior: { speed: 0.9, depth: 0.1 }, effects: [], completed: false,
    objects: [
      { id: 'g1', el: 'fish.goldfish', kind: 'fish', layer: 'mid', x: 300, y: 220, scale: 1.3, tint: 0, bornSeq: 1 },
      { id: 'g2', el: 'fish.goldfish', kind: 'fish', layer: 'mid', x: 640, y: 330, scale: 1.0, tint: 0, bornSeq: 2 },
      { id: 'g3', el: 'fish.goldfish', kind: 'fish', layer: 'mid', x: 520, y: 150, scale: 0.8, tint: 0, bornSeq: 3 },
      { id: 'p1', el: 'plant.leafy', kind: 'plant', layer: 'back', x: 180, y: 505, scale: 1.1, tint: 0, bornSeq: 4 },
      { id: 'p2', el: 'plant.stem', kind: 'plant', layer: 'back', x: 820, y: 505, scale: 1.0, tint: 0, bornSeq: 5 },
      { id: 'r1', el: 'rock.round', kind: 'rock', layer: 'floor', x: 470, y: 522, scale: 1.0, tint: 0, bornSeq: 6 },
    ],
  };
}

export function StyleCompare({ suite }: { suite: SuiteResult }) {
  const scenes = useMemo(() => {
    const last = (id: string, key: string) => {
      const r = suite.runs[id]!.find((x) => x.key === key)!;
      return frameAt(r, r.frames.length).state;
    };
    return [
      { id: 'close', name: '금붕어 클로즈업(시험 장면)', state: closeUp() },
      { id: 'C', name: '어린왕자 14일 완성(사례 C)', state: last('case-C', 'C') },
      { id: 'warm', name: '따뜻함 14일', state: last('cmp-emotion', 'CE1') },
      { id: 'joy', name: '유쾌함 14일(사례 B)', state: last('case-B', 'B3') },
      { id: 'lonely', name: '쓸쓸함으로 바뀐 어항(H3 실험)', state: last('exp-h3', 'H3') },
      { id: 'long', name: '꾸준형 200일', state: last('long-steady', 'LS') },
    ];
  }, [suite]);
  const [sceneId, setSceneId] = useState('close');
  const [light, setLight] = useState<LightMode>('as-is');
  const [width, setWidth] = useState(180);
  const [amp, setAmp] = useState(0.08);
  const [applied, setApplied] = useState({ width: 180, amp: 0.08 });

  const scene = scenes.find((s) => s.id === sceneId) ?? scenes[0]!;
  const state = useMemo<TankState>(() => {
    const L = light === 'neutral' ? { temp: 0, energy: 0 } : light === 'warm' ? { temp: 0.8, energy: 0.1 } : light === 'cool' ? { temp: -0.6, energy: -0.4 } : scene.state.light;
    return { ...scene.state, light: L };
  }, [scene, light]);
  const options = useMemo<RenderOptions>(() => ({ mossStage: 0, reducedMotion: false }), []);
  const goldfish = scene.state.objects.filter((o) => o.el === 'fish.goldfish').length;

  return (
    <div className="stack">
      <section className="card notice">
        <OriginBadge origin="sample" />
        <p>같은 어항 상태를 세 가지 금붕어 그림으로 나란히 움직여 봐요. 엔진 결과는 셋 다 똑같고 <b>그림만</b> 달라요. 2026-11-13 기획자 결정으로 <b>세미 리얼</b>을 앱(manifest.json)에 적용했어요. 세미 리얼 칸은 앱과 같은 설정(크기 180, 휘는 정도 0.08)이에요.</p>
        <p className="hint">금붕어 외 물고기·수초·수석·배경은 아직 임시 SVG라 섞여 보여요. 스타일 판단은 금붕어만 보고 해 주세요.</p>
      </section>
      <section className="card">
        <div className="field">장면
          <div className="chips">{scenes.map((s) => <button key={s.id} className={s.id === sceneId ? 'chip on' : 'chip'} onClick={() => setSceneId(s.id)}>{s.name}</button>)}</div>
        </div>
        <div className="field">감정 조명(물빛)
          <div className="chips">{LIGHTS.map(([id, name]) => <button key={id} className={id === light ? 'chip on' : 'chip'} onClick={() => setLight(id)}>{name}</button>)}</div>
        </div>
        <div className="row">
          <label className="check">실사 크기 {width}
            <input type="range" min={120} max={260} step={10} value={width} onChange={(e) => setWidth(Number(e.target.value))} />
          </label>
          <label className="check">헤엄칠 때 휘는 정도 {amp.toFixed(2)}
            <input type="range" min={0.03} max={0.16} step={0.01} value={amp} onChange={(e) => setAmp(Number(e.target.value))} />
          </label>
          <button onClick={() => setApplied({ width, amp })} disabled={applied.width === width && applied.amp === amp}>적용</button>
        </div>
        <p className="hint">이 장면의 금붕어 {goldfish}마리. 크기·휘는 정도는 실사 칸에만 적용돼요(적용하면 그림을 다시 불러와요). 세미 리얼 칸은 앱 설정 그대로예요.</p>
      </section>
      <div className="style-grid">
        {VARIANTS.map((v) => {
          // 세미 리얼은 manifest.json 값 그대로(앱과 같은 모습). 나머지는 덮어쓰기로 비교한다.
          const overrides: AssetOverrides | undefined =
            v.id === 'svg' ? { 'fish.goldfish': { src: 'fish/goldfish.svg', displayWidth: 130, swim: { amplitude: 0.12, frequency: 0.8 } } }
            : v.src ? { 'fish.goldfish': { src: v.src, displayWidth: applied.width, swim: { amplitude: applied.amp, frequency: 0.7 } } }
            : undefined;
          return (
            <section key={v.id} className="card style-card">
              <div className="row spread"><h2 style={{ margin: 0 }}>{v.name}</h2><span className="hint" style={{ margin: 0 }}>{v.note}</span></div>
              <AquariumCanvas key={`${v.id}-${applied.width}-${applied.amp}`} state={state} options={options} assetOverrides={overrides} label={`${v.name} 금붕어 어항`} />
            </section>
          );
        })}
      </div>
    </div>
  );
}
