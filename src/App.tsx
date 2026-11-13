import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AquariumCanvas, type AquariumCanvasHandle } from './ui/AquariumCanvas';
import { useDialog, type AskOptions, type AskResult } from './ui/Dialog';
import { BASE_CHIPS, analyzeMood } from './engine/mood';
import { TankSession, type NewEntry } from './engine/session';
import { littlePrinceConfig, littlePrinceEntries } from './engine/scenarios';
import { localDateIn } from './engine/dates';
import { hashOf, seedFromString } from './engine/random';
import { weekdayMask } from './engine/moss';
import type { Change, Entry, GoalType, TankConfig } from './engine/types';
import type { RenderOptions } from './render/AquariumRenderer';

const TZ = 'Asia/Seoul';
const HOUR = 3_600_000;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const START_NOW = Date.parse('2026-11-13T12:00:00Z'); // 한국 시간 21:00

const LEVEL_LABEL: Record<Change['level'], string> = { daily: '일상', growth: '성장', special: '특별', finale: '완성', info: '안내' };

interface Settings { goalType: GoalType; total: number; daily: number; seedText: string }

function makeConfig(s: Settings, startDate: string): TankConfig {
  return {
    tankId: 'tank-1',
    seed: seedFromString(s.seedText),
    themeId: 'starlit-desert',
    goal: { type: s.goalType, totalUnits: s.total > 0 ? s.total : null, dailyTarget: s.goalType === 'amount' ? s.daily : null },
    startDate,
  };
}

/** 지금 어항의 기록을 검증실(lab.html)로 넘긴다. 같은 브라우저 저장소에 복사본만 둔다. */
function sendToLab(s: TankSession) {
  try {
    window.localStorage.setItem('irurium.lab.import', JSON.stringify(s.toJSON()));
  } catch {
    // 저장소를 쓸 수 없으면 검증실에서 붙여넣기로 가져온다
  }
  window.location.href = './lab.html#user';
}

export function App() {
  const [settings, setSettings] = useState<Settings>({ goalType: 'amount', total: 140, daily: 10, seedText: 'little-prince-7f3a' });
  const [now, setNow] = useState(START_NOW);
  const today = localDateIn(now, TZ);
  const session = useRef(new TankSession(makeConfig(settings, today)));
  const inputLog = useRef<NewEntry[]>([]);
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);
  const canvas = useRef<AquariumCanvasHandle>(null);
  const [lastChanges, setLastChanges] = useState<{ title: string; changes: Change[] } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const demoTimer = useRef<number | null>(null);
  const dialog = useDialog();

  const s = session.current;
  // 읽을 때마다 24시간 경과 확정을 반영한다(v0.3.2 보완서 2.5)
  s.confirmIfDue(now);
  const head = s.head;
  const moss = s.moss(today);
  const options = useMemo<RenderOptions>(() => ({ mossStage: moss.stage, reducedMotion }), [moss.stage, reducedMotion]);
  const invariantErrors = s.checkInvariants({ deep: false });

  // ── 기록 폼 ──
  const [progress, setProgress] = useState('');
  const [chips, setChips] = useState<string[]>([]);
  const [note, setNote] = useState('');
  /** 테스트용: 기록 날짜를 직접 지정(비우면 오늘). 시간대 이동·잘못 넣은 날짜 같은 예외를 화면에서 재현하기 위해. */
  const [entryDate, setEntryDate] = useState('');
  const todaysCount = s.entries.filter((e) => !e.deletedAt && e.localDate === (entryDate || today)).length;

  const preview = analyzeMood(chips, note);

  const save = useCallback((input: NewEntry, at: number) => {
    const ss = session.current;
    const mossBefore = ss.moss(localDateIn(at, TZ)).stage;
    const r = ss.addEntry(input, at);
    if (!r.duplicate) inputLog.current.push(input);
    if (mossBefore > 0) canvas.current?.playCleaning();
    const same = ss.entries.filter((e) => !e.deletedAt && e.localDate === r.entry.localDate).length;
    setLastChanges({
      title: same > 1 ? '오늘 어항에 마음이 더해졌어요' : '어항에 변화가 생겼어요',
      changes: r.snapshot.changes,
    });
    bump();
    return r;
  }, []);

  const onSubmit = async () => {
    const value = Number(progress);
    if (!Number.isFinite(value) || value <= 0) {
      setNotice('지금 읽은 쪽수를 적어 주세요. 활동량만 필수예요.');
      return;
    }
    const prev = s.displayProgress();
    if (value < prev) {
      const r = await dialog.ask({ title: '지난 기록보다 작은 쪽수예요', message: '앞부분을 다시 읽었나요? 진행량은 줄어들지 않고 그대로 유지돼요.', confirmLabel: '네, 저장할게요' });
      if (!r.ok) return;
    }
    const wanted = entryDate || today;
    const r = save({ clientId: crypto.randomUUID(), localDate: wanted, amount: Math.max(0, value - prev), progressValue: value, moodChips: chips, note }, now);
    setNotice(r.entry.localDate !== wanted ? `마지막 기록(${r.entry.localDate})보다 이른 날짜라 ${r.entry.localDate}로 맞췄어요.` : null);
    setChips([]);
    setNote('');
  };

  // ── 시간 ──
  const advance = (ms: number) => setNow((n) => n + ms);

  // ── 데모: 어린왕자 14일 ──
  const stopDemo = () => {
    if (demoTimer.current) window.clearInterval(demoTimer.current);
    demoTimer.current = null;
  };
  const runDemo = () => {
    stopDemo();
    const start = localDateIn(START_NOW, TZ);
    const next: Settings = { goalType: 'amount', total: 140, daily: 10, seedText: 'little-prince-7f3a' };
    setSettings(next);
    session.current = new TankSession(littlePrinceConfig(start, next.seedText));
    inputLog.current = [];
    setNow(START_NOW);
    setLastChanges(null);
    bump();
    const list = littlePrinceEntries(start);
    let i = 0;
    demoTimer.current = window.setInterval(() => {
      const e = list[i];
      if (!e) return stopDemo();
      const at = Date.parse(`${e.localDate}T12:00:00Z`) + i * 60_000;
      setNow(at);
      save(e, at);
      i += 1;
    }, 1400);
  };
  useEffect(() => stopDemo, []);

  const resetTank = (next = settings) => {
    stopDemo();
    session.current = new TankSession(makeConfig(next, today));
    inputLog.current = [];
    setLastChanges(null);
    bump();
  };

  // ── 재현성 확인 ──
  const [replayResult, setReplayResult] = useState<string | null>(null);
  const checkReplay = () => {
    const deepErrors = s.checkInvariants({ deep: true });
    if (deepErrors.length) return setReplayResult(`불변 규칙 위반: ${deepErrors.join(' / ')}`);
    const edited = s.revisions.length > 0 || s.entries.some((e) => e.deletedAt || e.rev > 1);
    if (edited) return setReplayResult('모든 스냅샷을 저장된 입력으로 다시 계산해 봤고 결과가 같아요. 수정·삭제한 기록이 있어 처음부터 다시 넣는 비교는 하지 않았어요.');
    const replayed = TankSession.replay(s.cfg, inputLog.current);
    const current = s.snapshots.filter((x) => x.kind === 'entry').at(-1);
    const currentHash = current ? current.inputHash + ':' + hashOf(current.state) : '';
    setReplayResult(replayed === currentHash || inputLog.current.length === 0 ? '모든 스냅샷을 다시 계산해 봤고, 같은 기록을 처음부터 다시 넣어도 같은 어항이 나왔어요.' : '결과가 달라요. 엔진 재현성 오류예요.');
  };

  const draft = head.status === 'draft' ? head : null;
  const draftEntry = draft ? s.entries.find((e) => e.id === draft.entryId) : undefined;
  const total = s.cfg.goal.totalUnits;
  const restMask = s.restRules.at(-1)?.weekdays ?? 0;

  return (
    <div className="page" data-version={version}>
      <header className="top">
        <div>
          <p className="eyebrow">이루리움(가제) · 어항 시뮬레이터 v0.1</p>
          <h1>나의 모든 성장이 어항이 된다</h1>
        </div>
        <p className="today">
          오늘 {today} ({WEEKDAYS[new Date(`${today}T00:00:00Z`).getUTCDay()]}) · {new Date(now).toLocaleTimeString('ko-KR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })}
        </p>
      </header>

      <main className="grid">
        <section className="left">
          <AquariumCanvas ref={canvas} state={head.state} options={options} />
          <div className="status-row">
            <span className="pill">{s.lifecycle === 'active' ? (moss.resting ? '쉬는 중' : '진행 중') : s.lifecycle === 'completed' ? '완성' : '마무리'}</span>
            {total ? <span>{s.displayProgress()} / {total}쪽</span> : <span>{s.displayProgress()}쪽</span>}
            <span>기록 {s.entries.filter((e) => !e.deletedAt).length}번</span>
            <span>이끼 {moss.stage}단계 (빠진 날 {moss.missedDays})</span>
            <span>물고기 {head.state.objects.filter((o) => o.kind === 'fish').length} · 수초 {head.state.objects.filter((o) => o.kind === 'plant').length} · 수석 {head.state.objects.filter((o) => o.kind === 'rock').length} · 상징 {head.state.objects.filter((o) => o.kind === 'symbol').length}</span>
          </div>

          {s.entries.length === 0 && <p className="empty-hint">어항이 문을 열었어요. 첫 기록을 남기면 어항이 자라기 시작해요. 바로 보고 싶다면 오른쪽 아래 "어린왕자 14일 재생"을 눌러 보세요.</p>}

          {lastChanges && (
            <div className="card changes">
              <h2>{lastChanges.title}</h2>
              <ul>
                {lastChanges.changes.map((c, i) => (
                  <li key={i} className={`lv-${c.level}`}><b>{LEVEL_LABEL[c.level]}</b> {c.text}</li>
                ))}
              </ul>
              {draft && draftEntry && (
                <div className="fix">
                  <span>마음이 달랐나요? (확정 전이라 어항이 다시 계산돼요)</span>
                  <div className="chips">
                    {BASE_CHIPS.map((c) => (
                      <button key={c} className={draftEntry.moodChips.includes(c) ? 'chip on' : 'chip'}
                        onClick={() => {
                          const r = s.editEntry(draftEntry.id, { moodChips: [c] }, draftEntry.rev, now);
                          setLastChanges({ title: r.mode === 'recomputed' ? '고친 마음으로 다시 그렸어요' : '기록만 고쳤어요', changes: s.head.changes });
                          bump();
                        }}>{c}</button>
                    ))}
                  </div>
                  <button className="primary" onClick={() => { s.confirmHead('user', now); bump(); }}>수족관으로 (확정)</button>
                </div>
              )}
            </div>
          )}

          {s.completionPrompt && s.lifecycle === 'active' && (
            <div className="card prompt">
              <h2>끝까지 읽었어요?</h2>
              <p>마지막 쪽에 도착했어요. 완독하면 어항이 완성돼요.</p>
              <div className="row">
                <button className="primary" onClick={() => { s.answerCompletion('finished', now); setLastChanges({ title: '어항이 완성됐어요', changes: s.head.changes }); bump(); }}>다 읽었어요</button>
                <button onClick={() => { s.answerCompletion('not_yet', now); bump(); }}>아직이에요</button>
                <button onClick={async () => {
                  const r = await dialog.ask({ title: '이 어항의 총 쪽수', message: '책 정보는 그대로 두고 이 어항의 목표만 바꿔요.', input: { defaultValue: String(total ?? ''), inputMode: 'numeric' }, confirmLabel: '바꾸기' });
                  const v = Number(r.value);
                  if (r.ok && v > 0) { s.fixTotal(v, now); bump(); }
                }}>총 쪽수가 달라요</button>
              </div>
            </div>
          )}
        </section>

        <aside className="right">
          <div className="card">
            <h2>오늘의 기록</h2>
            {todaysCount > 0 && <p className="hint">오늘 {todaysCount + 1}번째 기록이에요. 큰 변화는 하루 한 번, 마음은 계속 더해져요.</p>}
            <label className="field">지금 읽은 쪽 (필수)
              <input inputMode="numeric" value={progress} onChange={(e) => setProgress(e.target.value)} placeholder={`지난 기록 ${s.displayProgress()}쪽`} disabled={s.lifecycle !== 'active'} />
            </label>
            <div className="field">오늘의 마음 (선택)
              <div className="chips">
                {BASE_CHIPS.map((c) => (
                  <button key={c} className={chips.includes(c) ? 'chip on' : 'chip'} onClick={() => setChips((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]))}>{c}</button>
                ))}
              </div>
            </div>
            <label className="field">한마디 (선택)
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="한 단어도, 이모지도 좋아요" />
            </label>
            <p className="hint">분석: 온도 {preview.temp.toFixed(2)} · 에너지 {preview.energy.toFixed(2)} {preview.confidence === 0 ? '(중립)' : ''}</p>
            {notice && <p className="warn">{notice}</p>}
            <button className="primary wide" onClick={onSubmit} disabled={s.lifecycle !== 'active'}>어항에 담기</button>
            {s.lifecycle === 'active' && (
              <button className="wide subtle" onClick={() => { s.finalize('wrapped', now); setLastChanges({ title: '어항을 전시했어요(마무리)', changes: [] }); bump(); }}>지금까지로 마무리</button>
            )}
          </div>

          <div className="card">
            <h2>시간 · 쉬는 날</h2>
            <div className="row">
              <button onClick={() => advance(3 * HOUR)}>+3시간</button>
              <button onClick={() => advance(24 * HOUR)}>+1일</button>
              <button onClick={() => advance(7 * 24 * HOUR)}>+7일</button>
              <button onClick={() => advance(14 * 24 * HOUR)}>+14일</button>
            </div>
            <p className="hint">미확정 기록은 24시간이 지나면 확정돼요. 오래 쉬면 유리에 이끼가 끼고, 다음 기록에서 닦여요.</p>
            <div className="field">쉬는 요일 (오늘부터 적용, 이전 설정은 이력으로 남아요)
              <div className="chips">
                {WEEKDAYS.map((w, i) => (
                  <button key={w} className={(restMask >> i) & 1 ? 'chip on' : 'chip'} onClick={() => {
                    const days = WEEKDAYS.map((_, j) => j).filter((j) => (j === i ? !((restMask >> j) & 1) : (restMask >> j) & 1));
                    try { s.setRestDays(weekdayMask(days), today); bump(); } catch { setNotice('쉬는 날은 최대 6일까지 고를 수 있어요.'); }
                  }}>{w}</button>
                ))}
              </div>
            </div>
            <p className="hint">쉬는 날 이력: {s.restRules.map((r) => `${r.effectiveFrom}~ ${WEEKDAYS.filter((_, j) => (r.weekdays >> j) & 1).join('') || '없음'}`).join(' → ')}</p>
            <label className="field">기록 날짜 직접 지정 (테스트용, 비우면 오늘)
              <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
            </label>
            <label className="check"><input type="checkbox" checked={reducedMotion} onChange={(e) => setReducedMotion(e.target.checked)} /> 동작 줄이기</label>
          </div>

          <div className="card">
            <h2>기록 목록</h2>
            <Timeline entries={s.entries} session={s} now={now} ask={dialog.ask} onChange={bump} onShow={(title, changes) => setLastChanges({ title, changes })} />
          </div>

          <div className="card">
            <h2>데모 · 검증</h2>
            <div className="row">
              <button className="primary" onClick={runDemo}>어린왕자 14일 재생</button>
              <button onClick={checkReplay}>재현성 확인</button>
            </div>
            {replayResult && <p className="hint">{replayResult}</p>}
            <div className="row" style={{ marginTop: 8 }}>
              <button onClick={() => sendToLab(s)}>검증실로 보내기</button>
              <a className="hint" href="./lab.html">생성 엔진 검증실 열기 →</a>
            </div>
            <p className="hint">검증실로 보내면 지금 어항의 기록이 이 브라우저에 복사되고, 검증실에서 읽기 전용으로 열려요(원본 어항은 그대로).</p>
            <p className={invariantErrors.length ? 'warn' : 'hint'}>불변 규칙 검사: {invariantErrors.length ? invariantErrors.join(' / ') : '통과'}</p>
          </div>

          <div className="card">
            <h2>새 어항 설정</h2>
            <div className="row">
              <label className="check"><input type="radio" checked={settings.goalType === 'amount'} onChange={() => setSettings({ ...settings, goalType: 'amount' })} /> 분량형</label>
              <label className="check"><input type="radio" checked={settings.goalType === 'free'} onChange={() => setSettings({ ...settings, goalType: 'free' })} /> 자유형</label>
            </div>
            <label className="field">총 쪽수 (0이면 모름)<input inputMode="numeric" value={settings.total} onChange={(e) => setSettings({ ...settings, total: Number(e.target.value) || 0 })} /></label>
            {settings.goalType === 'amount' && <label className="field">하루 목표 쪽수<input inputMode="numeric" value={settings.daily} onChange={(e) => setSettings({ ...settings, daily: Number(e.target.value) || 0 })} /></label>}
            <label className="field">시드 (같은 기록이라도 시드가 다르면 배치가 달라져요)<input value={settings.seedText} onChange={(e) => setSettings({ ...settings, seedText: e.target.value })} /></label>
            <button className="wide" onClick={() => resetTank()}>이 설정으로 새 어항 시작</button>
          </div>
        </aside>
      </main>
      {dialog.element}
    </div>
  );
}

function Timeline({ entries, session, now, ask, onChange, onShow }: {
  entries: readonly Entry[]; session: TankSession; now: number; ask: (o: AskOptions) => Promise<AskResult>;
  onChange: () => void; onShow: (t: string, c: Change[]) => void;
}) {
  if (entries.length === 0) return <p className="hint">아직 기록이 없어요.</p>;
  return (
    <ul className="timeline">
      {[...entries].reverse().map((e) => {
        const snap = session.snapshotOfEntry(e.id);
        const status = e.deletedAt ? '삭제한 기록' : snap?.status === 'draft' ? '미확정' : '확정';
        return (
          <li key={e.id} className={e.deletedAt ? 'deleted' : ''}>
            <div>
              <b>#{e.seq}</b> {e.localDate} · {e.progressValue}쪽 · {e.moodChips.join(', ') || '마음 없음'}{e.note ? ` · "${e.note}"` : ''}
              <span className="tag">{status}</span>
            </div>
            {!e.deletedAt && (
              <div className="row small">
                {snap && <button onClick={() => onShow(`#${e.seq} 기록의 변화`, snap.changes)}>변화 보기</button>}
                <button onClick={async () => {
                  const snapNow = session.snapshotOfEntry(e.id);
                  const a = await ask({
                    title: `#${e.seq} 기록의 마음 고치기`,
                    message: snapNow?.status === 'draft' ? '확정 전 기록이라 고친 마음으로 어항이 다시 그려져요.' : '이미 수족관에 담긴 기록이라 어항은 그대로이고 기록만 바뀌어요.',
                    choices: BASE_CHIPS, confirmLabel: '고치기',
                  });
                  if (!a.ok || !a.value) return;
                  const c = a.value;
                  const r = session.editEntry(e.id, { moodChips: [c] }, e.rev, now);
                  onShow(r.mode === 'recomputed' ? '고친 마음으로 다시 그렸어요' : '이미 수족관에 담긴 기록이라 어항은 그대로예요. 기록만 고쳤어요.', r.mode === 'recomputed' ? session.head.changes : []);
                  onChange();
                }}>마음 고치기</button>
                <button onClick={async () => {
                  const draftNow = session.snapshotOfEntry(e.id)?.status === 'draft';
                  const a = await ask({
                    title: `#${e.seq} 기록을 지울까요?`,
                    message: draftNow ? '미확정 기록이라 어항이 직전 모습으로 돌아가요.' : '이미 수족관에 담긴 기록이라 어항은 그대로이고 기록만 숨겨져요.',
                    confirmLabel: '지우기',
                  });
                  if (!a.ok) return;
                  const r = session.deleteEntry(e.id, now);
                  onShow('기록을 지웠어요', [{
                    level: 'info',
                    text: r.mode === 'discarded'
                      ? `#${e.seq}은 미확정 기록이라 어항이 직전 모습으로 돌아갔어요. 이 기록은 이끼와 날짜 계산에서도 빠져요.`
                      : `#${e.seq}은 이미 수족관에 담긴 기록이라 어항은 그대로예요. 기록만 숨겼어요.`,
                  }]);
                  onChange();
                }}>삭제</button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

