import { useState } from 'react';
import { useStore } from '../lib/store';
import { waitLabel } from '../lib/queue';
import { minutesBetween, pad3 } from '../lib/format';
import { BackLink, Badge, Empty, go } from './common';
import { NextSheet } from './NextSheet';

export function DeskScreen({ id }: { id: number }) {
  const { deskStates, snap, role, act, nowMs } = useStore();
  const [next, setNext] = useState<string | null>(null);
  const s = deskStates.find((d) => d.desk.id === id);
  if (!s || !snap) return <><BackLink to="">ボード</BackLink><Empty>相談先が見つかりません</Empty></>;
  const op = role === 'operator';
  const visitor = (vid: string) => snap.visitors.find((v) => v.id === vid);
  const freeBooths = s.desk.booths - s.serving.length;

  async function finish(ticketId: string, visitorId: string) {
    const r = await act('finish_ticket', { p_ticket_id: ticketId }, '相談終了');
    if (r !== false) setNext(visitorId);
  }

  return (
    <>
      <BackLink to="">ボード</BackLink>
      <h2 className="page-title">{s.desk.name} {!s.desk.active && <Badge kind="off">休止中</Badge>}</h2>
      <p className="hint">
        {s.desk.booths}ブース / 平均相談時間 約{Math.round(s.avg)}分
        {s.samples >= 3 ? `(実績${s.samples}件)` : '(実績が少ないため初期値)'}
      </p>

      <h3 className="section">相談中 ({s.serving.length}/{s.desk.booths})</h3>
      {s.serving.length === 0 && <Empty>相談中の方はいません</Empty>}
      <ul className="list">
        {s.serving.map((t) => {
          const v = visitor(t.visitorId);
          return (
            <li key={t.id} className="item">
              <Badge kind="serve">ブース{t.booth}</Badge>
              <a className="grow name" href={`#/visitor/${t.visitorId}`}>{v ? `${pad3(v.no)} ${v.surname}さん` : ''}
                <small> {minutesBetween(t.startedAt, nowMs)}分経過</small></a>
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
          const canStart = freeBooths > 0 && i === 0;
          return (
            <li key={w.ticket.id} className="item">
              <span className="pos">{i + 1}</span>
              <a className="grow name" href={`#/visitor/${w.ticket.visitorId}`}>{v ? `${pad3(v.no)} ${v.surname}さん` : ''}
                <small> {waitLabel(w.waitMinutes)}</small></a>
              {op && (
                <>
                  <button className="btn primary" disabled={freeBooths <= 0}
                    title={freeBooths <= 0 ? '空いているブースがありません' : ''}
                    onClick={() => act('start_ticket', { p_ticket_id: w.ticket.id }, '相談開始')}>
                    {canStart ? '案内して開始' : '開始'}
                  </button>
                  <button className="btn ghost" onClick={() => {
                    if (confirm(`${v?.surname ?? ''}さんの待ちを取り消しますか?`)) void act('cancel_ticket', { p_ticket_id: w.ticket.id }, '待ち取消');
                  }}>取消</button>
                </>
              )}
            </li>
          );
        })}
      </ol>
      {op && s.waiting.length > 0 && freeBooths > 0 && (
        <p className="hint">先頭以外を先に開始することもできます(呼び出しに応じなかった場合など)。</p>
      )}
      {next && <NextSheet visitorId={next} onClose={() => { setNext(null); go(`desk/${id}`); }} />}
    </>
  );
}
