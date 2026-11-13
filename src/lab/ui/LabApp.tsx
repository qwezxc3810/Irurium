import { useEffect, useMemo, useState } from 'react';
import { ENGINE_VERSION } from '../../engine/config';
import { seedFromString } from '../../engine/random';
import type { SessionData } from '../../engine/session';
import { distinctness, evaluateHypotheses, VERDICT_LABEL, type HypothesisResult } from '../hypotheses';
import { fmt, LIFECYCLE_LABEL } from '../metrics';
import { buildReport, FOLLOW_UP } from '../report';
import { checkDeterminism, runSuite, runTank, type SuiteResult } from '../runner';
import { LONG_CHECKPOINTS, LONG_DURATIONS } from '../samples';
import type { RunResult, SampleScenario } from '../types';
import { derivedTanks, fingerprintOf, LAB_IMPORT_KEY, parseUserData, userRun, verifyUserData, type IntegrityReport } from '../userData';
import { StyleCompare } from './StyleCompare';
import { DailyTable, DistanceMatrix, FinalTable, FrameModal, Gallery, LineChart, OriginBadge, SERIES_COLORS, Thumb, type OpenFrame } from './components';

/** 수치상 구별을 시각적 구별로 오해하지 않게 하는 안내(리뷰 반영). 보고서에도 같은 뜻으로 들어간다. */
const VISUAL_CAVEAT = '위 감정 구별은 엔진 상태(물빛 조명값·요소 구성)로 계산한 상대적인 수치 지표이고, 지금 샘플과 지금 가중치에서만 성립해요. 실제 관장이 그림을 보고 한눈에 구별할 수 있다는 뜻은 아니에요. 지금 그림은 임시 SVG이고 같은 테마에 물고기가 3종뿐이라, 화면에서 느끼는 차이는 수치보다 작을 수 있어요. 시각적 구별은 짝짓기 테스트(지인 5명 이상, 기준 4/5)로 따로 확인해야 해요.';

type Tab = 'overview' | 'cases' | 'compare' | 'long' | 'hyp' | 'match' | 'style' | 'user';

const TABS: Array<[Tab, string]> = [
  ['overview', '개요'],
  ['cases', '사례 A~F'],
  ['compare', '비교 실험'],
  ['long', '장기 14~200일'],
  ['hyp', '가설 H1~H11'],
  ['match', '짝짓기 테스트'],
  ['style', '그래픽 비교'],
  ['user', '실제 기록'],
];

export function LabApp() {
  const suite = useMemo<SuiteResult>(() => runSuite(), []);
  const hyps = useMemo(() => evaluateHypotheses(suite), [suite]);
  const [tab, setTab] = useState<Tab>(() => (location.hash === '#user' ? 'user' : location.hash === '#style' ? 'style' : 'overview'));
  const [open, setOpen] = useState<OpenFrame | null>(null);
  const [caseId, setCaseId] = useState('case-A');
  const [cmpId, setCmpId] = useState('cmp-emotion');

  const goScenario = (id: string) => {
    const sc = suite.scenarios.find((s) => s.id === id);
    if (!sc) return;
    if (sc.group === 'compare') { setCmpId(id); setTab('compare'); }
    else if (sc.group === 'long') setTab('long');
    else { setCaseId(id); setTab('cases'); }
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="page lab">
      <header className="top">
        <div>
          <p className="eyebrow">이루리움(가제) · 단계 A · 엔진 {ENGINE_VERSION}</p>
          <h1>생성 엔진 검증실</h1>
          <p className="hint" style={{ marginTop: 6 }}>기록과 감정에 따라 나만의 어항이 자라는지, 같은 엔진·같은 렌더러로 직접 비교해 보는 곳이에요. 실제 앱과 분리되어 있고, 엔진 수치는 바꾸지 않아요.</p>
        </div>
        <a className="back" href="./index.html">← 어항 시뮬레이터로</a>
      </header>
      <nav className="tabs" role="tablist">
        {TABS.map(([id, name]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'tab on' : 'tab'} onClick={() => setTab(id)}>{name}</button>
        ))}
      </nav>

      {tab === 'overview' && <Overview suite={suite} hyps={hyps} onHyp={() => setTab('hyp')} />}
      {tab === 'cases' && (
        <ScenarioTab suite={suite} groups={['case', 'experiment']} id={caseId} setId={setCaseId} onOpen={setOpen} />
      )}
      {tab === 'compare' && <ScenarioTab suite={suite} groups={['compare']} id={cmpId} setId={setCmpId} onOpen={setOpen} matrix />}
      {tab === 'long' && <LongTab suite={suite} onOpen={setOpen} />}
      {tab === 'hyp' && <HypTab hyps={hyps} onScenario={goScenario} />}
      {tab === 'match' && <MatchTab suite={suite} />}
      {tab === 'style' && <StyleCompare suite={suite} />}
      {tab === 'user' && <UserTab onOpen={setOpen} />}

      <FrameModal open={open} onClose={() => setOpen(null)} />
    </div>
  );
}

// ───────────────────────── 개요 ─────────────────────────

function Overview({ suite, hyps, onHyp }: { suite: SuiteResult; hyps: HypothesisResult[]; onHyp: () => void }) {
  const dist = useMemo(() => distinctness(suite), [suite]);
  const [det, setDet] = useState<ReturnType<typeof checkDeterminism> | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const all = Object.values(suite.runs).flat();
  const ruleFails = all.flatMap((r) => r.rules.filter((x) => !x.ok).map((x) => `${r.key} ${x.id}`));
  const invFails = all.filter((r) => r.invariants.length > 0);
  const tally = (v: string) => hyps.filter((h) => h.verdict === v).length;
  return (
    <div className="stack">
      <section className="card notice">
        <OriginBadge origin="sample" />
        <p>이 페이지의 사례·비교·장기 결과는 <b>검증용으로 만든 가상 관장의 기록</b>이에요. 실제 사람이 쓴 기록이 아니고, 어항 id는 모두 <code>sample:</code>로 시작해요. 실제 기록은 <b>실제 기록</b> 탭에서 읽기 전용으로만 열어요.</p>
        <p className="hint">샘플 시나리오 {suite.scenarios.length}개 · 어항 {all.length}개 · 브라우저에서 처음부터 계산 {suite.ms}ms · 그림은 실제 앱과 같은 렌더러(임시 SVG)로 그려요.</p>
      </section>

      <section className="card">
        <h2>가설 판정 요약</h2>
        <p className="hint">통과(자동 기준) {tally('pass')} · 조정 필요 {tally('adjust')} · 보류(사람 평가 필요) {tally('hold')}. "통과"는 지인 테스트로 갈 수 있다는 뜻이지 확정이 아니에요.</p>
        <div className="verdict-grid">
          {hyps.map((h) => (
            <button key={h.id} className={`verdict-card v-${h.verdict}`} onClick={onHyp}>
              <b>{h.id}</b> {h.title}
              <span>{VERDICT_LABEL[h.verdict]}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>같은 기록이면 같은 어항, 다른 감정이면 수치상 다른 어항</h2>
        <ul className="checks">
          <li className={dist.ok ? 'ok' : 'bad'}><b>수치 기준 {dist.ok ? '통과' : '미달'}</b> · 감정만 다르고 시드는 같은 어항끼리 가장 비슷한 쌍({dist.emotionMinPair})의 차이 <b>{fmt(dist.emotionMin, 3)}</b> &gt; 감정은 같고 시드만 다른 어항끼리 가장 다른 쌍 <b>{fmt(dist.seedMax, 3)}</b></li>
          <li className={dist.okAB ? 'ok' : 'bad'}><b>수치 기준 {dist.okAB ? '통과' : '미달'}</b> · 사례 B(극단) 가장 비슷한 쌍 <b>{fmt(dist.extremeMin, 3)}</b> &gt; 사례 A(비슷) 가장 다른 쌍 <b>{fmt(dist.similarMax, 3)}</b></li>
          <li className="pending"><b>시각적 구별: 미검증</b> · 짝짓기 테스트(사람 평가) 대기</li>
          <li className={invFails.length ? 'bad' : 'ok'}>불변 규칙 I1~I4(모든 스냅샷 다시 계산 포함): 어항 {all.length}개 중 {all.length - invFails.length}개 통과</li>
          <li className={ruleFails.length ? 'bad' : 'ok'}>하루 규칙(새 오브젝트 1개·주요 변화 1회·조명 30%·확정 순서): {ruleFails.length ? `어긋남 ${ruleFails.join(', ')}` : '모두 통과'}</li>
        </ul>
        <p className="limit">{VISUAL_CAVEAT}</p>
        <div className="row">
          <button className="primary" onClick={() => setDet(checkDeterminism())}>재현성 검사 (전체를 두 번 처음부터)</button>
          <button onClick={() => setReport(buildReport(suite, { determinism: true }))}>보고서 보기(마크다운)</button>
        </div>
        {det && (
          <p className={det.every((d) => d.same) ? 'ok-line' : 'warn'}>
            어항 {det.length}개 중 {det.filter((d) => d.same).length}개가 두 번 모두 같은 스냅샷 해시를 냈어요.
            {det.some((d) => !d.same) && ` 다름: ${det.filter((d) => !d.same).map((d) => d.key).join(', ')}`}
            <span className="hint"> (예: 사례 C {det.find((d) => d.key === 'C')?.a})</span>
          </p>
        )}
        {report && <textarea className="report" readOnly value={report} rows={14} onFocus={(e) => e.currentTarget.select()} />}
      </section>

      <section className="card">
        <h2>감정별 차이(같은 책·같은 시드, 14일 뒤) — 수치 지표</h2>
        <DistanceMatrix runs={suite.runs['cmp-emotion']!.filter((r) => r.tags.emotion !== '감정 없음')} />
      </section>
    </div>
  );
}

// ───────────────────────── 사례·비교 ─────────────────────────

function ScenarioTab({ suite, groups, id, setId, onOpen, matrix }: { suite: SuiteResult; groups: SampleScenario['group'][]; id: string; setId: (v: string) => void; onOpen: (o: OpenFrame) => void; matrix?: boolean }) {
  const list = suite.scenarios.filter((s) => groups.includes(s.group));
  const sc = list.find((s) => s.id === id) ?? list[0]!;
  const runs = suite.runs[sc.id]!;
  const [tankKey, setTankKey] = useState(runs[0]!.key);
  const tank = runs.find((r) => r.key === tankKey) ?? runs[0]!;
  const allDays = Array.from({ length: tank.frames.length }, (_, i) => i + 1);
  return (
    <div className="stack">
      <div className="scenario-picker">
        {list.map((s) => (
          <button key={s.id} className={s.id === sc.id ? 'chip on' : 'chip'} onClick={() => { setId(s.id); setTankKey(suite.runs[s.id]![0]!.key); }}>{s.title}</button>
        ))}
      </div>
      <section className="card">
        <div className="row spread"><h2 style={{ margin: 0 }}>{sc.title}</h2><OriginBadge origin="sample" /></div>
        <p>{sc.summary}</p>
        <p className="watch"><b>볼 것</b> {sc.watch}</p>
        <p className="hint">관련 가설: {sc.hypotheses.join(', ')}</p>
      </section>
      <section className="card">
        <h2>날짜별 어항 갤러리</h2>
        <Gallery runs={runs} days={sc.checkpoints} onOpen={onOpen} />
      </section>
      <section className="card">
        <h2>마지막 날 수치 비교</h2>
        <FinalTable runs={runs} />
        {matrix && runs.length > 1 && (<><h3>어항끼리 차이</h3><DistanceMatrix runs={runs} /></>)}
      </section>
      <section className="card">
        <div className="row spread">
          <h2 style={{ margin: 0 }}>날짜별 수치표</h2>
          <select value={tank.key} onChange={(e) => setTankKey(e.target.value)} aria-label="어항 선택">
            {runs.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </div>
        <DailyTable run={tank} days={tank.frames.length <= 31 ? allDays : sc.checkpoints} />
        <RuleList run={tank} />
      </section>
    </div>
  );
}

function RuleList({ run }: { run: RunResult }) {
  if (!run.rules.length) return null;
  return (
    <ul className="checks small">
      {run.rules.map((r) => <li key={r.id} className={r.ok ? 'ok' : 'bad'}><b>{r.id}</b> {r.name} — {r.detail}</li>)}
    </ul>
  );
}

// ───────────────────────── 장기 ─────────────────────────

function LongTab({ suite, onOpen }: { suite: SuiteResult; onOpen: (o: OpenFrame) => void }) {
  const options: Array<[string, string]> = [['long-steady', '꾸준형 200일'], ['long-sparse', '띄엄형 200일'], ['case-D', '사례 D 150일']];
  const [id, setId] = useState('long-steady');
  const [dur, setDur] = useState<number>(200);
  const sc = suite.scenarios.find((s) => s.id === id)!;
  const run = suite.runs[id]![0]!;
  const maxDays = run.frames.length;
  const d = Math.min(dur, maxDays);
  const checkpoints = (LONG_CHECKPOINTS[dur] ?? LONG_CHECKPOINTS[200]!).map((x) => Math.min(x, maxDays)).filter((x, i, a) => a.indexOf(x) === i);
  const frames = run.frames.slice(0, d);
  const specials = run.events.filter((e) => e.level === 'special' && e.day <= d);
  return (
    <div className="stack">
      <div className="scenario-picker">
        {options.map(([k, name]) => <button key={k} className={k === id ? 'chip on' : 'chip'} onClick={() => setId(k)}>{name}</button>)}
        <span className="sep" />
        {LONG_DURATIONS.map((x) => <button key={x} className={x === dur ? 'chip on' : 'chip'} onClick={() => setDur(x)} disabled={x > maxDays}>{x}일</button>)}
      </div>
      <section className="card">
        <div className="row spread"><h2 style={{ margin: 0 }}>{sc.title} · {d}일까지</h2><OriginBadge origin="sample" /></div>
        <p>{sc.summary}</p>
        <p className="watch"><b>볼 것</b> {sc.watch}</p>
      </section>
      <section className="card">
        <h2>시점별 어항</h2>
        <Gallery runs={[run]} days={checkpoints} onOpen={onOpen} />
      </section>
      <section className="card charts">
        <LineChart
          title="종류별 개수"
          yMin={0}
          yMax={12}
          series={[
            { name: '물고기', color: SERIES_COLORS[0], values: frames.map((f) => f.metrics.fish) },
            { name: '수초', color: SERIES_COLORS[1], values: frames.map((f) => f.metrics.plant) },
            { name: '수석', color: SERIES_COLORS[2], values: frames.map((f) => f.metrics.rock) },
            { name: '상징', color: SERIES_COLORS[3], values: frames.map((f) => f.metrics.symbol) },
          ]}
          markers={specials.map((e) => ({ day: e.day, label: e.text }))}
          unit="개"
        />
        <LineChart
          title="물빛(감정 조명) — 온도: 차가움 -1 ~ 따뜻함 +1, 에너지: 고요 -1 ~ 활발 +1"
          yMin={-1}
          yMax={1}
          series={[
            { name: '온도', color: SERIES_COLORS[1], values: frames.map((f) => f.metrics.lightTemp) },
            { name: '에너지', color: SERIES_COLORS[0], values: frames.map((f) => f.metrics.lightEnergy) },
          ]}
        />
        <p className="hint">특별 변화 {specials.length}회: {specials.map((e) => `${e.day}일`).join(', ') || '없음'}. 아래 표에서 날짜별 값을 그대로 볼 수 있어요.</p>
      </section>
      <section className="card">
        <h2>시점별 수치표</h2>
        <DailyTable run={run} days={checkpoints} />
      </section>
    </div>
  );
}

// ───────────────────────── 가설 ─────────────────────────

function HypTab({ hyps, onScenario }: { hyps: HypothesisResult[]; onScenario: (id: string) => void }) {
  return (
    <div className="stack">
      <section className="card notice">
        <p><b>판정 기준</b> · <span className="v v-pass">통과(자동 기준)</span> 시뮬레이터로 잴 수 있는 기준을 넘음(지인 테스트로 진행, 확정 아님) · <span className="v v-adjust">조정 필요</span> 기준 미달이거나 문서 초깃값과 구현이 다름 · <span className="v v-hold">보류(사람 평가 필요)</span> 실제 사용자 평가·실기기 측정이 있어야 판단, 자동 측정이 좋아도 통과로 올리지 않음</p>
      </section>
      <section className="card">
        <h2>후속 실험 과제</h2>
        <p className="hint">H5·H9 엔진 수치는 이번 PR에서 바꾸지 않았어요. 바꿀 때는 한 번에 하나만, ENGINE_VERSION을 올려서.</p>
        <div className="table-wrap">
          <table className="metrics">
            <thead><tr><th>과제</th><th>왜</th><th>먼저 할 일</th></tr></thead>
            <tbody>{FOLLOW_UP.map((f) => <tr key={f.task}><td className="name">{f.task}</td><td>{f.why}</td><td className="events">{f.first}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
      {hyps.map((h) => (
        <section key={h.id} className={`card hyp v-border-${h.verdict}`}>
          <div className="row spread">
            <h2 style={{ margin: 0 }}>{h.id} {h.title}</h2>
            <span className={`v v-${h.verdict}`}>{VERDICT_LABEL[h.verdict]}</span>
          </div>
          <dl className="kv">
            <dt>초깃값</dt><dd>{h.initial}</dd>
            <dt>확인하는 것</dt><dd>{h.question}</dd>
            <dt>통과 기준(초안)</dt><dd>{h.criterion}</dd>
          </dl>
          <ul className="measures">
            {h.measures.map((m, i) => <li key={i} className={m.ok === true ? 'ok' : m.ok === false ? 'bad' : 'ref'}><span>{m.label}</span><b>{m.value}</b></li>)}
          </ul>
          {h.humanPart && <p className="human"><b>사람 평가</b> {h.humanPart}</p>}
          <p className="reason"><b>판단 근거</b> {h.reason}</p>
          {h.scenarios.length > 0 && (
            <div className="row small">{h.scenarios.map((id) => <button key={id} onClick={() => onScenario(id)}>{id} 보기</button>)}</div>
          )}
        </section>
      ))}
    </div>
  );
}

// ───────────────────────── 짝짓기 ─────────────────────────

function MatchTab({ suite }: { suite: SuiteResult }) {
  const [source, setSource] = useState<'case-B' | 'cmp-emotion'>('case-B');
  const [round, setRound] = useState(1);
  const runs = suite.runs[source]!.filter((r) => r.tags.emotion && r.tags.emotion !== '감정 없음');
  const emotions = runs.map((r) => r.tags.emotion!);
  const order = useMemo(() => {
    const idx = runs.map((_, i) => i);
    let s = seedFromString(`match:${round}`);
    for (let i = idx.length - 1; i > 0; i--) {
      s = (s * 1103515245 + 12345) >>> 0;
      const j = s % (i + 1);
      [idx[i], idx[j]] = [idx[j]!, idx[i]!];
    }
    return idx;
  }, [round, runs.length]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [graded, setGraded] = useState(false);
  useEffect(() => { setAnswers({}); setGraded(false); }, [round, source]);
  const score = order.filter((i) => answers[i] === runs[i]!.tags.emotion).length;
  return (
    <div className="stack">
      <section className="card notice">
        <OriginBadge origin="sample" />
        <p>사례 B의 다섯 어항(14일 뒤)을 순서를 섞어 보여 줘요. 그림만 보고 어떤 감정으로 자란 어항인지 골라 보세요. v0.3.1 기준은 <b>5개 중 4개 이상</b>이에요. 지인에게 보여 줄 때는 이 화면을 그대로 쓰면 돼요.</p>
        <p className="hint">개요 탭의 감정 구별은 엔진 상태로 계산한 <b>수치 기준</b>이에요. 실제로 눈으로 구별되는지는 이 테스트를 여러 사람에게 해 봐야 알 수 있어요(아직 미검증). 기획자·개발자가 직접 맞힌 결과는 정답을 알고 있어서 근거로 쓰지 않아요.</p>
        <div className="row">
          <button className={source === 'case-B' ? 'chip on' : 'chip'} onClick={() => setSource('case-B')}>사례 B(시드도 다름)</button>
          <button className={source === 'cmp-emotion' ? 'chip on' : 'chip'} onClick={() => setSource('cmp-emotion')}>감정만 다름(시드 같음)</button>
          <button onClick={() => setRound((r) => r + 1)}>순서 다시 섞기</button>
        </div>
      </section>
      <div className="match-grid">
        {order.map((i, n) => {
          const r = runs[i]!;
          const f = r.frames[r.frames.length - 1]!;
          const right = answers[i] === r.tags.emotion;
          return (
            <div key={`${round}-${i}`} className={`card match ${graded ? (right ? 'ok' : 'bad') : ''}`}>
              <b>어항 {String.fromCharCode(65 + n)}</b>
              <Thumb frame={f} big />
              <select value={answers[i] ?? ''} onChange={(e) => setAnswers((a) => ({ ...a, [i]: e.target.value }))} aria-label={`어항 ${String.fromCharCode(65 + n)}의 감정`}>
                <option value="">감정 고르기</option>
                {emotions.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
              {graded && <span className="hint">정답: {r.tags.emotion}</span>}
            </div>
          );
        })}
      </div>
      <div className="row">
        <button className="primary" onClick={() => setGraded(true)} disabled={Object.keys(answers).length < runs.length}>채점</button>
        {graded && <b className={score >= 4 ? 'ok-line' : 'warn'}>{score}/{runs.length} 정답 {score >= 4 ? '· 기준(4개 이상) 충족' : '· 기준 미달'}</b>}
      </div>
      <p className="hint">결과는 저장하지 않아요. 지인 테스트 기록에 직접 남겨 주세요(H1·H3·H7 사람 평가 근거).</p>
    </div>
  );
}

// ───────────────────────── 실제 기록 ─────────────────────────

function readImport(): string | null {
  try {
    return window.localStorage.getItem(LAB_IMPORT_KEY);
  } catch {
    return null;
  }
}

function UserTab({ onOpen }: { onOpen: (o: OpenFrame) => void }) {
  const [text, setText] = useState('');
  const [data, setData] = useState<Readonly<SessionData> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [derived, setDerived] = useState<RunResult[] | null>(null);
  const [check, setCheck] = useState<{ before: string; after: string } | null>(null);

  const load = (json: string) => {
    try {
      setData(parseUserData(json));
      setError(null);
      setDerived(null);
      setCheck(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    const saved = readImport();
    if (saved) load(saved);
  }, []);

  const integrity: IntegrityReport | null = useMemo(() => (data ? verifyUserData(data) : null), [data]);
  const run = useMemo(() => (data ? userRun(data) : null), [data]);
  const days = run ? (run.frames.length <= 14 ? run.frames.map((f) => f.day) : spread(run.frames.length, 8)) : [];

  return (
    <div className="stack">
      <section className="card notice">
        <OriginBadge origin="user" />
        <p>어항 시뮬레이터에서 <b>검증실로 보내기</b>를 누르면 그 어항의 기록이 여기에 열려요. 저장된 스냅샷을 <b>그대로</b> 보여 주고, 다시 계산하거나 바꾸지 않아요(가져오자마자 얼려서 실수로도 못 바꿔요).</p>
        <details>
          <summary>JSON 붙여넣기로 가져오기</summary>
          <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder='{"cfg":…,"entries":[…],"snapshots":[…]}' />
          <button onClick={() => load(text)}>불러오기</button>
        </details>
        {error && <p className="warn">{error}</p>}
        {!data && !error && <p className="hint">아직 가져온 실제 기록이 없어요. <a href="./index.html">어항 시뮬레이터</a>에서 기록을 남긴 뒤 "검증실로 보내기"를 눌러 주세요.</p>}
      </section>

      {data && run && integrity && (
        <>
          <section className="card">
            <h2>무결성(읽기 전용 확인)</h2>
            <ul className="checks">
              <li className={integrity.problems.length ? 'bad' : 'ok'}>스냅샷 {integrity.checked}개를 저장된 입력으로 다시 계산해 해시만 비교: {integrity.problems.length ? integrity.problems.slice(0, 3).join(' / ') : '모두 일치'}</li>
              <li className="ok">원본 지문 <code>{integrity.fingerprint}</code> · 기록 {run.entryCount}개 · 어항 {data.cfg.tankId} · 저장된 상태 {LIFECYCLE_LABEL[data.lifecycle]}</li>
              {check && <li className={check.before === check.after ? 'ok' : 'bad'}>가상 실험 전후 원본 지문: {check.before} → {check.after} {check.before === check.after ? '(그대로)' : '(바뀜!)'}</li>}
            </ul>
          </section>
          <section className="card">
            <div className="row spread"><h2 style={{ margin: 0 }}>내 어항 날짜별</h2><OriginBadge origin="user" /></div>
            {run.notes.map((n) => <p key={n} className="limit">{n}</p>)}
            <Gallery runs={[run]} days={days} onOpen={onOpen} />
            <DailyTable run={run} days={days} />
          </section>
          <section className="card">
            <div className="row spread"><h2 style={{ margin: 0 }}>같은 기록 · 다른 시드라면?</h2><OriginBadge origin="derived" /></div>
            <p className="hint">기록을 복사해 별도 어항(<code>derived:</code>)으로 다시 키워 봐요. 원본 어항과 스냅샷에는 손대지 않아요.</p>
            <button onClick={() => {
              const before = fingerprintOf(data);
              const runs = derivedTanks(data, [1, 2, 3].map((i) => seedFromString(`derived:${i}`))).map((t) => runTank(t, 'derived'));
              setDerived(runs);
              setCheck({ before, after: fingerprintOf(data) });
            }}>시드 3개로 다시 키워 보기</button>
            {derived && (<><Gallery runs={[run, ...derived]} days={days} onOpen={onOpen} /><FinalTable runs={[run, ...derived]} /></>)}
          </section>
        </>
      )}
    </div>
  );
}

function spread(n: number, k: number): number[] {
  const out = new Set<number>([1, n]);
  for (let i = 1; i < k - 1; i++) out.add(Math.round(1 + ((n - 1) * i) / (k - 1)));
  return [...out].sort((a, b) => a - b);
}
