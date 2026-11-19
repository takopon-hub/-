import { useState } from 'react';
import { useStore } from '../lib/store';
import type { VisitorView } from '../lib/queue';
import { TICKET_LABEL, pad3, noLabel } from '../lib/format';
import { Badge, Empty, useDeskMap } from './common';

type Filter = 'all' | 'in' | 'idle' | 'left';

export function whereLabel(v: VisitorView, deskName: (id: number) => string): { kind: 'wait' | 'serve' | 'done' | 'warn'; text: string } {
  if (v.visitor.status === 'left') return { kind: 'done', text: '帰宅' };
  if (v.current) return { kind: v.current.status === 'serving' ? 'serve' : v.current.status === 'away' ? 'warn' : 'wait', text: `${deskName(v.current.deskId)} ${TICKET_LABEL[v.current.status]}` };
  return { kind: 'warn', text: '次の行き先が未決定' };
}

export function Visitors({ initial }: { initial?: Filter }) {
  const { views } = useStore();
  const desks = useDeskMap();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>(initial ?? 'all');
  const name = (id: number) => desks.get(id)?.name ?? '';

  const norm = q.trim().replace(/^0+/, '');
  const list = views
    .filter((v) => (filter === 'all' ? true : filter === 'in' ? v.visitor.status === 'in' : filter === 'left' ? v.visitor.status === 'left' : v.idle))
    .filter((v) => !norm || String(v.visitor.no).startsWith(norm))
    .reverse();

  const chip = (f: Filter, label: string) => (
    <button className={`chip ${filter === f ? 'on' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>{label}</button>
  );

  return (
    <>
      <h2 className="page-title">相談者</h2>
      <input className="search" type="search" placeholder="受付番号で検索" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="chips-row">{chip('all', 'すべて')}{chip('in', '会場内')}{chip('idle', '行き先未決定')}{chip('left', '帰宅')}</div>
      {list.length === 0 && <Empty>該当する相談者がいません</Empty>}
      <ul className="list">
        {list.map((v) => {
          const w = whereLabel(v, name);
          return (
            <li key={v.visitor.id}>
              <a className="row-btn" href={`#/visitor/${v.visitor.id}`}>
                <b className="no">{pad3(v.visitor.no)}</b>
                <span className="grow"><strong>{noLabel(v.visitor)}</strong>
                  <small className="sub-line">相談済み {v.consultedDeskIds.length}か所{v.wishesLeft.length > 0 && ` / 希望あと${v.wishesLeft.length}か所`}</small></span>
                <Badge kind={w.kind}>{w.text}</Badge>
              </a>
            </li>
          );
        })}
      </ul>
    </>
  );
}
