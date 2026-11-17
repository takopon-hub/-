import { useStore } from '../lib/store';
import { pad3 } from '../lib/format';
import { Sheet } from './common';

/** 昼食などで待ち行列から外れる(離席)前に、相談者へ説明して了承を得るための確認画面 */
export function AwaySheet({ ticketId, visitorId, deskName, onClose }: { ticketId: string; visitorId: string; deskName: string; onClose: () => void }) {
  const { views, act } = useStore();
  const v = views.find((x) => x.visitor.id === visitorId)?.visitor;
  const label = v ? `${pad3(v.no)} ${v.surname}さん` : '';
  return (
    <Sheet title={`${label} 離席(待ちから外れる)`} onClose={onClose}>
      <p className="hint">{deskName} の待ち行列から外れます。次の内容を相談者にお伝えし、了承を得てください。</p>
      <ul className="notice-list">
        <li>離席している間に、前の方の相談が終わってブースが空いた場合は、その次に並んでいる方を先にご案内することがあります。</li>
        <li>戻られたら、職員に声をかけてください。離席前の順番に戻ります。先に別の方をご案内していた場合は、次の順番でご案内します。</li>
      </ul>
      <div className="actions">
        <button className="btn primary" onClick={() => { onClose(); void act('away_ticket', { p_ticket_id: ticketId }, `${label} 離席`); }}>
          説明して了承を得た(離席にする)
        </button>
        <button className="btn ghost" onClick={onClose}>やめる</button>
      </div>
    </Sheet>
  );
}
