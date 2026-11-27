import { useEffect, useMemo, useState } from 'react';
import { ASSET_BASE } from '../../assets/manifest';
import { emotionById } from '../../engine/mood';
import {
  CONDITION_LABEL, CONDITIONS, CONFIDENCE_LABEL, confusions, elapsedHours, exposureSplit, formatMeReport, groupSummary, hoursSinceExposure, ME_CRITERIA,
  meCounted, meExclusion, meItems, newParticipant, newTest, nextCondition, parseParticipants, RECALL_OPTIONS, stageOf,
  type MeAnswer, type MeCondition, type MeConfidence, type MeParticipant, type MeRecall,
} from '../memoryEval';
import { closeCollection, GUESS_OPTIONS, guessLabel, mayStartEval, reopenCollection, resultsVisible, SE_COLLECTION_OPEN, type SeCollection, type SeItem } from '../symbolEval';
import { canStartEvaluation, isBlindBreach, REVEAL_HEARTBEAT_MS } from '../visualEval';
import { MemoryExposure } from './MemoryExposure';
import { Picture } from './SymbolEvalTab';

/**
 * 감정 상징 기억 평가(24시간). A 첫인상 → B 체험 → (약 24시간 뒤) C 다시 고르기 + 회상.
 * A·C 화면에는 상징 이름·정답·도감이 나오지 않는다. 결과·정답은 진행자가 수집을 끝낸 뒤에만.
 */
const KEY_PS = 'irurium.memoryEval.participants';
const KEY_REVEALED = 'irurium.memoryEval.revealedAt';
const KEY_COLLECTION = 'irurium.memoryEval.collection';

function load<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function save(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 저장 못 해도 화면은 동작 */ }
}
const rnd = () => (crypto.getRandomValues(new Uint32Array(1))[0] ?? Date.now()) >>> 0;
const STAGE_LABEL = { a: '첫인상(A) 할 차례', b: '체험(B) 할 차례', wait: '기다리는 중', c: '다음 날(C) 할 차례', done: '끝' } as const;

type Mode = 'intro' | 'run' | 'results';

export function MemoryEvalTab() {
  const items = useMemo(() => new Map(meItems().map((i) => [i.id, i])), []);
  const [ps, setPs] = useState<MeParticipant[]>(() => load<MeParticipant[]>(KEY_PS, []));
  const [imported, setImported] = useState<MeParticipant[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('intro');
  const [collection, setCollection] = useState<SeCollection>(() => load<SeCollection>(KEY_COLLECTION, SE_COLLECTION_OPEN));
  const [confirmClose, setConfirmClose] = useState(false);
  const [condition, setCondition] = useState<MeCondition | 'auto'>('auto');
  const [trial, setTrial] = useState(false);
  const [blocked, setBlocked] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => save(KEY_PS, ps), [ps]);
  useEffect(() => save(KEY_COLLECTION, collection), [collection]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const on = (e: StorageEvent) => {
      if (e.key === KEY_COLLECTION) {
        const c = load<SeCollection>(KEY_COLLECTION, SE_COLLECTION_OPEN);
        setCollection(c);
        if (!resultsVisible(c)) setMode((m) => (m === 'results' ? 'intro' : m));
      }
      if (e.key === KEY_PS) setPs(load<MeParticipant[]>(KEY_PS, []));
    };
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
  }, []);
  useEffect(() => {
    if (mode !== 'results') return;
    const beat = () => save(KEY_REVEALED, new Date().toISOString());
    beat();
    const t = setInterval(beat, REVEAL_HEARTBEAT_MS);
    return () => clearInterval(t);
  }, [mode]);

  const active = ps.find((p) => p.id === activeId) ?? null;
  const update = (p: MeParticipant) => setPs((xs) => xs.map((x) => (x.id === p.id ? p : x)));
  const guard = (): boolean => {
    if (!mayStartEval(collection)) { setBlocked('수집이 끝나 정답이 공개된 상태예요. 진행자가 "수집 다시 열기"를 눌러야 이어서 할 수 있어요.'); return false; }
    if (!canStartEvaluation(load<string | null>(KEY_REVEALED, null), Date.now())) { setBlocked('다른 탭에 정답 화면이 열려 있어요. 닫고 몇 초 뒤 다시 해 주세요.'); return false; }
    setBlocked('');
    return true;
  };
  const begin = () => {
    if (!guard()) return;
    const origin = trial || navigator.webdriver ? 'synthetic-test' : 'human';
    const p = newParticipant(condition === 'auto' ? nextCondition(ps) : condition, rnd(), new Date(), navigator.userAgent, origin);
    setPs((xs) => [...xs, p]);
    setActiveId(p.id);
    setMode('run');
  };
  const resume = (p: MeParticipant) => { if (guard()) { setActiveId(p.id); setMode('run'); } };

  const pending = ps.filter((p) => stageOf(p, now) !== 'done');
  const all = useMemo(() => [...ps, ...imported], [ps, imported]);

  return (
    <div className="stack">
      <section className="card">
        <h2 style={{ margin: 0 }}>감정 상징 기억 평가 — 다음 날에도 떠오를까?</h2>
        <p>같은 분이 <b>오늘 두 단계(첫인상 → 체험)</b>, <b>약 24시간 뒤 한 단계(다시 고르기)</b>를 해요. 처음 보고 맞히는 것보다, 겪은 뒤 기억하고 떠올리는지를 봐요.</p>
        <div className="chips">
          <button type="button" className={mode !== 'results' ? 'chip on' : 'chip'} onClick={() => setMode(active ? 'run' : 'intro')}>평가하기</button>
          {resultsVisible(collection) && <button type="button" className={mode === 'results' ? 'chip on' : 'chip'} disabled={mode === 'run'} onClick={() => setMode('results')}>결과 보기 (정답 공개)</button>}
        </div>
        {!resultsVisible(collection) ? (
          <div className="se-admin">
            <p className="hint">결과와 정답은 <b>모든 참여자가 다음 날 단계까지 끝낸 뒤</b> 진행자가 수집을 끝내야 볼 수 있어요.</p>
            {mode !== 'run' && (!confirmClose ? (
              <button type="button" className="link" onClick={() => setConfirmClose(true)}>진행자: 수집 끝내고 결과 보기</button>
            ) : (
              <p>
                {pending.length > 0 && <span className="bad">아직 끝나지 않은 참여자가 {pending.length}명 있어요. </span>}
                결과를 열면 이 기기에서 정답이 공개돼요.{' '}
                <button type="button" onClick={() => { setCollection((c) => closeCollection(c, new Date())); setConfirmClose(false); setMode('results'); }}>네, 결과 보기</button>{' '}
                <button type="button" className="link" onClick={() => setConfirmClose(false)}>취소</button>
              </p>
            ))}
          </div>
        ) : (
          <div className="se-admin">
            <p className="hint">정답이 공개된 상태예요. 이어서 평가하려면 수집을 다시 여세요.</p>
            <button type="button" className="link" onClick={() => { setCollection((c) => reopenCollection(c)); setMode('intro'); }}>진행자: 수집 다시 열기</button>
          </div>
        )}
      </section>

      {mode === 'intro' && (
        <>
          {pending.length > 0 && (
            <section className="card">
              <h3>이어서 하기</h3>
              <p className="hint">내 코드를 눌러 이어서 해요.</p>
              <ul className="me-list">
                {pending.map((p) => {
                  const st = stageOf(p, now);
                  const h = hoursSinceExposure(p, now);
                  return (
                    <li key={p.id}>
                      <button type="button" className="chip" disabled={st === 'wait'} onClick={() => resume(p)}>{p.code}</button>
                      <span>{STAGE_LABEL[st]}{st === 'wait' && ` · ${Math.ceil(ME_CRITERIA.minHours - h)}시간 뒤부터 (권장 약 24시간 뒤)`}{st === 'c' && ` · 체험 후 ${h.toFixed(0)}시간`}{p.origin !== 'human' && ' · 화면 시험'}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          <section className="card">
            <h3>새 참여자 시작</h3>
            <ul>
              <li><b>오늘(5분):</b> ① 그림 14개를 보고 어떤 마음일지 고르기 → ② 배정된 체험 하기</li>
              <li><b>내일 같은 시간쯤(3분):</b> ③ 같은 그림을 설명 없이 다시 고르고, 체험 때 일이 떠오르는지 답하기</li>
              <li>시작하면 <b>참여자 코드</b>가 나와요. 내일 이 기기에서 코드를 눌러 이어서 해요. 이름은 받지 않아요.</li>
              <li>내일 평가 전까지는 도감이나 앱을 일부러 찾아보지 말아 주세요.</li>
            </ul>
            <label className="field">체험 조건(진행자)
              <select value={condition} onChange={(e) => setCondition(e.target.value as MeCondition | 'auto')}>
                <option value="auto">자동 배정 — 지금은 {CONDITION_LABEL[nextCondition(ps)]}</option>
                {CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
              </select>
            </label>
            <label className="check"><input type="checkbox" checked={trial} onChange={(e) => setTrial(e.target.checked)} /> 실제 평가가 아니라 화면 시험이에요(판정에서 빼기)</label>
            <button type="button" className="wide" onClick={begin}>시작</button>
            {blocked && <p className="bad">{blocked}</p>}
            <p className="hint">세 단계를 마친 참여자 {meCounted(ps).length}명 · 진행 중 {pending.length}명. 3명은 탐색용이에요.</p>
          </section>
        </>
      )}

      {mode === 'run' && active && <Run p={active} items={items} onUpdate={update} onExit={() => { setActiveId(null); setMode('intro'); }} />}

      {mode === 'results' && resultsVisible(collection) && (
        <Results all={all} local={ps} items={items} onImport={(xs) => setImported((p) => [...p, ...xs])} onDeleteLocal={(id) => setPs((xs) => xs.filter((x) => x.id !== id))} />
      )}
    </div>
  );
}

function Run({ p, items, onUpdate, onExit }: { p: MeParticipant; items: Map<string, SeItem>; onUpdate: (p: MeParticipant) => void; onExit: () => void }) {
  const st = stageOf(p, Date.now());
  // A·C 문항 순서는 그 단계를 처음 열 때 한 번 만든다(시작 시각 = C의 경과 시간 기준)
  const missing = (st === 'a' || st === 'c') && !p[st];
  useEffect(() => {
    if (missing) onUpdate({ ...p, [st]: newTest(rnd(), new Date()) });
  }, [missing, st, p, onUpdate]);
  if (st === 'a' || st === 'c') {
    const key = st;
    const t = p[key];
    if (!t) return null;
    const onAnswer = (a: MeAnswer) => {
      const next = { ...t, answers: [...t.answers, a] };
      if (next.answers.length >= next.order.length) {
        const completedAt = new Date().toISOString();
        const breach = isBlindBreach(next, load<string | null>(KEY_REVEALED, null), completedAt);
        onUpdate({ ...p, [key]: { ...next, completedAt, ...(breach ? { blindBreach: true } : {}) } });
      } else onUpdate({ ...p, [key]: next });
    };
    return (
      <>
        <section className="card"><p style={{ margin: 0 }}>참여자 <b>{p.code}</b> · {key === 'a' ? '① 첫인상' : '③ 다음 날 다시 고르기'}</p></section>
        <TestStep key={`${key}-${t.answers.length}`} item={items.get(t.order[t.answers.length]!)!} index={t.answers.length} total={t.order.length} recall={key === 'c'} onAnswer={onAnswer} onQuit={onExit} />
      </>
    );
  }
  if (st === 'b') {
    if (p.condition === 'none') {
      return (
        <section className="card">
          <h3>오늘은 여기까지예요</h3>
          <p>참여자 코드 <b className="me-code">{p.code}</b> 를 기억해 주세요. <b>내일 비슷한 시간</b>에 이 기기에서 코드를 눌러 마지막 단계를 해요.</p>
          <button type="button" className="wide" onClick={() => { const at = new Date().toISOString(); onUpdate({ ...p, b: { startedAt: at, completedAt: at, records: [], guideOpens: 0, guideMs: 0 } }); }}>확인</button>
        </section>
      );
    }
    return (
      <>
        <section className="card"><p style={{ margin: 0 }}>참여자 <b>{p.code}</b> · ② 체험 — {CONDITION_LABEL[p.condition]}</p></section>
        <MemoryExposure condition={p.condition} onDone={(b) => onUpdate({ ...p, b })} />
      </>
    );
  }
  if (st === 'wait') {
    const due = new Date(Date.parse(p.b!.completedAt!) + 24 * 3_600_000);
    return (
      <section className="card">
        <h3>오늘 단계가 끝났어요. 고마워요!</h3>
        <p>참여자 코드 <b className="me-code">{p.code}</b></p>
        <p><b>{due.toLocaleString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })}</b> 쯤 이 기기에서 "이어서 하기"의 내 코드를 눌러 마지막 단계를 해 주세요.</p>
        <p className="hint">그 전까지 도감이나 앱을 일부러 찾아보지 말아 주세요.</p>
        <button type="button" className="wide" onClick={onExit}>처음으로</button>
      </section>
    );
  }
  return (
    <section className="card">
      <h3>모든 단계를 마쳤어요. 정말 고마워요!</h3>
      <p className="hint">결과는 모든 참여자가 끝난 뒤 진행자가 열어요.</p>
      <button type="button" className="wide" onClick={onExit}>처음으로</button>
    </section>
  );
}

function TestStep({ item, index, total, recall, onAnswer, onQuit }: { item: SeItem; index: number; total: number; recall: boolean; onAnswer: (a: MeAnswer) => void; onQuit: () => void }) {
  const [big, setBig] = useState<'loading' | 'ok' | 'error'>('loading');
  const [small, setSmall] = useState<'loading' | 'ok' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
  const [guess, setGuess] = useState<string | null>(null);
  const [conf, setConf] = useState<MeConfidence | null>(null);
  const [rec, setRec] = useState<MeRecall | null>(null);
  const [t0] = useState(() => Date.now());
  const ready = big === 'ok' && small === 'ok';
  const complete = guess && conf && (!recall || rec);
  return (
    <section className="card">
      <div className="row spread">
        <h3 style={{ margin: 0 }}>{index + 1} / {total}</h3>
        <button type="button" className="link" onClick={onQuit}>잠시 멈추기(답은 저장돼요)</button>
      </div>
      <Picture item={item} size="big" retry={retry} onLoad={() => setBig('ok')} onError={() => setBig('error')} />
      {(big === 'error' || small === 'error') && <p className="bad">그림을 불러오지 못했어요. <button type="button" className="link" onClick={() => { setBig('loading'); setSmall('loading'); setRetry((r) => r + 1); }}>다시 불러오기</button></p>}
      <div className="row" style={{ alignItems: 'center', gap: 8 }}>
        <small className="hint">휴대폰 어항에서 보이는 크기(근사):</small>
        <Picture item={item} size="phone" retry={retry} onLoad={() => setSmall('ok')} onError={() => setSmall('error')} />
      </div>
      <p><b>이 흔적은 어떤 마음에서 생겼을까요?</b></p>
      <div className="chips se-choices">
        {GUESS_OPTIONS.map((g) => <button key={g.id} type="button" className={guess === g.id ? 'chip on' : 'chip'} disabled={!ready} onClick={() => setGuess(g.id)}>{g.label}</button>)}
      </div>
      {guess && (
        <>
          <p><b>얼마나 확신하나요?</b></p>
          <div className="chips">{([1, 2, 3] as MeConfidence[]).map((c) => <button key={c} type="button" className={conf === c ? 'chip on' : 'chip'} onClick={() => setConf(c)}>{CONFIDENCE_LABEL[c]}</button>)}</div>
        </>
      )}
      {recall && guess && conf && (
        <>
          <p><b>어제 체험 때 이 흔적과 함께 떠오르는 일이나 마음이 있나요?</b></p>
          <div className="chips">{RECALL_OPTIONS.map((r) => <button key={r.id} type="button" className={rec === r.id ? 'chip on' : 'chip'} onClick={() => setRec(r.id)}>{r.label}</button>)}</div>
        </>
      )}
      <button type="button" className="wide" disabled={!complete} onClick={() => onAnswer({ itemId: item.id, guess: guess!, confidence: conf!, ms: Date.now() - t0, ...(recall ? { recall: rec! } : {}) })}>다음</button>
    </section>
  );
}

function Results({ all, local, items, onImport, onDeleteLocal }: { all: MeParticipant[]; local: MeParticipant[]; items: Map<string, SeItem>; onImport: (xs: MeParticipant[]) => void; onDeleteLocal: (id: string) => void }) {
  const name = (id: string) => items.get(id)?.name ?? id;
  const emo = (id: string) => emotionById(id)?.name ?? guessLabel(id);
  const groups = groupSummary(all).filter((g) => g.participants > 0);
  const split = exposureSplit(all);
  const cf = confusions(all, 'c');
  const report = formatMeReport(all, name, emo);
  const counted = meCounted(all);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState('');
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const copy = async (s: string, what: string) => { try { await navigator.clipboard.writeText(s); setCopied(what); } catch { setCopied('복사하지 못했어요. 길게 눌러 복사해 주세요.'); } };
  return (
    <>
      <section className="card">
        <h3>결과 {counted.length < ME_CRITERIA.minParticipants ? `(보류: 완료 ${counted.length}명, ${ME_CRITERIA.minParticipants}명 이상 필요)` : '(탐색용)'}</h3>
        <p className="hint">정답률이 올라도 같은 그림을 두 번 본 효과일 수 있어요. '노출 없음(대조)'과 비교해 봐요. 회상은 정답률과 따로 봐요.</p>
        <h4>정답률 (상징 12종)</h4>
        <div className="table-wrap"><table>
          <thead><tr><th>조건</th><th>인원</th><th>첫인상</th><th>다음 날</th><th>모름</th><th>확신</th><th>경과</th></tr></thead>
          <tbody>{groups.map((g) => (
            <tr key={g.condition}><td>{CONDITION_LABEL[g.condition]}</td><td>{g.participants}</td><td>{pct(g.aAccuracy)}</td><td>{pct(g.cAccuracy)}</td>
              <td>{pct(g.aUnsure)}→{pct(g.cUnsure)}</td><td>{g.aConfidence.toFixed(1)}→{g.cConfidence.toFixed(1)}</td><td>{g.meanElapsedHours === null ? '—' : `${g.meanElapsedHours.toFixed(1)}h`}</td></tr>
          ))}</tbody>
        </table></div>
        <h4>회상 (다음 날) — 정답률과 별도</h4>
        <div className="table-wrap"><table>
          <thead><tr><th>조건</th>{RECALL_OPTIONS.map((r) => <th key={r.id}>{r.label}</th>)}</tr></thead>
          <tbody>{groups.map((g) => <tr key={g.condition}><td>{CONDITION_LABEL[g.condition]}</td>{RECALL_OPTIONS.map((r) => <td key={r.id}>{g.recall[r.id]}</td>)}</tr>)}</tbody>
        </table></div>
        <h4>체험으로 생겼던 상징 vs 아니었던 상징</h4>
        <ul>{split.map((r) => <li key={r.label}>{r.label}: 정답 {r.correct}/{r.n}{r.n ? ` (${pct(r.correct / r.n)})` : ''}, 또렷·어렴풋 회상 {r.clearOrVague}/{r.n}</li>)}</ul>
        <h4>다음 날에도 반복된 혼동</h4>
        <ul>{cf.length ? cf.map((x) => <li key={x.itemId + x.guess}><img src={`${ASSET_BASE}${items.get(x.itemId)?.src}`} alt="" style={{ height: 22, verticalAlign: 'middle' }} /> {name(x.itemId)}({emo(x.truth)}) → {emo(x.guess)} ×{x.n}</li>) : <li>없음</li>}</ul>
        <div className="row">
          <button type="button" onClick={() => copy(report, '정리 텍스트를 복사했어요')}>정리 텍스트 복사</button>
          <button type="button" onClick={() => copy(JSON.stringify(local, null, 1), '이 기기 원본을 복사했어요')}>이 기기 원본 복사(JSON)</button>
        </div>
        {copied && <p className="hint">{copied}</p>}
      </section>
      <section className="card">
        <h3>다른 기기 기록 합치기</h3>
        <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="다른 기기에서 복사한 원본(JSON)" style={{ width: '100%' }} />
        <button type="button" onClick={() => { try { onImport(parseParticipants(text)); setText(''); setErr(''); } catch (e) { setErr(String((e as Error).message)); } }}>합치기</button>
        {err && <p className="bad">{err}</p>}
      </section>
      <section className="card">
        <h3>참여자 목록</h3>
        <div className="table-wrap"><table>
          <thead><tr><th>코드</th><th>조건</th><th>경과</th><th>상태</th><th></th></tr></thead>
          <tbody>{all.map((p) => {
            const h = elapsedHours(p);
            return (
              <tr key={p.id}><td>{p.code}</td><td>{CONDITION_LABEL[p.condition]}</td><td>{h === null ? '—' : `${h.toFixed(1)}h`}</td><td>{meExclusion(p) ?? '판정에 씀'}</td>
                <td>{local.some((x) => x.id === p.id) && <button type="button" className="link" onClick={() => onDeleteLocal(p.id)}>지우기</button>}</td></tr>
            );
          })}</tbody>
        </table></div>
      </section>
    </>
  );
}
