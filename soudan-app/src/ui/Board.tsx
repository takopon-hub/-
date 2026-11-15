import { useState } from 'react';
import { useStore, storage } from '../lib/store';
import { waitLabel, waitLevel, type DeskState } from '../lib/queue';
import { CATEGORY_LABEL, pad3 } from '../lib/format';
import { Badge, CATEGORIES, CategoryTag, Elapsed, go } from './common';

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
  const pinned = deskStates.find((s) => s.desk.id === mine);
  const card = (s: DeskState) => (
    <DeskCard key={s.desk.id} s={s} nowMs={nowMs} mine={s.desk.id === mine} onStar={() => toggle(s.desk.id)} />
  );

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

      <Legend />

      {pinned && (
        <section aria-label="自分の相談先">
          <h2 className="group-title mine-title">★ 自分の相談先</h2>
          <div className="grid">{card(pinned)}</div>
        </section>
      )}

      {CATEGORIES.map((c) => {
        const list = deskStates.filter((s) => s.desk.category === c && s.desk.id !== mine);
        if (list.length === 0) return null;
        return (
          <section key={c} aria-label={CATEGORY_LABEL[c]}>
            <h2 className={`group-title cat-${c}`}>{CATEGORY_LABEL[c]}</h2>
            <div className="grid">{list.map(card)}</div>
          </section>
        );
      })}
      <p className="hint center">★を押すと、自分の相談先を先頭に固定できます(この端末だけの設定)。</p>
    </>
  );
}

/** 待ち人数による色分けの凡例 */
function Legend() {
  return (
    <p className="legend" aria-label="色の凡例">
      <span className="lg lv1">1人待ち</span>
      <span className="lg lv2">2人</span>
      <span className="lg lv3">3人</span>
      <span className="lg lv4">4人</span>
      <span className="lg lv5">5人以上</span>
    </p>
  );
}

function DeskCard({ s, nowMs, mine, onStar }: { s: DeskState; nowMs: number; mine: boolean; onStar(): void }) {
  const { snap } = useStore();
  const vname = (id: string) => snap?.visitors.find((v) => v.id === id);
  const n = s.waiting.length;
  const lv = waitLevel(n);
  return (
    <article className={`card desk lv${lv} cat-bar cat-${s.desk.category} ${s.desk.active ? '' : 'off'} ${mine ? 'mine' : ''}`}>
      <header>
        <button className="star" aria-pressed={mine} aria-label={`${s.desk.name}を先頭に固定`} onClick={onStar}>{mine ? '★' : '☆'}</button>
        <h3 onClick={() => go(`desk/${s.desk.id}`)}>{s.desk.name}</h3>
        <CategoryTag category={s.desk.category} />
        {!s.desk.active && <Badge kind="off">休止中</Badge>}
      </header>
      <div className="desk-body" onClick={() => go(`desk/${s.desk.id}`)}>
        <div className="count">
          <b>{n}</b><span>人待ち</span>
          <em>{n === 0 && s.serving.length < s.desk.booths ? 'すぐご案内' : `目安 ${waitLabel(s.newArrivalWait)}`}</em>
        </div>
        <ul className="serving">
          {s.serving.map((t) => {
            const v = vname(t.visitorId);
            return (
              <li key={t.id}>
                <Badge kind="serve">相談中</Badge> <span className="who">{v ? `${pad3(v.no)} ${v.surname}` : ''}</span>
                <Elapsed startedAt={t.startedAt} nowMs={nowMs} />
              </li>
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
