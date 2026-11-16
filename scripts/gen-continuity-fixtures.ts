// 엔진 0.1.0으로 연속성 검증 고정 파일을 만든다(docs/CONTINUITY.md). 사용법:
//   git worktree add /tmp/eng010 bb039c0 && ln -s "$PWD/node_modules" /tmp/eng010/node_modules
//   cd /tmp/eng010 && ROOT=/tmp/eng010 OUT=<저장소>/src/engine/__tests__/fixtures npx vite-node <저장소>/scripts/gen-continuity-fixtures.ts
import { writeFileSync } from 'node:fs';
const ROOT = process.env.ROOT!;
const OUT = process.env.OUT!;
const { TankSession } = await import(`${ROOT}/src/engine/session.ts`);
const { littlePrinceConfig } = await import(`${ROOT}/src/engine/scenarios.ts`);
const { ENGINE_VERSION } = await import(`${ROOT}/src/engine/config.ts`);
const { addDays } = await import(`${ROOT}/src/engine/dates.ts`);

const START = '2026-08-01';
const DAY = 86400000;
const t0 = Date.UTC(2026, 7, 1, 12); // 21시 KST
const CHIPS = [['차분함'], ['쓸쓸함'], ['차분함'], ['그리움'], ['따뜻함'], ['차분함'], ['막막함']];
const cfg = { ...littlePrinceConfig(START, 'continuity-7c1e'), tankId: 'fixture:continuity', title: '연속성 검증 어항(0.1.0)' };
cfg.goal = { type: 'amount', totalUnits: 3000, dailyTarget: 20 };
const entry = (day: number, page: number, tag = '') => ({
  clientId: `c-${day}${tag}`, localDate: addDays(START, day), amount: 20, progressValue: page, moodChips: CHIPS[day % CHIPS.length], note: day % 9 === 0 ? '오늘은 조용히 읽었다' : '',
});

function build(days: number, leaveDraft: boolean) {
  const s = new TankSession(cfg);
  let page = 0;
  for (let d = 0; d < days; d++) {
    const now = t0 + d * DAY;
    page += 20;
    s.addEntry(entry(d, page), now);
    if (d === 45) {
      // 미확정 상태에서 지운 기록(폐기): 같은 날 실수 입력
      s.addEntry(entry(d, page + 5, '-mistake'), now + 60000);
      const last = s.entries[s.entries.length - 1];
      s.deleteEntry(last.id, now + 120000);
    }
    if (d === 30) {
      // 확정된 기록 숨김: 20번째 기록(이미 확정)
      s.deleteEntry('e21', now + 1000);
      // 확정된 기록 한마디 수정(기록만 바뀌고 스냅샷은 그대로)
      const e = s.entries.find((x: { id: string }) => x.id === 'e11');
      s.editEntry('e11', { note: '다시 읽어 보니 좋았다' }, e.rev, now + 2000);
    }
    if (d === 38) s.setRestDays(0b1000001, addDays(START, d)); // 토·일 쉬는 날
  }
  const end = t0 + days * DAY;
  if (!leaveDraft) s.confirmIfDue(end + DAY); // 24시간 지나 확정
  const errs = s.checkInvariants({ deep: true });
  if (errs.length) throw new Error(errs.join('\n'));
  return s;
}

const confirmed = build(60, false);
const draft = build(60, true);
writeFileSync(`${OUT}/continuity-0.1.0-confirmed.json`, JSON.stringify(confirmed.toJSON()));
writeFileSync(`${OUT}/continuity-0.1.0-draft.json`, JSON.stringify(draft.toJSON()));

// 이어서 넣을 기록 30개(0.2.0 테스트와 같은 입력)와, 같은 기록을 0.1.0으로 이었을 때 결과(비교용)
const cont = [] as ReturnType<typeof entry>[];
for (let d = 60; d < 90; d++) cont.push(entry(d, 1220 + (d - 60) * 20));
writeFileSync(`${OUT}/continuity-entries.json`, JSON.stringify(cont));
let n = t0 + 61 * DAY;
for (const e of cont) confirmed.addEntry(e, (n += DAY));
confirmed.confirmIfDue(n + 2 * DAY);
writeFileSync(`${OUT}/continuity-0.1.0-continued-by-0.1.0.json`, JSON.stringify({ engineVersion: ENGINE_VERSION, headState: confirmed.head.state }));
const fish = (st: { objects: Array<{ kind: string; el: string; scale: number }> }) => st.objects.filter((o) => o.kind === 'fish').map((o) => `${o.el.split('.')[1]}@${o.scale}`).join(' ');
console.log(ENGINE_VERSION, 'confirmed head', build(60, false).head.id, 'fish:', fish(build(60, false).head.state));
console.log('continued by 0.1.0 fish:', fish(confirmed.head.state));
console.log('draft head', draft.head.id, draft.head.status, 'entries', draft.entries.length, 'snaps', draft.snapshots.length);
