import { useState } from 'react';
import { useStore } from '../lib/store';
import { LEAVE_LABEL, TICKET_LABEL, formatPhone, hhmm, minutesBetween, pad3 } from '../lib/format';
import { BackLink, Badge, Empty, useDeskMap } from './common';
import { NextSheet } from './NextSheet';
import { whereLabel } from './Visitors';

const PHONE_RE = /^0\d{9,10}$/;

export function VisitorScreen({ id }: { id: string }) {
  const { views, role, act, nowMs } = useStore();
  const desks = useDeskMap();
  const [sheet, setSheet] = useState(false);
  const [edit, setEdit] = useState(false);
  const view = views.find((v) => v.visitor.id === id);
  if (!view) return <><BackLink to="visitors">相談者</BackLink><Empty>相談者が見つかりません</Empty></>;
  const { visitor, current, history, idle } = view;
  const op = role === 'operator';
  const deskName = (d: number) => desks.get(d)?.name ?? '';
  const w = whereLabel(view, deskName);
  const last = history[history.length - 1];
  const label = `${pad3(visitor.no)} ${visitor.surname}`;
  const leave = (kind: 'done' | 'carryover' | 'dropped') => act('leave_visitor', { p_visitor_id: id, p_kind: kind }, `${label} 帰宅`);

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
        {op && !edit && (
          <dl className="kv">
            <dt>携帯電話</dt>
            <dd>{visitor.phone ? <a className="tel" href={`tel:${visitor.phone}`}>📞 {formatPhone(visitor.phone)}</a> : '—'}</dd>
            <dt>メモ</dt>
            <dd>{visitor.memo || '—'}</dd>
          </dl>
        )}
        {op && edit && <EditForm visitorId={id} surname={visitor.surname} phone={visitor.phone ?? ''} memo={visitor.memo ?? ''}
          onDone={() => setEdit(false)} />}
        {op && !edit && <button className="btn ghost" onClick={() => setEdit(true)}>情報を修正</button>}
        {!op && <p className="hint">電話番号とメモは操作者のみ表示されます。</p>}
      </section>

      {op && (
        <section className="card actions-card">
          <h3>操作</h3>
          <div className="actions">
            {idle && <button className="btn primary" onClick={() => setSheet(true)}>次の行き先を決める</button>}
            {current?.status === 'waiting' && (
              <button className="btn" onClick={() => act('cancel_ticket', { p_ticket_id: current.id }, '待ち取消')}>待ちを取り消す</button>
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
              <>
                <button className="btn" onClick={() => leave('done')}>帰宅(相談完了)</button>
                <button className="btn" onClick={() => leave('carryover')}>帰宅(持ち帰り)</button>
                <button className="btn" onClick={() => { if (confirm('途中離脱として帰宅扱いにしますか?')) void leave('dropped'); }}>途中離脱で帰宅</button>
              </>
            )}
            {visitor.status === 'left' && (
              <button className="btn" onClick={() => act('reopen_visitor', { p_visitor_id: id }, '帰宅を取り消し')}>帰宅を取り消す</button>
            )}
            {last && last.status !== 'waiting' && visitor.status === 'in' && (
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
            <strong>{deskName(t.deskId)}</strong> <Badge kind={t.status === 'serving' ? 'serve' : t.status === 'waiting' ? 'wait' : t.status === 'done' ? 'done' : 'off'}>{TICKET_LABEL[t.status]}</Badge>
            <small>
              受付 {hhmm(t.queuedAt)}
              {t.startedAt && ` / 開始 ${hhmm(t.startedAt)}`}
              {t.endedAt && t.status === 'done' && ` / 終了 ${hhmm(t.endedAt)}(${minutesBetween(t.startedAt, t.endedAt)}分)`}
              {t.status === 'serving' && ` / ${minutesBetween(t.startedAt, nowMs)}分経過`}
            </small>
          </li>
        ))}
        {visitor.status === 'left' && visitor.leaveKind && <li className="done"><strong>{LEAVE_LABEL[visitor.leaveKind]}</strong></li>}
      </ol>
      {sheet && <NextSheet visitorId={id} onClose={() => setSheet(false)} />}
    </>
  );
}

function EditForm({ visitorId, surname, phone, memo, onDone }: { visitorId: string; surname: string; phone: string; memo: string; onDone(): void }) {
  const { act } = useStore();
  const [s, setS] = useState(surname);
  const [p, setP] = useState(phone);
  const [m, setM] = useState(memo);
  const ok = s.trim().length > 0 && PHONE_RE.test(p.replace(/\D/g, ''));
  return (
    <form className="form" onSubmit={async (e) => {
      e.preventDefault();
      const r = await act('update_visitor', { p_visitor_id: visitorId, p_surname: s.trim(), p_phone: p.replace(/\D/g, ''), p_memo: m.trim() }, '情報修正');
      if (r !== false) onDone();
    }}>
      <label htmlFor="e-s">苗字</label><input id="e-s" value={s} maxLength={20} onChange={(e) => setS(e.target.value)} />
      <label htmlFor="e-p">携帯電話番号</label><input id="e-p" type="tel" inputMode="numeric" value={p} onChange={(e) => setP(e.target.value)} />
      <label htmlFor="e-m">メモ(60文字まで)</label><input id="e-m" value={m} maxLength={60} onChange={(e) => setM(e.target.value)} />
      <div className="actions"><button className="btn primary" disabled={!ok}>保存</button><button type="button" className="btn ghost" onClick={onDone}>キャンセル</button></div>
    </form>
  );
}
