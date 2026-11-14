import { useState } from 'react';
import { ApiError } from '../lib/api';
import { useStore } from '../lib/store';

export function Login() {
  const { login } = useStore();
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await login(pass.trim());
    } catch (e2) {
      setErr(e2 instanceof ApiError ? 'パスコードが違います' : '通信できません。電波を確認してもう一度お試しください');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <h1>住宅再建 無料相談会</h1>
      <p className="sub">受付・待ち状況の共有</p>
      <form onSubmit={submit} className="card">
        <label htmlFor="pass">パスコード</label>
        <input id="pass" type="password" autoComplete="off" autoCapitalize="off" value={pass}
          onChange={(e) => setPass(e.target.value)} placeholder="配布されたパスコード" />
        {err && <p className="error" role="alert">{err}</p>}
        <button className="btn primary block" disabled={busy || !pass.trim()}>{busy ? '確認中…' : 'ログイン'}</button>
        <p className="hint">操作用のパスコードで受付・案内の操作ができます。閲覧用のパスコードでは待ち状況の確認のみ行えます。</p>
      </form>
    </main>
  );
}
