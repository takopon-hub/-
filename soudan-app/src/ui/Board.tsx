import { useState } from 'react';
import { useStore, storage } from '../lib/store';
import { waitLabel, type DeskState } from '../lib/queue';
import { minutesBetween, pad3 } from '../lib/format';
import { Badge, go } from './common';

const MY_KEY = 'soudan.myDesk';

export function Board() {
  const { deskStates, views, nowMs } = useStore();
  const [mine, setMine] = useState<number | null>(() => {
    const v = Number(storage.get(MY_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  });
  const toggle = (id: number) => {
    const next = mine === id ? null : id;
    setMine(next);
    if (next === null) storage.del(MY_KEY); else storage.set(MY_KEY, String(next));
  };

  const inside = views.filter((v) => v.visitor.status === 'in').length;
  const left = views.length - inside;
  const idle = views.filter((v) => v.idle).length;
  const sorted = [...deskStates].sort((a, b) => Number(b.desk.id === mine) - Number(a.desk.id === mine));

  return (
    <>
      <section className="summary" aria-label="会場の状況">
        <div><b>{inside}</b><span>会場内</span></div>
        <div><b>{left}</b><span>帰宅</span></div>
        <div><b>{views.length}</b><span>受付累計</span></div>
        {idle > 0 && (
          <a href="#/visitors/idle" className="warn-link"><b>{idle}</b><span>行き先未決定</span></a>
        )}
      </section>
      <div className="grid">
        {sorted.map((s) => (
          <DeskCard key={s.desk.id} s={s} nowMs={nowMs} mine={s.desk.id === mine} onStar={() => toggle(s.desk.id)} />
        ))}
      </div>
      <p className="hint center">★を押すと、自分の相談先を先頭に固定できます(この端末だけの設定)。</p>
    </>
  );
}

function DeskCard({ s, nowMs, mine, onStar }: { s: DeskState; nowMs: number; mine: boolean; onStar(): void }) {
  const { snap } = useStore();
  const vname = (id: string) => snap?.visitors.find((v) => v.id === id);
  const n = s.waiting.length;
  return (
    <article className={`card desk ${s.desk.active ? '' : 'off'} ${mine ? 'mine' : ''}`}>
      <header>
        <button className="star" aria-pressed={mine} aria-label={`${s.desk.name}を先頭に固定`} onClick={onStar}>{mine ? '★' : '☆'}</button>
        <h3 onClick={() => go(`desk/${s.desk.id}`)}>{s.desk.name}</h3>
        {s.desk.booths > 1 && <Badge kind="info">{s.desk.booths}ブース</Badge>}
        {!s.desk.active && <Badge kind="off">休止中</Badge>}
      </header>
      <div className="desk-body" onClick={() => go(`desk/${s.desk.id}`)}>
        <div className="count">
          <b className={n > 0 ? 'hot' : ''}>{n}</b><span>人待ち</span>
          <em>{n === 0 && s.serving.length < s.desk.booths ? 'すぐご案内' : `目安 ${waitLabel(s.newArrivalWait)}`}</em>
        </div>
        <ul className="serving">
          {s.serving.map((t) => {
            const v = vname(t.visitorId);
            const m = minutesBetween(t.startedAt, nowMs);
            return (
              <li key={t.id}><Badge kind="serve">相談中</Badge> {v ? `${pad3(v.no)} ${v.surname}` : ''} <small>{m}分経過</small></li>
            );
          })}
        </ul>
        {n > 0 && (
          <ol className="chips">
            {s.waiting.slice(0, 6).map((w) => {
              const v = vname(w.ticket.visitorId);
              return <li key={w.ticket.id}>{v ? `${pad3(v.no)} ${v.surname}` : ''}</li>;
            })}
            {n > 6 && <li className="more">ほか{n - 6}人</li>}
          </ol>
        )}
      </div>
    </article>
  );
}
