import { useEffect, useRef, useState } from 'react';
import { ASSET_BASE } from '../../assets/manifest';
import { EMOTIONS, emotionById } from '../../engine/mood';
import { GUIDE } from '../../ui/encyclopedia';
import { ME_CRITERIA, type MeCondition, type MeExposure } from '../memoryEval';

/**
 * 기억 평가 B단계(체험·도감 노출). 검증실에서 감정 도감 내용(의미 문구)을 보여 주는 곳은 이 파일뿐이다.
 * 첫인상(A)·다음 날(C) 화면은 이 파일을 쓰지 않는다(테스트로 확인).
 */
export function MemoryExposure({ condition, onDone }: { condition: MeCondition; onDone: (b: MeExposure) => void }) {
  const [b, setB] = useState<MeExposure>(() => ({ startedAt: new Date().toISOString(), records: [], guideOpens: 0, guideMs: 0 }));
  const wantsExp = condition === 'experience' || condition === 'both';
  const wantsGuide = condition === 'guide' || condition === 'both';
  const [step, setStep] = useState<'exp' | 'guide'>(wantsExp ? 'exp' : 'guide');
  const finish = (x: MeExposure) => onDone({ ...x, completedAt: new Date().toISOString() });
  return step === 'exp'
    ? <Experience b={b} onChange={setB} onNext={(x) => (wantsGuide ? (setB(x), setStep('guide')) : finish(x))} />
    : <GuideStudy b={b} onDone={finish} />;
}

/** 체험: 마음을 고르면 그 마음의 흔적이 생기는 장면을 본다(앱의 흔적 생성 안내와 같은 형식, 의미 문구 없이) */
function Experience({ b, onChange, onNext }: { b: MeExposure; onChange: (b: MeExposure) => void; onNext: (b: MeExposure) => void }) {
  const [pick, setPick] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [shown, setShown] = useState<string | null>(null);
  const n = b.records.length;
  const add = () => {
    const emo = pick ? emotionById(pick) : undefined;
    if (!emo) return;
    onChange({ ...b, records: [...b.records, { emotionId: emo.id, symbolId: emo.symbol, at: new Date().toISOString(), noted: note.trim().length > 0 }] });
    setShown(emo.id);
    setPick(null);
    setNote('');
  };
  const last = shown ? emotionById(shown) : undefined;
  const g = last ? GUIDE.find((x) => x.emotion.id === last.id) : undefined;
  return (
    <section className="card">
      <h3>마음 기록 체험 ({n}/{ME_CRITERIA.experienceMin}~{ME_CRITERIA.experienceMax})</h3>
      <p>요즘 읽은 책이나 오늘 하루를 떠올리며 마음을 골라 주세요. 고를 때마다 어항에 그 마음의 흔적이 생겨요. <b>{ME_CRITERIA.experienceMin}번 이상</b> 해 주세요.</p>
      {g && last && (
        <div className="trace-notice me-notice" aria-live="polite">
          <img src={`${ASSET_BASE}${g.src}`} alt="" width={72} height={72} />
          <div><b>{last.name}{josa(last.name)} {g.symbolName}{josa(g.symbolName)} 되었어요</b></div>
        </div>
      )}
      {n < ME_CRITERIA.experienceMax && (
        <>
          <div className="chips">
            {EMOTIONS.map((e) => <button key={e.id} type="button" className={pick === e.id ? 'chip on' : 'chip'} onClick={() => setPick(e.id)}>{e.name}</button>)}
          </div>
          <label className="field">한마디(선택, 저장하지 않아요)<input value={note} maxLength={60} onChange={(e) => setNote(e.target.value)} placeholder="예: 주인공이 떠날 때 먹먹했다" /></label>
          <button type="button" className="wide" disabled={!pick} onClick={add}>이 마음 기록하기</button>
        </>
      )}
      {n >= ME_CRITERIA.experienceMin && <button type="button" className="wide" onClick={() => onNext(b)}>체험 마치기</button>}
      <p className="hint">한마디는 그 순간을 떠올리는 데만 쓰고 저장하지 않아요(썼는지 여부만 남아요). 이름·연락처 같은 개인정보는 쓰지 마세요.</p>
    </section>
  );
}

function josa(w: string): string {
  const c = w.charCodeAt(w.length - 1) - 0xac00;
  return c >= 0 && c <= 11171 && c % 28 !== 0 ? '이' : '가';
}

/** 도감 보기: 12종 그림·이름·한 줄 의미. 최소 시간이 지나야 '다 봤어요'를 누를 수 있다 */
function GuideStudy({ b, onDone }: { b: MeExposure; onDone: (b: MeExposure) => void }) {
  const opened = useRef(Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const ms = now - opened.current;
  const left = Math.max(0, Math.ceil((ME_CRITERIA.guideMinMs - ms) / 1000));
  return (
    <section className="card">
      <h3>감정 도감 보기</h3>
      <p>어항에 남는 마음의 흔적 12가지예요. 외우려고 하지 않아도 괜찮아요. 편하게 한 번 둘러봐 주세요.</p>
      <ul className="guide-grid">
        {GUIDE.map((g) => (
          <li key={g.symbolId} className="guide-item">
            <div className="guide-art" style={{ width: 80, height: 80 }}><img src={`${ASSET_BASE}${g.src}`} alt={g.symbolName} style={{ maxWidth: 72, maxHeight: 72 }} /></div>
            <div><b>{g.emotion.name}</b><div className="guide-symbol">{g.symbolName}</div><p className="hint">{g.meaning}</p></div>
          </li>
        ))}
      </ul>
      <button type="button" className="wide" disabled={left > 0} onClick={() => onDone({ ...b, guideOpens: b.guideOpens + 1, guideMs: b.guideMs + (Date.now() - opened.current) })}>
        {left > 0 ? `조금만 더 둘러봐 주세요 (${left}초)` : '다 봤어요'}
      </button>
    </section>
  );
}
