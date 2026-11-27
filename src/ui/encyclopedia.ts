import manifestJson from '../../public/assets/manifest.json';
import { EMOTION_SYMBOLS } from '../engine/catalog';
import { josa } from '../engine/compute';
import { EMOTIONS, type EmotionDef } from '../engine/mood';
import type { Change, PlacedObject, Snapshot } from '../engine/types';

/**
 * 감정 도감과 흔적 생성 안내(앱 UX). 규칙은 docs/EMOTION_GUIDE.md.
 * - 도감은 앱의 일상 화면에서만 연다. 검증실(lab) 평가 화면은 이 모듈을 가져오지 않는다(정답이 평가 중 노출되지 않게).
 * - 안내 문구는 시간 표현(오늘·그동안)을 넣지 않는다. 언제·어디서 왔는지는 엔진의 변화 문장이 출처 정책대로 이미 말한다.
 */

/** 한 줄 의미: 외울 정답이 아니라 '왜 이 모양인지'를 짧게 들려주는 말 */
const MEANING: Record<string, string> = {
  'emo.joy': '노을빛을 받아 활짝 핀 산호. 마음이 환해진 순간이에요.',
  'emo.flutter': '살짝 열린 조개 속 반짝임. 무언가를 기대하는 두근거림이에요.',
  'emo.excited': '함께 신나게 헤엄치는 무리. 들뜨고 즐거운 기운이에요.',
  'emo.proud': '하나씩 쌓아 올린 돌. 해냈다는 마음이에요.',
  'emo.calm': '천천히 떠다니는 해파리. 고요하고 편안한 마음이에요.',
  'emo.longing': '멀리 있는 누군가에게 띄운 편지. 보고 싶은 마음이에요.',
  'emo.lonely': '어두운 물속을 홀로 비추는 작은 불빛. 혼자인 듯한 마음이에요.',
  'emo.sad': '눈물이 굳어 생긴 푸른 진주. 마음이 젖은 순간이에요.',
  'emo.stuffy': '서로 얽혀 잘 풀리지 않는 해초. 꽉 막힌 듯한 마음이에요.',
  'emo.lost': '바늘이 흐려진 나침반. 어디로 가야 할지 모르겠는 마음이에요.',
  'emo.pain': '가시를 잔뜩 세운 성게. 마음이 따끔하고 힘든 순간이에요.',
  'emo.sleepy': '모래 위에서 잠든 소라. 느슨하고 나른한 마음이에요.',
};

export interface GuideEntry {
  emotion: EmotionDef;
  symbolId: string;
  symbolName: string;
  meaning: string;
  /** public/assets 기준 경로 */
  src: string;
  /** 논리 좌표(1000×600)에서의 1단계 표시 높이 */
  displayHeight: number;
  /** 그림 원본 비율(가로/세로) */
  aspect: number;
}

type ManifestEl = { src: string; displayHeight?: number; displayWidth?: number; size?: number[] };
const elements = (manifestJson as { elements: Record<string, ManifestEl> }).elements;

export const GUIDE: readonly GuideEntry[] = EMOTIONS.map((emotion) => {
  const sym = EMOTION_SYMBOLS.find((s) => s.id === emotion.symbol);
  const asset = elements[emotion.symbol];
  if (!sym || !asset) throw new Error(`감정 도감: ${emotion.id}의 상징(${emotion.symbol})이 카탈로그·매니페스트에 없어요`);
  const [w = 1, h = 1] = asset.size ?? [];
  const aspect = w / h;
  const displayHeight = asset.displayHeight ?? (asset.displayWidth ? asset.displayWidth / aspect : 80);
  return { emotion, symbolId: sym.id, symbolName: sym.name, meaning: MEANING[emotion.id] ?? '', src: asset.src, displayHeight, aspect };
});

export function guideOfSymbol(symbolId: string): GuideEntry | undefined {
  return GUIDE.find((g) => g.symbolId === symbolId);
}

/** 화면 폭(px)에 맞춰 어항(논리 폭 1000)이 줄어드는 비율. 도감은 이 비율로 '어항 속 실제 크기'를 보여 준다 */
export function stageScaleFor(canvasWidthPx: number): number {
  return Math.max(0.2, canvasWidthPx / 1000);
}

export interface TraceNotice {
  objectId: string;
  guide: GuideEntry;
  kind: 'new' | 'grown';
  stage: number;
  /** 이번 변화에서 자란 횟수(완독 채움은 한 흔적이 여러 단계 자랄 수 있음) */
  steps: number;
  /** 시간 표현 없는 짧은 안내. 예: "그리움이 유리병 편지가 되었어요" */
  headline: string;
  /** 엔진 변화 문장(출처·누적 정책을 따른 원문) */
  why: string;
}

/**
 * 이번 스냅샷의 변화 가운데 감정 흔적이 생기거나 자란 것만 골라 안내로 만든다.
 * 새로 생김/자람은 문장이 아니라 객체로 판단한다(bornSeq가 이번 순번이면 새로 생김).
 */
export function traceNoticesOf(changes: readonly Change[], objects: readonly PlacedObject[], seq: number): TraceNotice[] {
  const out: TraceNotice[] = [];
  const seen = new Set<string>();
  // 같은 흔적의 변화 문장 수(새로 생긴 문장 1 + 자란 문장들)
  const hits = new Map<string, number>();
  for (const c of changes) if (c.objectId) hits.set(c.objectId, (hits.get(c.objectId) ?? 0) + 1);
  for (const c of changes) {
    if (!c.objectId || seen.has(c.objectId)) continue;
    const obj = objects.find((o) => o.id === c.objectId);
    if (!obj || obj.kind !== 'emotion') continue;
    const guide = guideOfSymbol(obj.el);
    if (!guide) continue;
    seen.add(c.objectId);
    const kind = obj.bornSeq === seq ? 'new' : 'grown';
    const n = hits.get(obj.id) ?? 1;
    const steps = kind === 'new' ? n - 1 : n;
    const emo = guide.emotion.name;
    const sym = guide.symbolName;
    const headline = kind === 'new'
      ? `${emo}${josa(emo, '이', '가')} ${sym}${josa(sym, '이', '가')} 되었어요`
      : `${emo}${josa(emo, '이', '가')} 더해져 ${sym}${josa(sym, '이', '가')} ${steps > 1 ? `${steps}단계 ` : ''}자랐어요`;
    // 같은 흔적의 문장이 여럿이면 엔진 문장들을 이어 보여 준다(출처 설명은 그대로)
    const why = changes.filter((x) => x.objectId === obj.id).map((x) => x.text).join(' · ');
    out.push({ objectId: obj.id, guide, kind, stage: obj.stage ?? 1, steps, headline, why });
  }
  return out;
}

/** 지금 어항에 놓인 감정 흔적 수(도감에서 '내 어항에 n개'로 보여 줌) */
export function traceCountsOf(objects: readonly PlacedObject[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const o of objects) if (o.kind === 'emotion') out[o.el] = (out[o.el] ?? 0) + 1;
  return out;
}

/** 스냅샷 id로 그 기록의 흔적 안내를 만든다(참조 비교가 아니라 id라서 저장·복원·복사 뒤에도 같다) */
export function noticesForSnapshot(snapshots: readonly Snapshot[], snapshotId: string | undefined): TraceNotice[] {
  const snap = snapshotId ? snapshots.find((x) => x.id === snapshotId) : undefined;
  return snap ? traceNoticesOf(snap.changes, snap.state.objects, snap.seq) : [];
}
