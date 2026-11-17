import { StoreProvider, useStore, storage } from './lib/store';
import { Admin } from './ui/Admin';
import { Board } from './ui/Board';
import { useRoute } from './ui/common';
import { DeskScreen } from './ui/DeskScreen';
import { Login } from './ui/Login';
import { Register } from './ui/Register';
import { ThemeButton } from './ui/ThemeButton';
import { VisitorScreen } from './ui/VisitorScreen';
import { Visitors } from './ui/Visitors';

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}

function Shell() {
  const { snap, logout } = useStore();
  if (!snap) {
    if (storage.get('soudan.pass')) {
      return <main className="login"><p>読み込み中…</p><button className="btn ghost" onClick={logout}>ログインし直す</button></main>;
    }
    return <Login />;
  }
  return <Main />;
}

function Main() {
  const { role, online, lastOkAt, pending, toasts, logout } = useStore();
  const route = useRoute();
  const op = role === 'operator';
  const [page, arg] = route;
  const tab = page === 'register' ? 'register' : page === 'visitors' || page === 'visitor' ? 'visitors' : page === 'admin' ? 'admin' : 'board';

  const tabs: Array<[string, string, string]> = [
    ['board', '', 'ボード'],
    ...(op ? [['register', 'register', '受付'] as [string, string, string]] : []),
    ['visitors', 'visitors', '相談者'],
    ...(op ? [['admin', 'admin', '管理'] as [string, string, string]] : []),
  ];

  return (
    <>
      <header className="topbar">
        <strong><span>住宅再建</span> <span>無料相談会</span></strong>
        <span className={`role ${op ? 'op' : 'vw'}`}>{op ? '操作者' : '閲覧のみ'}</span>
        <ThemeButton />
        <button className="btn ghost small" onClick={() => { if (confirm('ログアウトしますか?')) logout(); }}>ログアウト</button>
      </header>
      {!online && (
        <div className="banner error" role="alert">
          通信できません。表示は{lastOkAt ? new Date(lastOkAt).toLocaleTimeString('ja-JP') : '—'}時点の内容です(自動で再接続します)
        </div>
      )}
      {pending > 0 && <div className="banner warn" role="status">未送信の操作が{pending}件あります。つながり次第、自動で送信します</div>}
      <main className="content">
        {page === 'desk' && arg ? <DeskScreen id={Number(arg)} />
          : page === 'visitor' && arg ? <VisitorScreen id={arg} />
          : page === 'visitors' ? <Visitors initial={arg === 'idle' ? 'idle' : undefined} key={arg ?? ''} />
          : page === 'register' && op ? <Register />
          : page === 'admin' && op ? <Admin />
          : <Board />}
      </main>
      <nav className="tabs" aria-label="メニュー">
        {tabs.map(([key, href, label]) => (
          <a key={key} href={`#/${href}`} className={tab === key ? 'on' : ''} aria-current={tab === key ? 'page' : undefined}>{label}</a>
        ))}
      </nav>
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
      </div>
    </>
  );
}
