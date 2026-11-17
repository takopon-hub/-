import { useStore } from '../lib/store';
import { pad3 } from '../lib/format';
import type { DeskState } from '../lib/queue';
import { go } from './common';

/** ブースが空いていて待ちの人がいるとき、先頭の人の案内を促す(案内担当向け) */
export function GuideCard({ s, link }: { s: DeskState; link?: boolean }) {
  const { snap, role, act } = useStore();
  const head = s.waiting[0];
  if (!head) return null;
  const v = snap?.visitors.find((x) => x.id === head.ticket.visitorId);
  const label = v ? `${pad3(v.no)} ${v.surname}さん` : '';
  const second = s.waiting[1];
  return (
    <div className="guide" role="alert">
      <div className="guide-text">
        <strong>{s.desk.name}</strong> が空いています。<br />
        次は <b>{label}</b> をご案内してください
      </div>
      {role === 'operator' && (
        <div className="guide-actions">
          <button className="btn primary" onClick={() => act('start_ticket', { p_ticket_id: head.ticket.id }, `${s.desk.name} 相談開始`)}>案内して開始</button>
          {second && (
            <button className="btn small" title="不在のとき、次の人と順番を入れ替えます"
              onClick={() => act('swap_tickets', { p_a: head.ticket.id, p_b: second.ticket.id }, `${v?.surname ?? ''}さんを次と入替`)}>
              不在 → 次の人と入替
            </button>
          )}
          {link && <button className="btn small ghost" onClick={() => go(`desk/${s.desk.id}`)}>相談先を開く</button>}
        </div>
      )}
    </div>
  );
}
