import type { MemoryMoment, ObjectMemory } from './memory';

const KIND_ICON: Record<string, string> = { fish: '🐟', plant: '🌿', rock: '🪨', symbol: '✨', emotion: '💠' };

function dateLabel(iso: string) {
  const [, m, d] = iso.split('-');
  return `${Number(m)}월 ${Number(d)}일`;
}

function Moment({ m, title }: { m: MemoryMoment; title: string }) {
  if (m.entryState === 'hidden') {
    return (
      <div className="memory-moment">
        <b>{title}</b> {dateLabel(m.date)} <span className="hint">· 지운 기록이라 내용은 보이지 않아요{m.appearedOn ? ` · 어항에 나타난 날 ${dateLabel(m.appearedOn)}` : ''}</span>
      </div>
    );
  }
  return (
    <div className="memory-moment">
      <div>
        <b>{title}</b> {dateLabel(m.date)}
        {m.pages && <> · {m.pages.from === m.pages.to ? `${m.pages.to}쪽` : `${m.pages.from}–${m.pages.to}쪽`}</>}
        {m.chips.length > 0 && <> · {m.chips.map((c) => <span key={c} className="chip on small">{c}</span>)}</>}
      </div>
      {m.note && <p className="memory-note">“{m.note}”</p>}
      {m.text && <p className="memory-why">{m.text}</p>}
      {m.appearedOn && <p className="hint">감정이 기록된 날은 {dateLabel(m.date)}, 어항에 나타난 날은 {dateLabel(m.appearedOn)}이에요(하루 3개 상한으로 미뤄졌어요).</p>}
      {m.entryState === 'edited' && <p className="hint">나중에 기록을 고쳤어요. 여기엔 이 요소가 생길 때의 마음이 보여요.</p>}
    </div>
  );
}

/** 기억 보기 카드: 어항 속 요소가 어떤 기록에서 생기고 자랐는지. 포커스를 가두지 않는 비모달 영역이라 dialog가 아닌 section(aria-live)으로 둔다 */
export function MemoryCard({ memory, kind, onClose }: { memory: ObjectMemory; kind: string; onClose: () => void }) {
  return (
    <section className="card memory" aria-label={`${memory.name}의 기억`} aria-live="polite">
      <div className="memory-head">
        <h2>{KIND_ICON[kind] ?? '•'} {memory.name}</h2>
        <button type="button" className="ghost" onClick={onClose} aria-label="닫기">닫기</button>
      </div>
      {memory.born ? (
        <Moment m={memory.born} title={memory.born.kind === 'finale' ? '완성한 날' : '생긴 날'} />
      ) : (
        <p className="hint">처음부터 어항에 있던 요소예요.</p>
      )}
      {memory.grew.length > 0 && (
        <details open={memory.grew.length <= 3}>
          <summary>함께 자란 날 {memory.grew.length}번</summary>
          {memory.grew.map((m, i) => <Moment key={i} m={m} title={m.kind === 'finale' ? (kind === 'emotion' ? '완성하며 자란 날' : '대표 생물이 된 날') : '자란 날'} />)}
        </details>
      )}
    </section>
  );
}
