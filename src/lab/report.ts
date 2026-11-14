import { ENGINE_VERSION, FISH_SPACE } from '../engine/config';
import { distinctness, evaluateHypotheses, h7Detail, VERDICT_LABEL } from './hypotheses';
import { fmt, LIFECYCLE_LABEL } from './metrics';
import { checkDeterminism, frameAt, type SuiteResult } from './runner';
import { LONG_CHECKPOINTS, LONG_DURATIONS } from './samples';
import type { DayFrame, RunResult } from './types';
import type { ElementAsset } from '../assets/manifest';
import { FISH_BAND_TARGET, FISH_BASELINE_010, OCCLUSION_TARGET, occlusionRows, pct } from './occlusion';

/**
 * 검증 결과를 마크다운으로. 브라우저(검증실 "보고서 복사")와 `npm run lab:report`가 같은 함수를 쓴다.
 * 재현성을 위해 생성 시각 같은 바뀌는 값은 넣지 않는다.
 */

const counts = (f: DayFrame) => `${f.metrics.fish}/${f.metrics.plant}/${f.metrics.rock}/${f.metrics.symbol}`;
const eventsOn = (r: RunResult, day: number) => r.events.filter((e) => e.day === day).map((e) => (e.level === 'special' ? '★' : e.level === 'finale' ? '◎' : e.isNew ? '+' : '↑') + (e.el ? e.el.split('.')[1] : '빛')).join(' ');

function finalRow(r: RunResult): string {
  const f = r.frames[r.frames.length - 1]!;
  const g = r.events.filter((e) => e.level === 'growth').length;
  const sp = r.events.filter((e) => e.level === 'special');
  return `| ${r.label} | ${r.entryCount} | ${counts(f)} | ${f.metrics.total} (${f.metrics.fillPct}%) | ${f.metrics.stage} ${f.metrics.stageName} | \`${f.metrics.waterHex}\` ${f.metrics.moodName} (${fmt(f.metrics.lightTemp)}, ${fmt(f.metrics.lightEnergy)}) | ${g} | ${sp.length} (${sp.map((e) => e.day).join(',')}) | ${LIFECYCLE_LABEL[f.lifecycle]} |`;
}

const FINAL_HEAD = '| 어항 | 기록 수 | 물고기/수초/수석/상징 | 합계(채움) | 성장 단계 | 물빛 색감 (온도, 에너지) | 성장 | 특별 변화(일) | 상태 |\n|---|---|---|---|---|---|---|---|---|';

function dailyTable(r: RunResult, days: number[]): string {
  const rows = days.map((d) => {
    const f = frameAt(r, d);
    return `| ${d} | ${f.entries} | ${counts(f)} | ${f.metrics.stage} | \`${f.metrics.waterHex}\` ${f.metrics.moodName} | ${f.moss ? `이끼 ${f.moss}` : ''} | ${eventsOn(r, d)} |`;
  });
  return `| 일 | 기록 | 물/초/석/상 | 단계 | 물빛 | 이끼 | 그날 사건 |\n|---|---|---|---|---|---|---|\n${rows.join('\n')}`;
}

export function buildReport(s: SuiteResult, opts: { determinism?: boolean; assets?: Record<string, ElementAsset> } = {}): string {
  const L: string[] = [];
  const hyps = evaluateHypotheses(s);
  const dist = distinctness(s);
  const h7 = h7Detail(s);
  L.push('# 이루리움 생성 엔진 검증 보고서 (단계 A)');
  L.push('');
  L.push(`- 엔진 버전: \`${ENGINE_VERSION}\` (0.2.0: 이슈 #9 물고기 헤엄 공간 예산 추가. 그 밖의 수치·규칙은 0.1.0과 같음)`);
  L.push('- 근거: v0.3.1 수정 노트 6장(가설 H1~H11, 사례 A~F), v0.3.2 기술 보완서');
  L.push('- **데이터 출처: 이 보고서의 모든 수치는 검증용으로 만든 샘플(가상 관장) 기록에서 나왔어요. 실제 사용자 기록이 아니에요.** 실제 기록은 검증실 "실제 기록" 탭에서 읽기 전용으로만 봐요.');
  L.push(`- 샘플 시나리오 ${s.scenarios.length}개, 어항 ${Object.values(s.runs).flat().length}개`);
  L.push('- 지표 정의 [검증용]: 성장 단계 = 상한 32개 대비 채움(1 빈 어항 · 2 새싹 <15% · 3 자라는 중 <40% · 4 풍성 <75% · 5 가득). 물빛 색감 = 배경 물색 #043877(세미 리얼 배경 가운데 평균색)에 렌더러와 같은 감정 조명 색 보정 규칙(src/render/lighting.ts)을 적용한 근사 지표(가산 빛 기여는 화면 평균 35%로 가정, 실제 프레임 픽셀 평균과 다를 수 있음). 차이 = (물빛 차이 + 구성 차이) / 2, 0~1.');
  L.push('');

  L.push('## 1. 가설 판정 요약');
  L.push('');
  L.push('판정: **통과(자동 기준)** = 시뮬레이터 기준을 넘어 지인 테스트로 갈 수 있음(확정 아님) · **조정 필요** · **보류(사람 평가 필요)** = 실제 사용자 평가·실기기 측정 전에는 통과로 올리지 않음');
  L.push('');
  L.push('| 가설 | 초깃값 | 판정 | 핵심 측정 | 근거 |');
  L.push('|---|---|---|---|---|');
  for (const h of hyps) {
    const key = h.measures.find((m) => m.ok !== null) ?? h.measures[0];
    L.push(`| ${h.id} ${h.title} | ${h.initial} | **${VERDICT_LABEL[h.verdict]}** | ${key ? `${key.label}: ${key.value}` : '-'} | ${h.reason} |`);
  }
  L.push('');

  L.push('## 2. 재현성과 감정 차이 (요구 6)');
  L.push('');
  if (opts.determinism) {
    const det = checkDeterminism();
    const bad = det.filter((d) => !d.same);
    L.push(`- 같은 기록·같은 시드 재실행: 어항 ${det.length}개 중 **${det.length - bad.length}개 모든 스냅샷 해시 동일**${bad.length ? ` (다름: ${bad.map((b) => b.key).join(', ')})` : ''}`);
  }
  L.push(`- 감정만 다른 어항(같은 시드) 사이 최소 차이 **${fmt(dist.emotionMin, 3)}** (${dist.emotionMinPair}) > 시드만 다른 어항 사이 최대 차이 **${fmt(dist.seedMax, 3)}** → ${dist.ok ? '**수치 기준 통과**' : '**수치 기준 미달**'} (시각적 체감은 짝짓기 테스트 대기)`);
  L.push(`- 사례 B(극단) 가장 비슷한 쌍 ${fmt(dist.extremeMin, 3)} > 사례 A(비슷) 가장 다른 쌍 ${fmt(dist.similarMax, 3)} → ${dist.okAB ? '수치 기준 통과' : '수치 기준 미달(겹침 있음)'}`);
  L.push('- **시각적 구별: 미검증.** 위 값은 엔진 상태(물빛 조명값·요소 구성)로 계산한 상대 지표이고 지금 샘플·지금 가중치에서만 성립해요. 실제 관장이 그림만 보고 한눈에 구별한다는 근거가 아니에요. 지금 그림은 임시 SVG이고 같은 테마에 물고기 3종뿐이라 화면상 차이는 수치보다 작을 수 있어요. 짝짓기 테스트(지인 5명 이상, 기준 4/5)로 따로 확인해야 해요.');
  L.push(`- 사례 A 안 배치 차이 ${fmt(h7.layoutA, 2)}: 분위기는 비슷해도 배치는 시드마다 달라요.`);
  L.push('');
  L.push('감정별 차이 행렬(같은 책·같은 시드, 14일 최종):');
  L.push('');
  L.push(`| | ${dist.matrix.labels.join(' | ')} |`);
  L.push(`|---|${dist.matrix.labels.map(() => '---').join('|')}|`);
  dist.matrix.values.forEach((row, i) => L.push(`| ${dist.matrix.labels[i]} | ${row.map((v) => fmt(v, 2)).join(' | ')} |`));
  L.push('');

  L.push('## 3. 가설별 측정값');
  for (const h of hyps) {
    L.push('');
    L.push(`### ${h.id} ${h.title} — ${VERDICT_LABEL[h.verdict]}`);
    L.push('');
    L.push(`- 초깃값: ${h.initial}`);
    L.push(`- 확인하는 것: ${h.question}`);
    L.push(`- 통과 기준(초안): ${h.criterion}`);
    for (const m of h.measures) L.push(`- ${m.ok === true ? '✅' : m.ok === false ? '❌' : '·'} ${m.label}: ${m.value}`);
    if (h.humanPart) L.push(`- 사람 평가: ${h.humanPart}`);
    L.push(`- 판단 근거: ${h.reason}`);
  }
  L.push('');

  L.push('## 4. 사례 A~F 최종 수치');
  for (const sc of s.scenarios.filter((x) => x.group === 'case')) {
    L.push('');
    L.push(`### ${sc.title}`);
    L.push('');
    L.push(`${sc.summary} — 볼 것: ${sc.watch}`);
    L.push('');
    L.push(FINAL_HEAD);
    for (const r of s.runs[sc.id]!) L.push(finalRow(r));
  }
  L.push('');
  L.push('### 사례 C 날짜별 변화 (+ 새로 생김, ↑ 자람, ★ 특별 변화, ◎ 완성)');
  L.push('');
  L.push(dailyTable(s.runs['case-C']![0]!, Array.from({ length: 14 }, (_, i) => i + 1)));
  L.push('');
  L.push('### 사례 F 날짜별 변화 (2·4·7·9·12일차 하루 3번)');
  L.push('');
  L.push(dailyTable(s.runs['case-F']![0]!, Array.from({ length: 14 }, (_, i) => i + 1)));
  L.push('');

  L.push('## 5. 비교 실험 — 같은 책·같은 기간, 한 가지만 바꿈 (요구 2)');
  for (const sc of s.scenarios.filter((x) => x.group === 'compare')) {
    L.push('');
    L.push(`### ${sc.title}`);
    L.push('');
    L.push(sc.summary);
    L.push('');
    L.push(FINAL_HEAD);
    for (const r of s.runs[sc.id]!) L.push(finalRow(r));
  }
  L.push('');

  L.push('## 6. 장기 시뮬레이션 14·30·100·200일 (요구 3)');
  for (const sc of s.scenarios.filter((x) => x.group === 'long')) {
    const r = s.runs[sc.id]![0]!;
    L.push('');
    L.push(`### ${sc.title}`);
    L.push('');
    L.push(sc.summary);
    L.push('');
    L.push('| 시점 | 누적 기록 | 물/초/석/상 | 합계(채움) | 단계 | 평균 크기 | 물빛 | 이끼 | 누적 성장 | 누적 특별 변화 |');
    L.push('|---|---|---|---|---|---|---|---|---|---|');
    for (const d of LONG_DURATIONS) {
      const f = frameAt(r, d);
      const upTo = r.events.filter((e) => e.day <= d);
      const entries = r.frames.slice(0, d).reduce((a, x) => a + x.entries, 0);
      L.push(`| ${d}일 | ${entries} | ${counts(f)} | ${f.metrics.total} (${f.metrics.fillPct}%) | ${f.metrics.stage} ${f.metrics.stageName} | ${f.metrics.avgScale} | \`${f.metrics.waterHex}\` ${f.metrics.moodName} | ${f.moss || '-'} | ${upTo.filter((e) => e.level === 'growth').length} | ${upTo.filter((e) => e.level === 'special').length} |`);
    }
    L.push('');
    L.push(`갤러리 기본 시점: ${LONG_CHECKPOINTS[200]!.join(', ')}일`);
  }
  L.push('');

  L.push('## 7. 규칙 검사 (v0.3.1 3장: 하루 1회·조명 30%·확정 순서)');
  L.push('');
  const all = Object.values(s.runs).flat();
  const ids = [...new Set(all.flatMap((r) => r.rules.map((x) => x.id)))];
  L.push('| 규칙 | 검사한 어항 | 통과 | 예시 |');
  L.push('|---|---|---|---|');
  for (const id of ids) {
    const rs = all.map((r) => r.rules.find((x) => x.id === id)).filter((x): x is NonNullable<typeof x> => !!x);
    const okN = rs.filter((x) => x.ok).length;
    const sample = s.runs['case-F']![0]!.rules.find((x) => x.id === id) ?? rs[0]!;
    L.push(`| ${id} ${rs[0]!.name} | ${rs.length} | ${okN}/${rs.length} | 사례 F: ${sample.detail} |`);
  }
  L.push('');
  if (opts.assets) {
    L.push('## 8. 물고기 가림 (이슈 #6) — 화면 표시 규칙 비교');
    L.push('');
    L.push(`엔진 상태는 같고 표시 규칙만 비교해요(src/render/display.ts). 기준 [검증용 가설, 사용자 검증 전]: 실제 가림 ${pct(OCCLUSION_TARGET.effectiveCover)} 미만, 수초 꼭대기 y ${OCCLUSION_TARGET.plantTopMin} 아래.`);
    L.push('');
    L.push('**샘플 시작 위치 기반 근사값이에요.** 0%는 "샘플 어항의 시작 위치에서 사각형끼리 겹치지 않는다"는 뜻이에요. 헤엄 중 위치, 수초 흔들림, 투명한 픽셀 모양은 반영하지 않아서 실제 화면에서 순간적인 가림은 생길 수 있어요. 움직이는 화면(검증실 갤러리에서 그림을 눌러 열기)으로 함께 확인해 주세요.');
    L.push('');
    L.push('| 어항 | 물고기 | 앞 수초에 가림 (이전 → 지금·실제) | 수초 꼭대기 y | 물고기끼리 겹침 | 헤엄 띠 겹침 |');
    L.push('|---|---|---|---|---|---|');
    for (const r of occlusionRows(s, opts.assets)) {
      L.push(`| ${r.label} | ${r.after.fish} | ${pct(r.before.frontCover)} → **${pct(r.after.effectiveCover)}** | ${Math.round(r.before.plantTop)} → **${Math.round(r.after.plantTop)}** | ${pct(r.before.fishOverlap)} → **${pct(r.after.fishOverlap)}** | ${pct(r.before.bandOverlap)} → **${pct(r.after.bandOverlap)}** |`);
    }
    L.push('');
    L.push('');
    L.push(`### 8-1. 물고기 밀도 (이슈 #9) — 엔진 0.1.0 → ${ENGINE_VERSION}`);
    L.push('');
    L.push(`엔진에 물고기 헤엄 공간 예산을 넣었어요. 물고기 몸 높이 × 크기 배율의 합이 헤엄 띠(${FISH_SPACE.bandHeight}) × ${FISH_SPACE.maxFill}를 넘지 않고, 완성 전에는 대표 생물(여우 물고기) 자리를 남겨 둬요. 넘으면 새 물고기 대신 수초·수석이 생기거나 다른 생물이 자라요. 기준 [검증용 가설]: 헤엄 띠 겹침 ${pct(FISH_BAND_TARGET)} 미만.`);
    L.push('');
    L.push('| 어항 | 물고기 수 (0.1.0 → 지금) | 헤엄 띠 겹침 (0.1.0 → 지금) |');
    L.push('|---|---|---|');
    for (const r of occlusionRows(s, opts.assets)) {
      const b = FISH_BASELINE_010[r.label];
      L.push(`| ${r.label} | ${b ? b.fish : '-'} → **${r.after.fish}** | ${b ? pct(b.band) : '-'} → **${pct(r.after.bandOverlap)}** |`);
    }
    L.push('');
    L.push('대가: 오래 기록한 어항일수록 물고기가 적어요(꾸준형 200일 8 → 4마리). 배율 1.4는 예산 없음·1.0·1.2·1.4 비교 뒤 기획자가 정했어요. 남는 성장은 수초·수석과 기존 생물 성장으로 가요. 200일 어항이 허전해 보이는지는 사람 평가(H8·H11)로 확인해야 해요. 0.1.0 값은 main bb039c0에서 같은 표시 규칙으로 잰 고정 기록이에요.');
    L.push('');
  }
  L.push('## 9. 후속 실험 과제');
  L.push('');
  L.push('v0.3.1 6.3 절차대로 한 번에 하나만 바꾸고, 바꾸면 `ENGINE_VERSION`을 올린다. 그 전 스냅샷은 바꾸지 않는다.');
  L.push('');
  L.push('| 과제 | 왜 | 먼저 할 일 |');
  L.push('|---|---|---|');
  for (const f of FOLLOW_UP) L.push(`| ${f.task} | ${f.why} | ${f.first} |`);
  L.push('');
  return L.join('\n');
}

/** 후속 실험 과제. 화면 "가설" 탭과 보고서가 함께 쓴다. 엔진 수치는 한 번에 하나씩, ENGINE_VERSION을 올려 바꾼다. */
export const FOLLOW_UP: Array<{ task: string; why: string; first: string }> = [
  { task: 'H5 장기 특별 변화', why: '꾸준형 200일에서 131~160일 특별 변화 0회', first: '마일스톤을 기계적으로 촘촘하게(예: 25회마다) 하면 보상이 반복처럼 느껴질 수 있어요. 기간·계절·감정 흐름 같은 다른 종류의 변화와 비교 실험부터' },
  { task: 'H9 반복 방지', why: '연속 성장에서 같은 종류 33%', first: '"같은 종류(물고기·수초…)가 이어짐"과 "같은 요소가 계속 자람"을 나눠 재는 기준을 먼저 확정. 그다음 기존 요소 키우기의 반복 감점·같은 요소 최대 개수(초깃값 2) 조정' },
  { task: 'H4 성장 횟수', why: '사례 C는 8회로 통과, 매일 기록하면 11회', first: '사례 C 하나로 전 사용자 적합성을 확정하지 않기. 기록 패턴별 기준(매일·주 5일·띄엄) 정하기' },
  { task: '시각적 감정 구별', why: '수치 기준만 통과', first: '실제 그래픽 적용 뒤 짝짓기 테스트(지인 5명 이상, 4/5)' },
  { task: '200일 어항 물고기 수', why: '0.2.0 헤엄 공간 예산(1.4)으로 겹침은 줄었지만 꾸준형 200일 물고기 8 → 4마리', first: '허전해 보이는지 사람 평가. 차가운 감정 쪽 작은 물고기 그림 추가(송사리 상한만 늘리는 건 효과 없었음)' },
  { task: 'H10 하루 1일치 무게', why: '예산이 빠듯하면(1.0·1.2) 시드 20쌍 기준 1번 vs 5번 차이가 시드 잡음보다 커져요. 채택한 1.4에서는 기준선 수준', first: '예산 배율을 다시 바꿀 때마다 재기. 5번 기록한 날 어항이 그림으로도 쏠려 보이는지 사람 확인' },
  { task: '사람·실기기 평가', why: 'H1·H2·H3·H8·H11 보류', first: '지인 14일 기록, 한마디 라벨링 100개, 저사양 폰 fps' },
];
