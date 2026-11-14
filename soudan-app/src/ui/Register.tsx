import { useRef, useState } from 'react';
import { ApiError, NetworkError } from '../lib/api';
import { useStore } from '../lib/store';
import { waitLabel } from '../lib/queue';
import { newId, pad3 } from '../lib/format';

const PHONE_RE = /^0\d{9,10}$/;

interface Done { no: number; surname: string; deskName: string }

export function Register() {
  const { deskStates, call, notify } = useStore();
  const [surname, setSurname] = useState('');
  const [phone, setPhone] = useState('');
  const [memo, setMemo] = useState('');
  const [deskId, setDeskId] = useState<number | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [err, setErr] = useState('');
  // 通信が切れて再試行しても二重登録にならないよう、送信が成功するまで同じIDを使う
  const ids = useRef({ visitor: newId(), ticket: newId() });

  const digits = phone.replace(/\D/g, '');
  const valid = surname.trim().length > 0 && PHONE_RE.test(digits) && consent && deskId !== null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || deskId === null) return;
    setBusy(true);
    setErr('');
    try {
      const r = await call<{ no: number }>('register_visitor', {
        p_visitor_id: ids.current.visitor, p_ticket_id: ids.current.ticket,
        p_surname: surname.trim(), p_phone: digits, p_desk_id: deskId, p_memo: memo.trim(),
      });
      setDone({ no: r.no, surname: surname.trim(), deskName: deskStates.find((s) => s.desk.id === deskId)?.desk.name ?? '' });
      ids.current = { visitor: newId(), ticket: newId() };
      setSurname(''); setPhone(''); setMemo(''); setDeskId(null); setConsent(false);
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
        <p><strong>{done.surname}</strong>さん → {done.deskName}</p>
        <p className="hint">番号札に番号を書いてお渡しください。</p>
        <button className="btn primary block" onClick={() => setDone(null)}>次の方を受付する</button>
      </section>
    );
  }

  return (
    <form onSubmit={submit} className="card form">
      <h2>新規受付</h2>
      <label htmlFor="surname">苗字</label>
      <input id="surname" value={surname} maxLength={20} autoComplete="off" onChange={(e) => setSurname(e.target.value)} />
      <label htmlFor="phone">携帯電話番号(当日の呼び出し連絡用)</label>
      <input id="phone" type="tel" inputMode="numeric" autoComplete="off" placeholder="09012345678" value={phone}
        onChange={(e) => setPhone(e.target.value)} />
      {phone && !PHONE_RE.test(digits) && <p className="error">0から始まる10〜11桁で入力してください</p>}
      <label htmlFor="memo">メモ(任意・60文字まで。相談内容など詳しい事情は書かないでください)</label>
      <input id="memo" value={memo} maxLength={60} autoComplete="off" onChange={(e) => setMemo(e.target.value)} />

      <fieldset>
        <legend>最初の相談先</legend>
        <div className="radio-list">
          {deskStates.filter((s) => s.desk.active).map((s) => (
            <label key={s.desk.id} className={`radio ${deskId === s.desk.id ? 'on' : ''}`}>
              <input type="radio" name="desk" checked={deskId === s.desk.id} onChange={() => setDeskId(s.desk.id)} />
              <span className="grow">{s.desk.name}</span>
              <span>待ち{s.waiting.length}人 / {waitLabel(s.newArrivalWait)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="check">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>個人情報の取り扱い(パンフレット記載)を口頭で説明し、同意を得た。苗字と受付番号は相談先の職員にも共有されます。</span>
      </label>
      {err && <p className="error" role="alert">{err}</p>}
      <button className="btn primary block" disabled={!valid || busy}>{busy ? '登録中…' : '受付する'}</button>
    </form>
  );
}
