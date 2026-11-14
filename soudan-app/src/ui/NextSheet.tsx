import { useStore } from '../lib/store';
import { waitLabel } from '../lib/queue';
import { newId, pad3 } from '../lib/format';
import { Sheet, Badge } from './common';

/** 相談を終えた相談者の「次の行き先」を決める */
export function NextSheet({ visitorId, onClose }: { visitorId: string; onClose: () => void }) {
  const { views, deskStates, act } = useStore();
  const view = views.find((v) => v.visitor.id === visitorId);
  if (!view) return null;
  const { visitor } = view;

  async function enqueue(deskId: number) {
    onClose();
    await act('enqueue', { p_ticket_id: newId(), p_visitor_id: visitorId, p_desk_id: deskId }, `${pad3(visitor.no)} を並ばせる`);
  }
  async function leave(kind: 'done' | 'carryover') {
    onClose();
    await act('leave_visitor', { p_visitor_id: visitorId, p_kind: kind }, `${pad3(visitor.no)} 帰宅`);
  }

  return (
    <Sheet title={`${pad3(visitor.no)} ${visitor.surname}さん 次の行き先`} onClose={onClose}>
      <p className="hint">行き先を選ぶと、その相談先の待ち行列の最後尾に並びます。</p>
      <ul className="list">
        {deskStates.filter((s) => s.desk.active).map((s) => {
          const consulted = view.consultedDeskIds.includes(s.desk.id);
          return (
            <li key={s.desk.id}>
              <button className="row-btn" onClick={() => enqueue(s.desk.id)}>
                <span className="grow">
                  <strong>{s.desk.name}</strong>
                  {consulted && <> <Badge kind="done">相談済み</Badge></>}
                </span>
                <span>待ち{s.waiting.length}人 / {waitLabel(s.newArrivalWait)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="actions">
        <button className="btn" onClick={() => leave('done')}>帰宅(相談完了)</button>
        <button className="btn" onClick={() => leave('carryover')}>帰宅(持ち帰り)</button>
        <button className="btn ghost" onClick={onClose}>あとで決める</button>
      </div>
    </Sheet>
  );
}
