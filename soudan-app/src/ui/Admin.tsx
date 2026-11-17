import { useEffect, useState } from 'react';
import { ApiError } from '../lib/api';
import { useStore } from '../lib/store';
import type { Category, Desk } from '../lib/types';
import { CATEGORY_LABEL, hhmm } from '../lib/format';
import { CATEGORIES, Sheet } from './common';
import { getTheme, setTheme, type Theme } from '../lib/theme';

const CONFIRM = '全データを削除';

export function Admin() {
  const { snap } = useStore();
  const [log, setLog] = useState(false);
  return (
    <>
      <h2 className="page-title">管理</h2>
      <ThemePicker />
      <h3 className="section">相談先</h3>
      <p className="hint">表示順は「順」の数字が小さいものから(公的機関等 10〜、民間協会 110〜、金融機関 210〜)。弁護士会・建築士事務所協会のように窓口が複数ある場合は、窓口ごとに相談先を追加してください。</p>
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
  const [category, setCategory] = useState<Category>(d?.category ?? 'finance');
  const [sort, setSort] = useState(d?.sort ?? 310);
  const dirty = !d || name !== d.name || category !== d.category || sort !== d.sort;

  async function save(active: boolean) {
    if (!d) {
      try {
        await call('upsert_desk', { p_id: null, p_name: name, p_category: category, p_active: true, p_sort: sort });
        notify('相談先を追加しました');
        setName('');
      } catch (e) { notify(e instanceof ApiError ? e.message : '追加できませんでした', 'error'); }
      return;
    }
    await act('upsert_desk', { p_id: d.id, p_name: name, p_category: category, p_active: active, p_sort: sort }, `相談先「${d.name}」の設定`);
  }

  return (
    <li className={`item desk-edit cat-bar cat-${category} ${d && !d.active ? 'off' : ''}`}>
      <input aria-label="相談先名" value={name} placeholder={d ? '' : '追加する相談先名'} maxLength={40} onChange={(e) => setName(e.target.value)} />
      <label className="inline">区分<select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
        {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select></label>
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

const THEMES: { id: Theme; label: string }[] = [
  { id: 'auto', label: '端末の設定に合わせる' },
  { id: 'light', label: 'ライト(明るい)' },
  { id: 'dark', label: 'ダーク(暗い)' },
];

/** 表示の明るさ。この端末だけの設定(他の職員の画面は変わらない) */
function ThemePicker() {
  const [t, setT] = useState<Theme>(getTheme());
  return (
    <fieldset className="theme-picker">
      <legend>画面の表示(この端末だけ)</legend>
      <div className="chips-row">
        {THEMES.map((x) => (
          <button type="button" key={x.id} className={`chip ${t === x.id ? 'on' : ''}`} aria-pressed={t === x.id}
            onClick={() => { setT(x.id); setTheme(x.id); }}>{x.label}</button>
        ))}
      </div>
    </fieldset>
  );
}
