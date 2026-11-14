import { useEffect, useState } from 'react';
import { ApiError } from '../lib/api';
import { useStore } from '../lib/store';
import type { Desk } from '../lib/types';
import { hhmm } from '../lib/format';
import { Sheet } from './common';

const CONFIRM = '全データを削除';

export function Admin() {
  const { snap } = useStore();
  const [log, setLog] = useState(false);
  return (
    <>
      <h2 className="page-title">管理</h2>
      <h3 className="section">相談先</h3>
      <ul className="list">{(snap?.desks ?? []).map((d) => <DeskRow key={d.id} d={d} />)}</ul>
      <DeskRow d={null} />
      <Passcodes />
      <Purge />
      <h3 className="section">操作ログ</h3>
      <button className="btn" onClick={() => setLog(true)}>操作ログを見る(氏名・電話番号は含みません)</button>
      {log && <LogSheet onClose={() => setLog(false)} />}
    </>
  );
}

function DeskRow({ d }: { d: Desk | null }) {
  const { act, call, notify } = useStore();
  const [name, setName] = useState(d?.name ?? '');
  const [booths, setBooths] = useState(d?.booths ?? 1);
  const [sort, setSort] = useState(d?.sort ?? 150);
  const dirty = !d || name !== d.name || booths !== d.booths || sort !== d.sort;

  async function save(active: boolean) {
    if (!d) {
      try {
        await call('upsert_desk', { p_id: null, p_name: name, p_booths: booths, p_active: true, p_sort: sort });
        notify('相談先を追加しました');
        setName(''); setBooths(1);
      } catch (e) { notify(e instanceof ApiError ? e.message : '追加できませんでした', 'error'); }
      return;
    }
    await act('upsert_desk', { p_id: d.id, p_name: name, p_booths: booths, p_active: active, p_sort: sort }, `相談先「${d.name}」の設定`);
  }

  return (
    <li className={`item desk-edit ${d && !d.active ? 'off' : ''}`}>
      <input aria-label="相談先名" value={name} placeholder={d ? '' : '追加する相談先名'} maxLength={40} onChange={(e) => setName(e.target.value)} />
      <label className="inline">ブース<select value={booths} onChange={(e) => setBooths(Number(e.target.value))}>
        {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
      <label className="inline">順<input className="narrow" type="number" value={sort} onChange={(e) => setSort(Number(e.target.value))} /></label>
      {d ? (
        <>
          <button className="btn" disabled={!dirty || !name.trim()} onClick={() => save(d.active)}>保存</button>
          <button className="btn ghost" onClick={() => save(!d.active)}>{d.active ? '休止にする' : '再開する'}</button>
        </>
      ) : (
        <button className="btn primary" disabled={!name.trim()} onClick={() => save(true)}>追加</button>
      )}
    </li>
  );
}

function Passcodes() {
  const { call, notify, logout } = useStore();
  const [op, setOp] = useState('');
  const [vw, setVw] = useState('');
  const ok = op.length >= 8 && vw.length >= 8 && op !== vw;
  return (
    <>
      <h3 className="section">パスコード変更</h3>
      <form className="card form" onSubmit={async (e) => {
        e.preventDefault();
        if (!confirm('パスコードを変更します。配布済みのパスコードは使えなくなり、全員が再ログインになります。よろしいですか?')) return;
        try {
          await call('set_passcodes', { p_new_operator: op, p_new_viewer: vw });
          notify('変更しました。新しいパスコードでログインし直してください');
          logout();
        } catch (e2) { notify(e2 instanceof ApiError ? e2.message : '変更できませんでした', 'error'); }
      }}>
        <label htmlFor="n-op">新しい操作用パスコード(8文字以上)</label>
        <input id="n-op" type="password" autoComplete="new-password" value={op} onChange={(e) => setOp(e.target.value)} />
        <label htmlFor="n-vw">新しい閲覧用パスコード(8文字以上・操作用と別)</label>
        <input id="n-vw" type="password" autoComplete="new-password" value={vw} onChange={(e) => setVw(e.target.value)} />
        <button className="btn" disabled={!ok}>パスコードを変更</button>
      </form>
    </>
  );
}

function Purge() {
  const { call, notify, logout, snap } = useStore();
  const [text, setText] = useState('');
  const [revoke, setRevoke] = useState(true);
  const n = snap?.visitors.length ?? 0;
  return (
    <>
      <h3 className="section danger-title">相談会終了後のデータ削除</h3>
      <form className="card form danger" onSubmit={async (e) => {
        e.preventDefault();
        if (!confirm(`受付済み ${n} 人分の氏名・電話番号・相談履歴をすべて削除します。元に戻せません。本当に削除しますか?`)) return;
        try {
          await call('purge_all', { p_confirm: text, p_revoke_passcodes: revoke });
          notify('すべて削除しました');
          if (revoke) logout();
        } catch (e2) { notify(e2 instanceof ApiError ? e2.message : '削除できませんでした', 'error'); }
      }}>
        <p>受付した方の苗字・携帯電話番号・メモ・相談履歴と操作ログをすべて削除します。相談先の設定は残ります。</p>
        <label htmlFor="purge">確認のため「{CONFIRM}」と入力してください</label>
        <input id="purge" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
        <label className="check"><input type="checkbox" checked={revoke} onChange={(e) => setRevoke(e.target.checked)} />
          <span>削除後、全員のパスコードも無効にする(再開するには管理者が再設定します)</span></label>
        <button className="btn danger-btn" disabled={text !== CONFIRM}>すべて削除する</button>
      </form>
    </>
  );
}

function LogSheet({ onClose }: { onClose(): void }) {
  const { call } = useStore();
  const [rows, setRows] = useState<Array<{ at: string; action: string; detail: string }> | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { call<typeof rows>('get_log', {}).then(setRows).catch(() => setErr('取得できませんでした')); }, [call]);
  return (
    <Sheet title="操作ログ(直近200件)" onClose={onClose}>
      {err && <p className="error">{err}</p>}
      {!rows && !err && <p>読み込み中…</p>}
      <ul className="log">{rows?.map((r, i) => <li key={i}><time>{hhmm(r.at)}</time> {r.action} <small>{r.detail}</small></li>)}</ul>
    </Sheet>
  );
}
