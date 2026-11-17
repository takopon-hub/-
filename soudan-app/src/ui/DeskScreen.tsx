import { useState } from 'react';
import { useStore } from '../lib/store';
import { waitLabel } from '../lib/queue';
import { pad3 } from '../lib/format';
import { BackLink, Badge, CategoryTag, Elapsed, Empty } from './common';
import { NextSheet } from './NextSheet';
import { GuideCard } from './Guide';
import { Sheet } from './common';

export function DeskScreen({ id }: { id: number }) {
  const { deskStates, snap, role, act, nowMs } = useStore();
  const [next, setNext] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [guide, setGuide] = useState<string | null>(null);   // 終了→次の行き先→次の人の案内、を一連で進める
  const [move, setMove] = useState<{ ticketId: string; visitorId: string } | null>(null);
  const s = deskStates.find((d) => d.desk.id === id);
  if (!s || !snap) return <><BackLink to="">ボード</BackLink><Empty>相談先が見つかりません</Empty></>;
  const op = role === 'operator';
  const visitor = (vid: string) => snap.visitors.find((v) => v.id === vid);
  const busy = s.serving.length >= s.desk.booths;

  async function finish(ticketId: string, visitorId: string) {
    const r = await act('finish_ticket', { p_ticket_id: ticketId }, '相談終了');
    if (r !== false) { setSentTo(null); setGuide(null); setNext(visitorId); }
  }

  return (
    <>
      <BackLink to="">ボード</BackLink>
      <h2 className="page-title">{s.desk.name} <CategoryTag category={s.desk.category} /> {!s.desk.active && <Badge kind="off">休止中</Badge>}</h2>
      <p className="hint">
        平均相談時間 約{Math.round(s.avg)}分
        {s.samples >= 3 ? `(実績${s.samples}件)` : '(実績が少ないため初期値)'}
      </p>

      {op && s.desk.active && s.waiting.length > 0 && s.serving.length < s.desk.booths && <GuideCard s={s} />}

      <h3 className="section">相談中</h3>
      {s.serving.length === 0 && <Empty>相談中の方はいません</Empty>}
      <ul className="list">
        {s.serving.map((t) => {
          const v = visitor(t.visitorId);
          return (
            <li key={t.id} className="item">
              <a className="grow name" href={`#/visitor/${t.visitorId}`}>{v ? `${pad3(v.no)} ${v.surname}さん` : ''}</a>
              <Elapsed startedAt={t.startedAt} nowMs={nowMs} />
              {op && <button className="btn primary" onClick={() => finish(t.id, t.visitorId)}>終了</button>}
            </li>
          );
        })}
      </ul>

      <h3 className="section">待ち ({s.waiting.length}人)</h3>
      {s.waiting.length === 0 && <Empty>待っている方はいません</Empty>}
      <ol className="list numbered">
        {s.waiting.map((w, i) => {
          const v = visitor(w.ticket.visitorId);
          const nextOne = s.waiting[i + 1];
          return (
            <li key={w.ticket.id} className="item stack">
              <div className="line">
                <span className="pos">{i + 1}</span>
                <a className="grow name" href={`#/visitor/${w.ticket.visitorId}`}>{v ? `${pad3(v.no)} ${v.surname}さん` : ''}
                  <small> {waitLabel(w.waitMinutes)}</small></a>
                {op && (
                  <button className="btn primary" disabled={busy} title={busy ? '相談中の方がいます' : ''}
                    onClick={() => act('start_ticket', { p_ticket_id: w.ticket.id }, '相談開始')}>
                    {i === 0 ? '案内して開始' : '開始'}
                  </button>
                )}
              </div>
              {op && (
                <div className="line sub-actions">
                  {nextOne && (
                    <button className="btn small" title="呼び出したが不在のとき、次の人と順番を入れ替えます"
                      onClick={() => act('swap_tickets', { p_a: w.ticket.id, p_b: nextOne.ticket.id }, `${v?.surname ?? ''}さんを次と入替`)}>
                      不在 → 次の人と入替
                    </button>
                  )}
                  <button className="btn small" onClick={() => setMove({ ticketId: w.ticket.id, visitorId: w.ticket.visitorId })}>別の相談先へ付け替え</button>
                  <button className="btn small ghost" onClick={() => {
                    if (confirm(`${v?.surname ?? ''}さんの待ちを取り消しますか?`)) void act('cancel_ticket', { p_ticket_id: w.ticket.id }, '待ち取消');
                  }}>取消</button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {op && s.waiting.length > 0 && (
        <p className="hint">
          呼び出しても不在(食事など)の方は「不在 → 次の人と入替」で、次の方を先に案内できます。
          行列の動きが悪いときは「別の相談先へ付け替え」で新しい行列の最後尾に移せます。
        </p>
      )}
      {next && (
        <NextSheet visitorId={next} onChosen={setSentTo}
          onClose={() => { setGuide(next); setNext(null); }} />
      )}
      {guide !== null && !next && s.waiting.length > 0 && !busy && (
        <Sheet title="続けて、次の方をご案内" onClose={() => setGuide(null)}>
          {visitor(guide) && <p className="hint">{pad3(visitor(guide)!.no)} {visitor(guide)!.surname}さん{sentTo ? ` → ${sentTo}` : ''}(記録しました)</p>}
          <GuideCard s={s} />
          <div className="actions"><button className="btn ghost" onClick={() => setGuide(null)}>あとで</button></div>
        </Sheet>
      )}
      {move && <NextSheet visitorId={move.visitorId} moveTicketId={move.ticketId} fromDeskId={id} onClose={() => setMove(null)} />}
    </>
  );
}
