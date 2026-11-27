import { useEffect, useMemo, useState } from 'react';
import manifestJson from '../../../public/assets/manifest.json';
import { ASSET_BASE } from '../../assets/manifest';
import { canStartEvaluation, isBlindBreach, REVEAL_HEARTBEAT_MS } from '../visualEval';
import {
  closeCollection, formatSeReport, GUESS_OPTIONS, guessLabel, mayStartEval, newSeSession, parseSeSessions, reopenCollection, resultsVisible, SE_COLLECTION_OPEN, SE_CRITERIA, SE_LABEL,
  seCounted, seExclusion, seItems, seOverview, seSummary, startedAfterReveal, type SeCollection, type SeItem, type SeSession,
} from '../symbolEval';

/**
 * 감정 상징 평가(블라인드). 상징 그림 하나씩 보여 주고 어떤 마음에서 생겼을지 고르게 한다.
 * 평가 중에는 이름·정답을 보여 주지 않는다. 결과는 이 기기에만 저장하고 사람이 복사해서 모은다.
 */
const KEY_DONE = 'irurium.symbolEval.sessions';
const KEY_REVEALED = 'irurium.symbolEval.revealedAt';
/** 수집 상태: 진행자가 수집을 끝내야 결과·정답을 볼 수 있다 */
const KEY_COLLECTION = 'irurium.symbolEval.collection';
const ELS = (manifestJson as { elements: Record<string, { displayHeight?: number; displayWidth?: number }> }).elements;
/** 휴대폰 어항(논리 폭 1000 → 화면 폭 약 380px)에서 보이는 크기 비율 */
const PHONE_SCALE = 0.38; // 근사값(기기마다 실제 크기는 다름)

function load<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function save(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 저장 못 해도 화면은 동작 */ }
}

type Mode = 'intro' | 'eval' | 'done' | 'results';

export function SymbolEvalTab() {
  const items = useMemo(() => new Map(seItems().map((i) => [i.id, i])), []);
  const [mode, setMode] = useState<Mode>('intro');
  const [current, setCurrent] = useState<SeSession | null>(null);
  const [done, setDone] = useState<SeSession[]>(() => load<SeSession[]>(KEY_DONE, []));
  const [imported, setImported] = useState<SeSession[]>([]);
  const [evaluator, setEvaluator] = useState('');
  const [trial, setTrial] = useState(false);
  const [blocked, setBlocked] = useState('');
  const [collection, setCollection] = useState<SeCollection>(() => load<SeCollection>(KEY_COLLECTION, SE_COLLECTION_OPEN));
  const [confirmClose, setConfirmClose] = useState(false);
  useEffect(() => save(KEY_DONE, done), [done]);
  useEffect(() => save(KEY_COLLECTION, collection), [collection]);
  // 다른 탭에서 수집 상태가 바뀌면 따라간다(결과가 다시 닫히면 이 탭의 결과 화면도 닫음)
  useEffect(() => {
    const on = (e: StorageEvent) => {
      if (e.key === KEY_COLLECTION) {
        const c = load<SeCollection>(KEY_COLLECTION, SE_COLLECTION_OPEN);
        setCollection(c);
        if (!resultsVisible(c)) setMode((m) => (m === 'results' ? 'intro' : m));
      }
      if (e.key === KEY_DONE) setDone(load<SeSession[]>(KEY_DONE, []));
    };
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
  }, []);

  // 정답 화면이 열려 있는 동안 시각을 계속 남긴다(다른 탭의 평가가 블라인드 위반인지 판단)
  useEffect(() => {
    if (mode !== 'results') return;
    const beat = () => save(KEY_REVEALED, new Date().toISOString());
    beat();
    const t = setInterval(beat, REVEAL_HEARTBEAT_MS);
    return () => clearInterval(t);
  }, [mode]);

  const start = () => {
    if (!mayStartEval(collection)) {
      setBlocked('평가 수집이 끝나 정답이 공개된 상태예요. 다시 평가하려면 진행자가 "수집 다시 열기"를 눌러 주세요.');
      return;
    }
    if (!canStartEvaluation(load<string | null>(KEY_REVEALED, null), Date.now())) {
      setBlocked('다른 탭(또는 창)에 정답 화면이 열려 있어요. 그 화면을 닫고 몇 초 뒤 다시 시작해 주세요.');
      return;
    }
    setBlocked('');
    const seed = (crypto.getRandomValues(new Uint32Array(1))[0] ?? Date.now()) >>> 0;
    const origin = trial || navigator.webdriver ? 'synthetic-test' : 'human';
    setCurrent(newSeSession(evaluator, seed, new Date(), navigator.userAgent, origin));
    setMode('eval');
  };

  const answer = (guess: string) => {
    if (!current) return;
    const itemId = current.order[current.answers.length]!;
    const next = { ...current, answers: [...current.answers, { itemId, guess }] };
    if (next.answers.length >= next.order.length) {
      const completedAt = new Date().toISOString();
      const breach = isBlindBreach(next, load<string | null>(KEY_REVEALED, null), completedAt);
      setDone((d) => [...d, { ...next, completedAt, ...(breach ? { blindBreach: true } : {}) }]);
      setCurrent(null);
      setMode('done');
    } else setCurrent(next);
  };

  const all = useMemo(() => [...done, ...imported], [done, imported]);
  const last = done[done.length - 1];

  return (
    <div className="stack">
      <section className="card">
        <h2 style={{ margin: 0 }}>감정 상징 평가 — 이 상징은 어떤 마음일까?</h2>
        <p>어항에 남는 감정 흔적(상징) 12종이 그림만 보고도 어떤 마음인지 읽히는지 확인해요. 감정과 상관없는 대조 그림 2개도 섞여 있어요.</p>
        <div className="chips">
          <button type="button" className={mode !== 'results' ? 'chip on' : 'chip'} onClick={() => setMode(current ? 'eval' : 'intro')}>평가하기</button>
          {resultsVisible(collection) && <button type="button" className={mode === 'results' ? 'chip on' : 'chip'} disabled={!!current} onClick={() => setMode('results')}>결과 보기 (정답 공개)</button>}
        </div>
        {!resultsVisible(collection) ? (
          <div className="se-admin">
            <p className="hint">평가를 모으는 중이에요. 결과와 정답은 <b>진행자가 수집을 끝낸 뒤</b>에만 볼 수 있어요(평가 전·평가자 사이에 정답이 보이지 않게).</p>
            {!current && (!confirmClose ? (
              <button type="button" className="link" onClick={() => setConfirmClose(true)}>진행자: 수집 끝내고 결과 보기</button>
            ) : (
              <p>
                모든 평가자가 끝났나요? 결과를 열면 이 기기에서 정답이 공개돼요.{' '}
                <button type="button" onClick={() => { setCollection((c) => closeCollection(c, new Date())); setConfirmClose(false); setMode('results'); }}>네, 수집 끝내고 결과 보기</button>{' '}
                <button type="button" className="link" onClick={() => setConfirmClose(false)}>취소</button>
              </p>
            ))}
          </div>
        ) : (
          <div className="se-admin">
            <p className="hint">수집이 끝나 정답이 공개된 상태예요. 새 평가를 받으려면 수집을 다시 여세요(결과는 다시 닫혀요). 정답이 공개된 뒤 시작한 평가는 목록에 표시돼요.</p>
            <button type="button" className="link" onClick={() => { setCollection((c) => reopenCollection(c)); setMode('intro'); }}>진행자: 수집 다시 열기</button>
          </div>
        )}
      </section>

      {mode === 'intro' && (
        <section className="card">
          <h3>평가 방법</h3>
          <ul>
            <li>그림을 하나씩 {items.size}개 보여 드려요. 1~2분 걸려요.</li>
            <li>그림마다 <b>"이 흔적은 어떤 마음에서 생겼을까요?"</b>를 12가지 마음 중에서 골라 주세요. 모르겠으면 "잘 모르겠어요"를 골라 주세요.</li>
            <li>그림 이름과 정답은 다 끝난 뒤에 보여 드려요. 끝나기 전에는 "결과 보기"를 열지 마세요.</li>
            <li>결과는 이 기기에 저장돼요. 여러 명이 같은 휴대폰으로 차례로 해도 돼요.</li>
          </ul>
          <label className="field">평가자 별칭(선택)<input value={evaluator} maxLength={40} onChange={(e) => setEvaluator(e.target.value)} /></label>
          <label className="check"><input type="checkbox" checked={trial} onChange={(e) => setTrial(e.target.checked)} /> 실제 평가가 아니라 화면 시험이에요(판정에서 빼기)</label>
          <button type="button" className="wide" onClick={start}>평가 시작</button>
          {blocked && <p className="bad">{blocked}</p>}
          <p className="hint">지금까지 이 기기에서 끝낸 평가: {done.length}개 (판정에 쓰는 유효 세션 {seCounted(done).length}개)</p>
          <p className="hint">한 사람은 한 번만 해 주세요. 서로 다른 사람이 했는지는 진행자가 확인해요(집계는 세션 단위).</p>
        </section>
      )}

      {mode === 'eval' && current && (
        <EvalStep key={current.answers.length} item={items.get(current.order[current.answers.length]!)!} index={current.answers.length} total={current.order.length}
          onAnswer={answer} onQuit={() => { setCurrent(null); setMode('intro'); }} />
      )}

      {mode === 'done' && last && (
        <section className="card">
          <h3>고마워요! 평가가 끝났어요</h3>
          <p>다음 분이 이어서 하려면 "평가하기"를 눌러 주세요. 모두 끝나면 "결과 보기"에서 결과를 복사해 기획자에게 보내 주세요.</p>
          <button type="button" className="wide" onClick={() => { setEvaluator(''); setTrial(false); setMode('intro'); }}>다음 분 평가하기</button>
        </section>
      )}

      {mode === 'results' && resultsVisible(collection) && <Results collection={collection} all={all} done={done} onImport={(xs) => setImported((p) => [...p, ...xs])} onDeleteLocal={(id) => setDone((d) => d.filter((s) => s.id !== id))} />}
    </div>
  );
}

function Picture({ item, size, onLoad, onError, retry = 0 }: { item: SeItem; size: 'big' | 'phone' | 'thumb'; onLoad?: () => void; onError?: () => void; retry?: number }) {
  const spec = ELS[item.el] ?? {};
  const k = size === 'big' ? 1.6 : size === 'thumb' ? 1 : PHONE_SCALE;
  const style = item.shape === 'swim' ? { width: Math.round((spec.displayWidth ?? 80) * k * (size === 'phone' ? 1 : 1.6)) } : { height: Math.round((spec.displayHeight ?? 80) * k) };
  return (
    <div className={`se-stage ${size} ${item.shape}`} style={{ backgroundImage: `url(${ASSET_BASE}themes/starlit-desert/background.webp)` }}>
      <img src={`${ASSET_BASE}${item.src}${retry ? `?r=${retry}` : ''}`} alt="평가 그림" style={style} draggable={false} onLoad={onLoad} onError={onError} />
    </div>
  );
}

function EvalStep({ item, index, total, onAnswer, onQuit }: { item: SeItem; index: number; total: number; onAnswer: (g: string) => void; onQuit: () => void }) {
  // 그림이 다 뜨기 전에는 답할 수 없게(안 보이는 그림에 답하면 평가가 오염됨)
  const [big, setBig] = useState<'loading' | 'ok' | 'error'>('loading');
  const [small, setSmall] = useState<'loading' | 'ok' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
  // 큰 그림과 휴대폰 크기 그림이 모두 떠야 답할 수 있다(작은 크기 판독도 평가 대상)
  const state = big === 'error' || small === 'error' ? 'error' : big === 'ok' && small === 'ok' ? 'ok' : 'loading';
  return (
    <section className="card">
      <div className="row spread">
        <h3 style={{ margin: 0 }}>{index + 1} / {total}</h3>
        <button type="button" className="link" onClick={onQuit}>그만하기(지금까지 답은 버림)</button>
      </div>
      <Picture item={item} size="big" retry={retry} onLoad={() => setBig('ok')} onError={() => setBig('error')} />
      {state === 'error' && (
        <p className="bad">그림을 불러오지 못했어요. <button type="button" className="link" onClick={() => { setBig('loading'); setSmall('loading'); setRetry((r) => r + 1); }}>다시 불러오기</button></p>
      )}
      <div className="row" style={{ alignItems: 'center', gap: 8 }}>
        <small className="hint">휴대폰 어항에서 보이는 크기(근사):</small>
        <Picture item={item} size="phone" retry={retry} onLoad={() => setSmall('ok')} onError={() => setSmall('error')} />
      </div>
      <p><b>이 흔적은 어떤 마음에서 생겼을까요?</b></p>
      <div className="chips se-choices">
        {GUESS_OPTIONS.map((g) => <button key={g.id} type="button" className="chip" disabled={state !== 'ok'} onClick={() => onAnswer(g.id)}>{g.label}</button>)}
      </div>
    </section>
  );
}

function Results({ collection, all, done, onImport, onDeleteLocal }: { collection: SeCollection; all: SeSession[]; done: SeSession[]; onImport: (xs: SeSession[]) => void; onDeleteLocal: (id: string) => void }) {
  const o = seOverview(all);
  const rows = seSummary(all);
  const report = formatSeReport(all, collection);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState('');
  const copy = async (s: string, what: string) => { try { await navigator.clipboard.writeText(s); setCopied(what); } catch { setCopied('복사하지 못했어요. 아래 글을 길게 눌러 복사해 주세요.'); } };
  return (
    <>
      <section className="card">
        <h3>결과 {o.enough ? '' : `(보류: 유효 세션 ${o.evaluators}개, ${SE_CRITERIA.minEvaluators}개 이상 필요)`}</h3>
        <p className="hint">유효한 평가 세션 {o.evaluators}개. 집계 단위는 세션이에요. 서로 다른 사람이 한 번씩 했는지는 진행자가 확인해 주세요.</p>
        <p className="hint">{o.evaluators < SE_CRITERIA.decisionEvaluators ? `탐색용 결과예요. 헷갈리는 상징과 혼동 패턴을 찾는 데 쓰고, 출시 판단은 ${SE_CRITERIA.decisionEvaluators}명 이상 별도 평가로 정해요.` : '판단용 인원을 채웠어요. 기준은 기획자가 확정해요.'}</p>
        <ul>
          <li>상징 12종 전체 맞힌 비율 <b>{Math.round(o.accuracy * 100)}%</b> (찍으면 약 8%), 모르겠어요 {Math.round(o.unsureRate * 100)}%</li>
          <li>대조 그림에 감정을 고른 비율 {Math.round(o.controlEmotionRate * 100)}% (높으면 아무 그림이나 감정으로 읽는 경향)</li>
          <li>잘 읽힘 {o.counts.readable}종 · 애매 {o.counts.mixed}종 · 안 읽힘 {o.counts.unreadable}종</li>
        </ul>
        <div className="table-wrap">
          <table>
            <thead><tr><th>상징</th><th>정답</th><th>맞힘</th><th>모름</th><th>헷갈린 감정</th><th>판정</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.item.id}>
                <td style={{ whiteSpace: 'nowrap' }}><img src={`${ASSET_BASE}${r.item.src}`} alt="" style={{ height: 26, verticalAlign: 'middle', marginRight: 4 }} />{r.item.name}</td>
                <td>{r.item.truth ? guessLabel(r.item.truth) : '(무관)'}</td>
                <td>{r.item.truth ? `${r.correct}/${r.n}` : '—'}</td>
                <td>{r.unsure}/{r.n}</td>
                <td>{r.topWrong ? `${guessLabel(r.topWrong.guess)} ${r.topWrong.n}` : '—'}</td>
                <td>{SE_LABEL[r.label]}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div className="row">
          <button type="button" onClick={() => copy(report, '정리 텍스트를 복사했어요')}>정리 텍스트 복사</button>
          <button type="button" onClick={() => copy(JSON.stringify(done, null, 1), '이 기기의 평가 원본을 복사했어요')}>이 기기 평가 원본 복사(JSON)</button>
        </div>
        {copied && <p className="hint">{copied}</p>}
      </section>
      <Gallery rows={rows} />
      <section className="card">
        <h3>다른 기기 평가 합치기</h3>
        <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="다른 기기에서 복사한 평가 원본(JSON)을 붙여 넣어요" style={{ width: '100%' }} />
        <button type="button" onClick={() => { try { onImport(parseSeSessions(text)); setText(''); setErr(''); } catch (e) { setErr(String((e as Error).message)); } }}>합치기</button>
        {err && <p className="bad">{err}</p>}
      </section>
      <section className="card">
        <h3>세션 목록</h3>
        <div className="table-wrap"><table>
          <thead><tr><th>별칭</th><th>시작</th><th>상태</th><th></th></tr></thead>
          <tbody>{all.map((s) => (
            <tr key={s.id + s.startedAt}>
              <td>{s.evaluator || '—'}</td><td>{new Date(s.startedAt).toLocaleString()}</td>
              <td>{seExclusion(s) ?? '판정에 씀'}{startedAfterReveal(s, collection) && <span className="bad"> · 정답 공개 뒤 시작(정답을 본 사람이 아닌지 확인)</span>}</td>
              <td>{done.some((d) => d.id === s.id) && <button type="button" className="link" onClick={() => onDeleteLocal(s.id)}>지우기</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </section>
    </>
  );
}

/** 12종 한눈에 보기(결과 화면에서만 = 평가가 끝난 뒤에만). 상징 12종과 대조 2종을 나눠 보여 준다 */
function Gallery({ rows }: { rows: ReturnType<typeof seSummary> }) {
  const card = (r: (typeof rows)[number]) => (
    <figure key={r.item.id} className="se-card">
      <Picture item={r.item} size="thumb" />
      <figcaption>
        <b>{r.item.name}</b>
        <span>{r.item.truth ? guessLabel(r.item.truth) : '감정과 무관'}</span>
        <small>{r.item.truth ? `맞힘 ${r.correct}/${r.n} · ${SE_LABEL[r.label]}` : `감정으로 고름 ${r.n - r.unsure}/${r.n}`}{r.topWrong ? ` · 헷갈림: ${guessLabel(r.topWrong.guess)}` : ''}</small>
      </figcaption>
    </figure>
  );
  return (
    <section className="card">
      <h3>상징 12종 한눈에 보기</h3>
      <p className="hint">평가가 끝난 뒤에만 볼 수 있어요(정답 공개). 실루엣끼리 비슷한 것이 없는지 함께 봐요.</p>
      <div className="se-gallery">{rows.filter((r) => r.item.truth).map(card)}</div>
      <h4>대조 그림(감정과 무관)</h4>
      <div className="se-gallery">{rows.filter((r) => !r.item.truth).map(card)}</div>
    </section>
  );
}
