import { useState } from 'react';
import { useStore } from '../lib/store';
import { TICKET_LABEL, hhmm, minutesBetween, pad3 } from '../lib/format';
import { BackLink, Badge, Elapsed, Empty, useDeskMap } from './common';
import { NextSheet } from './NextSheet';
import { AwaySheet } from './Away';
import { whereLabel } from './Visitors';

export function VisitorScreen({ id }: { id: string }) {
  const { views, role, act, nowMs } = useStore();
  const desks = useDeskMap();
  const [sheet, setSheet] = useState(false);
  const [move, setMove] = useState(false);
  const [away, setAway] = useState(false);
  const [edit, setEdit] = useState(false);
  const view = views.find((v) => v.visitor.id === id);
  if (!view) return <><BackLink to="visitors">相談者</BackLink><Empty>相談者が見つかりません</Empty></>;
  const { visitor, current, history, idle, wishesLeft } = view;
  const op = role === 'operator';
  const deskName = (d: number) => desks.get(d)?.name ?? '';
  const w = whereLabel(view, deskName);
  const last = [...history].reverse().find((t) => t.status !== 'moved');
  const label = `${pad3(visitor.no)} ${visitor.surname}`;

  return (
    <>
      <BackLink to="visitors">相談者</BackLink>
      <section className="card">
        <div className="visitor-head">
          <div className="big-no sm">{pad3(visitor.no)}</div>
          <div className="grow">
            <h2>{visitor.surname}さん</h2>
            <Badge kind={w.kind}>{w.text}</Badge>
          </div>
        </div>
        <dl className="kv">
          <dt>希望の相談先</dt>
          <dd>
            {visitor.wishes.length === 0 ? '—' : visitor.wishes.map((d) => (
              <span key={d} className={`wish ${view.consultedDeskIds.includes(d) ? 'done' : ''}`}>
                {deskName(d)}{view.consultedDeskIds.includes(d) ? '✓' : ''}
              </span>
            ))}
          </dd>
          {op && <><dt>メモ</dt><dd>{visitor.memo || '—'}</dd></>}
        </dl>
        {op && edit && <EditForm visitorId={id} surname={visitor.surname} memo={visitor.memo ?? ''} wishes={visitor.wishes} onDone={() => setEdit(false)} />}
        {op && !edit && <button className="btn ghost" onClick={() => setEdit(true)}>名前・メモ・希望先を修正</button>}
        {!op && <p className="hint">メモは操作者のみ表示されます。</p>}
        {wishesLeft.length > 0 && visitor.status === 'in' && (
          <p className="hint">まだ相談していない希望: {wishesLeft.map(deskName).join('、')}</p>
        )}
      </section>

      {op && (
        <section className="card actions-card">
          <h3>操作</h3>
          <div className="actions">
            {idle && <button className="btn primary" onClick={() => setSheet(true)}>次の行き先を決める</button>}
            {current?.status === 'waiting' && (
              <>
                <button className="btn" onClick={() => setAway(true)}>昼食などで離席(待ちから外れる)</button>
                <button className="btn" onClick={() => setMove(true)}>別の相談先へ付け替え</button>
                <button className="btn" onClick={() => act('cancel_ticket', { p_ticket_id: current.id }, '待ち取消')}>待ちを取り消す</button>
              </>
            )}
            {current?.status === 'away' && (
              <>
                <button className="btn primary" onClick={() => act('resume_ticket', { p_ticket_id: current.id }, `${label} 離席から戻る`)}>戻った(最後尾に並び直す)</button>
                <button className="btn" onClick={() => act('cancel_ticket', { p_ticket_id: current.id }, '待ち取消')}>待ちを取り消す</button>
              </>
            )}
            {current?.status === 'serving' && (
              <button className="btn primary" onClick={async () => {
                const r = await act('finish_ticket', { p_ticket_id: current.id }, '相談終了');
                if (r !== false) setSheet(true);
              }}>相談を終了する</button>
            )}
            {visitor.status === 'in' && !current && (
              <button className="btn" onClick={() => setSheet(true)}>別の相談先へ並ぶ</button>
            )}
            {visitor.status === 'in' && (
              <button className="btn" onClick={() => act('leave_visitor', { p_visitor_id: id }, `${label} 帰宅`)}>帰宅</button>
            )}
            {visitor.status === 'left' && (
              <button className="btn" onClick={() => act('reopen_visitor', { p_visitor_id: id }, '帰宅を取り消し')}>帰宅を取り消す</button>
            )}
            {last && (last.status === 'done' || last.status === 'serving' || last.status === 'cancelled') && visitor.status === 'in' && (
              <button className="btn ghost" onClick={() => act('revert_ticket', { p_ticket_id: last.id }, '操作を戻す')}>
                直前の操作を戻す({last.status === 'done' ? '相談中に戻す' : '待機中に戻す'})
              </button>
            )}
          </div>
        </section>
      )}

      <h3 className="section">相談の履歴</h3>
      {history.length === 0 && <Empty>まだ相談先に並んでいません</Empty>}
      <ol className="timeline">
        {history.map((t) => (
          <li key={t.id} className={t.status}>
            <strong>{deskName(t.deskId)}</strong>{' '}
            <Badge kind={t.status === 'serving' ? 'serve' : t.status === 'waiting' ? 'wait' : t.status === 'away' ? 'warn' : t.status === 'done' ? 'done' : 'off'}>{TICKET_LABEL[t.status]}</Badge>
            <small>
              並んだ時刻 {hhmm(t.queuedAt)}
              {t.startedAt && ` / 開始 ${hhmm(t.startedAt)}`}
              {t.endedAt && t.status === 'done' && ` / 終了 ${hhmm(t.endedAt)}(${minutesBetween(t.startedAt, t.endedAt)}分)`}
            </small>
            {t.status === 'serving' && <Elapsed startedAt={t.startedAt} nowMs={nowMs} />}
          </li>
        ))}
        {visitor.status === 'left' && <li className="done"><strong>帰宅</strong></li>}
      </ol>
      {sheet && <NextSheet visitorId={id} onClose={() => setSheet(false)} />}
      {away && current?.status === 'waiting' && <AwaySheet ticketId={current.id} visitorId={id} deskName={deskName(current.deskId)} onClose={() => setAway(false)} />}
      {move && current && <NextSheet visitorId={id} moveTicketId={current.id} fromDeskId={current.deskId} onClose={() => setMove(false)} />}
    </>
  );
}

function EditForm({ visitorId, surname, memo, wishes, onDone }: { visitorId: string; surname: string; memo: string; wishes: number[]; onDone(): void }) {
  const { act, snap } = useStore();
  const [s, setS] = useState(surname);
  const [m, setM] = useState(memo);
  const [w, setW] = useState(wishes);
  const toggle = (d: number) => setW((x) => (x.includes(d) ? x.filter((y) => y !== d) : [...x, d]));
  return (
    <form className="form" onSubmit={async (e) => {
      e.preventDefault();
      const r = await act('update_visitor', { p_visitor_id: visitorId, p_surname: s.trim(), p_memo: m.trim(), p_wishes: w }, '情報修正');
      if (r !== false) onDone();
    }}>
      <label htmlFor="e-s">苗字</label><input id="e-s" value={s} maxLength={20} onChange={(e) => setS(e.target.value)} />
      <label htmlFor="e-m">メモ(60文字まで)</label><input id="e-m" value={m} maxLength={60} onChange={(e) => setM(e.target.value)} />
      <fieldset>
        <legend>希望の相談先</legend>
        <div className="chips-row">
          {(snap?.desks ?? []).filter((d) => d.active || w.includes(d.id)).map((d) => (
            <button type="button" key={d.id} className={`chip cat-chip cat-${d.category} ${w.includes(d.id) ? 'on' : ''}`}
              aria-pressed={w.includes(d.id)} onClick={() => toggle(d.id)}>{d.name}</button>
          ))}
        </div>
      </fieldset>
      <div className="actions"><button className="btn primary" disabled={!s.trim()}>保存</button><button type="button" className="btn ghost" onClick={onDone}>キャンセル</button></div>
    </form>
  );
}
