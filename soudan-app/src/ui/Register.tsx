import { useRef, useState } from 'react';
import { ApiError, NetworkError } from '../lib/api';
import { useStore } from '../lib/store';
import { waitLabel } from '../lib/queue';
import { CATEGORY_LABEL, newId, pad3 } from '../lib/format';
import { CATEGORIES, CategoryTag } from './common';

interface Done { no: number; deskName: string }

export function Register() {
  const { deskStates, call, notify } = useStore();
  const [first, setFirst] = useState<number | null>(null);
  const [wishes, setWishes] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [err, setErr] = useState('');
  // 通信が切れて再試行しても二重登録にならないよう、送信が成功するまで同じIDを使う
  const ids = useRef({ visitor: newId(), ticket: newId() });

  const active = deskStates.filter((s) => s.desk.active);
  const valid = first !== null;
  const toggleWish = (id: number) => setWishes((w) => (w.includes(id) ? w.filter((x) => x !== id) : [...w, id]));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || first === null) return;
    setBusy(true);
    setErr('');
    try {
      const r = await call<{ no: number }>('register_visitor', {
        p_visitor_id: ids.current.visitor, p_ticket_id: ids.current.ticket,
        p_desk_id: first, p_wishes: wishes,
      });
      setDone({ no: r.no, deskName: deskStates.find((s) => s.desk.id === first)?.desk.name ?? '' });
      ids.current = { visitor: newId(), ticket: newId() };
      setFirst(null); setWishes([]);
    } catch (e2) {
      if (e2 instanceof NetworkError) setErr('通信できませんでした。電波を確認して、もう一度「受付する」を押してください(二重に登録されることはありません)。');
      else if (e2 instanceof ApiError) setErr(e2.message);
      else { setErr('登録に失敗しました'); notify('登録に失敗しました', 'error'); }
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <section className="card done-card" role="status">
        <p>受付番号</p>
        <div className="big-no">{pad3(done.no)}</div>
        <p>→ {done.deskName}</p>
        <p className="hint">番号札に番号を書いてお渡しください。お名前などは伺いません。この番号で呼び出します。</p>
        <button className="btn primary block" onClick={() => setDone(null)}>次の方を受付する</button>
      </section>
    );
  }

  return (
    <form onSubmit={submit} className="card form">
      <h2>新規受付</h2>
      <p className="hint">お名前・電話番号などは取りません。受付番号だけで管理します。</p>

      <fieldset>
        <legend>最初に並ぶ相談先(1つ選ぶ)</legend>
        {CATEGORIES.map((c) => {
          const list = active.filter((s) => s.desk.category === c);
          if (!list.length) return null;
          return (
            <div key={c} className="radio-group">
              <p className={`group-label cat-${c}`}>{CATEGORY_LABEL[c]}</p>
              <div className="radio-list">
                {list.map((s) => (
                  <label key={s.desk.id} className={`radio cat-bar cat-${c} ${first === s.desk.id ? 'on' : ''}`}>
                    <input type="radio" name="first" checked={first === s.desk.id} onChange={() => setFirst(s.desk.id)} />
                    <span className="grow">{s.desk.name}</span>
                    <span>待ち{s.waiting.length}人 / {waitLabel(s.newArrivalWait)}</span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </fieldset>

      <fieldset>
        <legend>ほかに相談を希望する相談先(複数選べます・任意)</legend>
        <p className="hint">次にどこへ行くかは、相談しながら決まります。ここで選んだ先は目安として、終了時に上に表示されます。</p>
        <div className="chips-row">
          {active.filter((s) => s.desk.id !== first).map((s) => (
            <button type="button" key={s.desk.id} className={`chip cat-chip cat-${s.desk.category} ${wishes.includes(s.desk.id) ? 'on' : ''}`}
              aria-pressed={wishes.includes(s.desk.id)} onClick={() => toggleWish(s.desk.id)}>{s.desk.name}</button>
          ))}
        </div>
      </fieldset>

      {err && <p className="error" role="alert">{err}</p>}
      <button className="btn primary block" disabled={!valid || busy}>{busy ? '登録中…' : '受付する'}</button>
      {first !== null && <p className="hint center"><CategoryTag category={active.find((s) => s.desk.id === first)?.desk.category ?? 'finance'} /> を最初の相談先として登録します</p>}
    </form>
  );
}
