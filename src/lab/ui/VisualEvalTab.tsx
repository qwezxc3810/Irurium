import { useCallback, useEffect, useMemo, useState } from 'react';
import { AquariumCanvas } from '../../ui/AquariumCanvas';
import type { RenderOptions } from '../../render/AquariumRenderer';
import {
  autoMetrics, blindPair, compareRows, countedSessions, EMOTION_LABEL, formatV1Report, GUESS_LABEL, newSession, PAIR_KIND_LABEL,
  parseSessions, runVisualSet, SAME_LABEL, v1Verdict, V1_CRITERIA, V1_VERDICT_LABEL, VE_DAYS,
  type EmotionGuess, type SameAnswer, type VeAnswer, type VeSession,
} from '../visualEval';
import { fmt } from '../metrics';
import { OriginBadge } from './components';

/**
 * V1 감정별 어항 다양성 — 블라인드 시각 평가 화면.
 * 평가 중에는 어떤 감정·어떤 쌍인지 보여 주지 않는다. 결과는 이 기기 저장소에만 두고, 사람이 내보내서 모은다.
 */

const OPTIONS: RenderOptions = { mossStage: 0, reducedMotion: false };
const KEY_DONE = 'irurium.visualEval.sessions';
const KEY_CURRENT = 'irurium.visualEval.current';

function load<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function save(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 저장 못 해도 화면은 동작 */ }
}

type Mode = 'intro' | 'eval' | 'done' | 'results';

export function VisualEvalTab() {
  const set = useMemo(() => runVisualSet(), []);
  const [mode, setMode] = useState<Mode>(() => (load<VeSession | null>(KEY_CURRENT, null) ? 'eval' : 'intro'));
  const [current, setCurrent] = useState<VeSession | null>(() => load<VeSession | null>(KEY_CURRENT, null));
  const [done, setDone] = useState<VeSession[]>(() => load<VeSession[]>(KEY_DONE, []));
  const [imported, setImported] = useState<VeSession[]>([]);
  const [evaluator, setEvaluator] = useState('');
  const [trial, setTrial] = useState(false);

  useEffect(() => save(KEY_CURRENT, current), [current]);
  useEffect(() => save(KEY_DONE, done), [done]);

  const start = () => {
    const seed = (crypto.getRandomValues(new Uint32Array(1))[0] ?? Date.now()) >>> 0;
    // 화면 시험이거나 자동화 브라우저면 판정에서 빼는 '테스트용'으로 저장
    const origin = trial || navigator.webdriver ? 'synthetic-test' : 'human';
    setCurrent(newSession(evaluator, seed, new Date(), navigator.userAgent, origin));
    setMode('eval');
  };

  const answer = useCallback((a: VeAnswer) => {
    if (!current) return;
    const next = { ...current, answers: [...current.answers.filter((x) => x.pairId !== a.pairId), a] };
    if (next.answers.length >= next.order.length) {
      setDone((d) => [...d, { ...next, completedAt: new Date().toISOString() }]);
      setCurrent(null);
      setMode('done');
    } else {
      setCurrent(next);
    }
  }, [current]);

  const all = useMemo(() => [...done, ...imported], [done, imported]);
  const last = done[done.length - 1] ?? null;

  return (
    <div className="stack">
      <section className="card">
        <div className="row spread"><h2 style={{ margin: 0 }}>V1 감정별 어항 다양성 — 시각 평가</h2><OriginBadge origin="sample" /></div>
        <p>같은 책을 같은 속도로 읽어도, 기록한 감정에 따라 어항이 충분히 다르게 보이는지 사람 눈으로 확인해요. 어항은 모두 샘플 기록으로 만들었어요.</p>
        <div className="chips">
          <button type="button" className={mode === 'intro' || mode === 'eval' || mode === 'done' ? 'chip on' : 'chip'} onClick={() => setMode(current ? 'eval' : last && mode === 'done' ? 'done' : 'intro')}>평가하기</button>
          <button type="button" className={mode === 'results' ? 'chip on' : 'chip'} onClick={() => setMode('results')}>결과 모으기·보기 (정답 공개)</button>
        </div>
      </section>

      {mode === 'intro' && (
        <section className="card">
          <h3>평가 방법</h3>
          <ul>
            <li>어항 두 개를 나란히 보여 드려요. 모두 {set.pairs.length}쌍, 10분 정도 걸려요.</li>
            <li>쌍마다 세 가지를 물어요: <b>같은 기록으로 만든 어항 같은지</b>, <b>각 어항에서 어떤 감정이 느껴지는지</b>, <b>두 어항이 얼마나 다른지</b>.</li>
            <li>정답(어떤 감정으로 만들었는지)은 다 끝난 뒤에 보여 드려요. 끝나기 전에는 "결과 모으기·보기"를 열지 마세요.</li>
            <li>결과는 이 기기에만 저장돼요. 끝나면 "결과 복사"로 기획자에게 보내 주세요.</li>
          </ul>
          <label className="field">평가자 별칭(선택, 이름 대신 이니셜 등)<input value={evaluator} maxLength={40} onChange={(e) => setEvaluator(e.target.value)} /></label>
          <label className="check"><input type="checkbox" checked={trial} onChange={(e) => setTrial(e.target.checked)} /> 실제 평가가 아니라 화면 시험이에요(판정에서 빼기)</label>
          <button type="button" className="wide" onClick={start}>평가 시작</button>
        </section>
      )}

      {mode === 'eval' && current && <EvalStep key={current.answers.length} set={set} session={current} onAnswer={answer} onQuit={() => { setCurrent(null); setMode('intro'); }} />}

      {mode === 'done' && last && <DoneView set={set} session={last} />}

      {mode === 'results' && <ResultsView set={set} done={done} imported={imported} onImport={(xs) => setImported((p) => [...p, ...xs])} onClearImported={() => setImported([])} all={all} />}
    </div>
  );
}

function EvalStep({ set, session, onAnswer, onQuit }: { set: ReturnType<typeof runVisualSet>; session: VeSession; onAnswer: (a: VeAnswer) => void; onQuit: () => void }) {
  const answered = new Set(session.answers.map((a) => a.pairId));
  const index = session.order.findIndex((o) => !answered.has(o.pairId));
  const bp = blindPair(set, session.order, index);
  const swap = session.order[index]!.swap;
  const [same, setSame] = useState<SameAnswer | null>(null);
  const [left, setLeft] = useState<EmotionGuess | null>(null);
  const [right, setRight] = useState<EmotionGuess | null>(null);
  const [diff, setDiff] = useState<1 | 2 | 3 | 4 | 5 | null>(null);
  const [note, setNote] = useState('');
  const ready = same && left && right && diff;
  const guessOptions = (Object.keys(GUESS_LABEL) as EmotionGuess[]);

  return (
    <section className="card">
      <div className="row spread">
        <h3 style={{ margin: 0 }}>{index + 1} / {session.order.length} · {bp.day}일째 어항</h3>
        <button type="button" className="link" onClick={onQuit}>그만하기(지금까지 답은 버림)</button>
      </div>
      <div className="ve-pair">
        <figure><figcaption>어항 A</figcaption><AquariumCanvas state={bp.left} options={OPTIONS} label="평가 어항 A" /></figure>
        <figure><figcaption>어항 B</figcaption><AquariumCanvas state={bp.right} options={OPTIONS} label="평가 어항 B" /></figure>
      </div>
      <div className="ve-q">
        <p><b>1. 두 어항이 같은 기록(같은 감정 기록)으로 만든 어항 같나요?</b></p>
        <div className="chips">{(Object.keys(SAME_LABEL) as SameAnswer[]).map((k) => <button key={k} type="button" className={same === k ? 'chip on' : 'chip'} onClick={() => setSame(k)}>{SAME_LABEL[k]}</button>)}</div>
        <p><b>2. 각 어항에서 어떤 감정이 느껴지나요?</b></p>
        <p className="hint">어항 A</p>
        <div className="chips">{guessOptions.map((k) => <button key={k} type="button" className={left === k ? 'chip on' : 'chip'} onClick={() => setLeft(k)}>{GUESS_LABEL[k]}</button>)}</div>
        <p className="hint">어항 B</p>
        <div className="chips">{guessOptions.map((k) => <button key={k} type="button" className={right === k ? 'chip on' : 'chip'} onClick={() => setRight(k)}>{GUESS_LABEL[k]}</button>)}</div>
        <p><b>3. 두 어항이 얼마나 달라 보이나요?</b> <span className="hint">1 거의 같음 · 5 완전히 다름</span></p>
        <div className="chips">{([1, 2, 3, 4, 5] as const).map((k) => <button key={k} type="button" className={diff === k ? 'chip on' : 'chip'} onClick={() => setDiff(k)}>{k}</button>)}</div>
        <label className="field">한마디(선택)<input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} /></label>
        <button type="button" className="wide" disabled={!ready} onClick={() => ready && onAnswer({ pairId: bp.pairId, swap, same, emotionLeft: left, emotionRight: right, diff, note: note.trim() || undefined })}>
          {index + 1 === session.order.length ? '마치기' : '다음'}
        </button>
      </div>
    </section>
  );
}

function DoneView({ set, session }: { set: ReturnType<typeof runVisualSet>; session: VeSession }) {
  const [copied, setCopied] = useState('');
  const text = JSON.stringify(session, null, 1);
  const pairs = new Map(set.pairs.map((p) => [p.id, p]));
  const emo = (k: string) => set.tanks.find((t) => t.key === k)!.emotion;
  return (
    <section className="card">
      <h3>수고하셨어요! 정답 공개</h3>
      {session.origin !== 'human' && <p className="bad">이 결과는 화면 시험(테스트용)으로 저장돼서 판정에 쓰지 않아요.</p>}
      <p>아래 "결과 복사"를 눌러 기획자에게 보내 주세요. 이 기기에도 저장돼 있어요.</p>
      <div className="row">
        <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied('복사했어요'); } catch { setCopied('자동 복사가 막혔어요. 아래 글상자에서 직접 복사해 주세요'); } }}>결과 복사</button>
        {copied && <span className="hint">{copied}</span>}
      </div>
      <textarea className="perf-text" readOnly rows={4} value={text} onFocus={(e) => e.currentTarget.select()} />
      <div className="table-wrap">
        <table>
          <thead><tr><th>#</th><th>날짜</th><th>쌍 종류(정답)</th><th>어항 A · B 실제 감정</th><th>내 답: 같은 기록?</th><th>내 감정 추측 A · B</th><th>차이</th></tr></thead>
          <tbody>
            {session.order.map((o, i) => {
              const a = session.answers.find((x) => x.pairId === o.pairId)!;
              const p = pairs.get(o.pairId)!;
              const [lk, rk] = o.swap ? [p.b, p.a] : [p.a, p.b];
              return (
                <tr key={o.pairId}>
                  <td>{i + 1}</td><td>{p.day}일</td><td>{PAIR_KIND_LABEL[p.kind]}</td>
                  <td>{shortEmo(emo(lk))} · {shortEmo(emo(rk))}</td>
                  <td>{SAME_LABEL[a.same]} {(p.sameRecords ? a.same === 'same' : a.same === 'different') ? '✓' : '✗'}</td>
                  <td>{shortGuess(a.emotionLeft)} · {shortGuess(a.emotionRight)}</td>
                  <td>{a.diff}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const shortEmo = (k: string) => ({ warm: '따뜻', cool: '차가움', swing: '변화 큼' } as Record<string, string>)[k] ?? k;
const shortGuess = (k: EmotionGuess) => (k === 'unsure' ? '모름' : shortEmo(k));

function ResultsView({ set, done, imported, onImport, onClearImported, all }: {
  set: ReturnType<typeof runVisualSet>; done: VeSession[]; imported: VeSession[]; onImport: (xs: VeSession[]) => void; onClearImported: () => void; all: VeSession[];
}) {
  const [paste, setPaste] = useState('');
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState('');
  const metrics = useMemo(() => autoMetrics(set), [set]);
  const rows = compareRows(set, all);
  const verdict = v1Verdict(all);
  const counted = countedSessions(all);
  const report = formatV1Report(set, all);

  return (
    <>
      <section className="card">
        <h3>판정: {V1_VERDICT_LABEL[verdict.verdict]}</h3>
        <ul>{verdict.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        <p className="hint">판정에는 <b>실제 사람 평가</b>(끝까지 답한 세션, 같은 세션은 한 번)만 써요. 자동 수치는 비교용이고 판정에 넣지 않아요. 기준은 초안이에요(최소 {V1_CRITERIA.minEvaluators}명, 감정 쌍 '다른 기록' {Math.round(V1_CRITERIA.emotionDifferentRate * 100)}% 이상, 차이 점수 감정−시드 {V1_CRITERIA.diffGap} 이상, 감정 맞히기 {Math.round(V1_CRITERIA.emotionGuessRate * 100)}% 이상).</p>
        <p>이 기기 평가 {done.length}개 · 가져온 평가 {imported.length}개 · 판정에 쓴 실제 사람 평가 {counted.length}명</p>
      </section>

      <section className="card">
        <h3>자동 수치 ↔ 사람 평가 (날짜별)</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th rowSpan={2}>날짜</th><th colSpan={3}>자동 수치 (엔진 상태, 기존 감정 구별 거리)</th><th colSpan={4}>사람 평가 ({counted.length}명)</th></tr>
              <tr><th>감정 쌍 최소</th><th>시드 쌍 최대</th><th>기존 기준</th><th>차이 점수 감정 쌍</th><th>차이 점수 시드 쌍</th><th>감정 쌍 '다른 기록'</th><th>감정 맞힘</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.day}>
                  <td>{r.day}일</td><td>{fmt(r.autoEmotionMin, 3)}</td><td>{fmt(r.autoSeedMax, 3)}</td><td>{r.autoOk ? '통과(수치)' : '미달(수치)'}</td>
                  <td>{r.humanEmotionDiff == null ? '-' : fmt(r.humanEmotionDiff)}</td><td>{r.humanSeedDiff == null ? '-' : fmt(r.humanSeedDiff)}</td>
                  <td>{r.humanEmotionDifferentRate == null ? '-' : `${Math.round(r.humanEmotionDifferentRate * 100)}%`}</td>
                  <td>{r.humanEmotionGuess == null ? '-' : `${Math.round(r.humanEmotionGuess * 100)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">자동 거리는 감정 쪽 구성과 물빛만 봐요(배치 위치는 안 봄). 시드만 다른 쌍은 이 거리가 0이어도 배치가 달라서(배치 차이 {fmt(Math.min(...metrics.filter((m) => m.kind === 'seed').map((m) => m.layout)))}~{fmt(Math.max(...metrics.filter((m) => m.kind === 'seed').map((m) => m.layout)))}) 사람 눈에는 달라 보일 수 있어요. 이 차이를 사람 평가로 확인해요.</p>
        <div className="row">
          <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(report); setCopied('정리 텍스트를 복사했어요'); } catch { setCopied('자동 복사가 막혔어요. 아래에서 직접 복사해 주세요'); } }}>정리 텍스트 복사</button>
          {copied && <span className="hint">{copied}</span>}
        </div>
        <textarea className="perf-text" readOnly rows={8} value={report} onFocus={(e) => e.currentTarget.select()} />
      </section>

      <section className="card">
        <h3>평가 결과 가져오기</h3>
        <p className="hint">다른 사람이 보낸 "결과 복사" 내용을 붙여 넣어요(여러 개면 하나씩). 가져온 결과는 이 화면에서만 쓰고 저장하지 않아요.</p>
        <textarea className="perf-text" rows={4} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder='{"schema":"irurium.visual-eval.v1", ...}' />
        <div className="row">
          <button type="button" onClick={() => { try { onImport(parseSessions(paste)); setPaste(''); setErr(''); } catch (e) { setErr((e as Error).message); } }}>가져오기</button>
          {imported.length > 0 && <button type="button" onClick={onClearImported}>가져온 결과 지우기</button>}
          {err && <span className="bad">{err}</span>}
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>세션</th><th>평가자</th><th>출처</th><th>답한 쌍</th><th>판정에 씀</th></tr></thead>
            <tbody>
              {all.map((s) => (
                <tr key={s.sessionId + s.startedAt}>
                  <td>{s.sessionId}</td><td>{s.evaluator || '-'}</td><td>{s.origin === 'human' ? '사람' : '테스트용(판정 제외)'}</td>
                  <td>{s.answers.length}/{s.order.length}</td><td>{counted.some((c) => c.sessionId === s.sessionId) ? '✓' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h3>평가에 쓴 어항 (정답)</h3>
        <ul>{set.tanks.map((t) => <li key={t.key}><b>{t.key}</b> — {EMOTION_LABEL[t.emotion]} · 시드 {t.seedText}</li>)}</ul>
        <p className="hint">같은 책(총 5000쪽, 하루 20쪽)·같은 날짜·같은 쪽수. 감정 쌍은 같은 시드(seed-a)에서 감정 칩만 다르고, 시드 쌍은 차가운 감정 기록이 같고 시드만 달라요. 날짜: {VE_DAYS.join('·')}일. 쌍마다 좌우와 순서는 평가자마다 무작위예요.</p>
      </section>
    </>
  );
}
