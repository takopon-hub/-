import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, NetworkError, httpTransport, type Args } from './api';
import { Outbox } from './outbox';
import { allDeskStates, clockOffset, visitorViews, type DeskState, type VisitorView } from './queue';
import type { Role, Snapshot } from './types';

const POLL_MS = 3000;
const PASS_KEY = 'soudan.pass';

const safe = {
  get(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* 保存できなくても動く */ } },
  del(k: string) { try { localStorage.removeItem(k); } catch { /* noop */ } },
};
export { safe as storage };

export interface Toast { id: number; text: string; kind: 'info' | 'error' }

interface Ctx {
  role: Role | null;
  snap: Snapshot | null;
  nowMs: number;
  deskStates: DeskState[];
  views: VisitorView[];
  /** 直近の取得に成功しているか */
  online: boolean;
  lastOkAt: number | null;
  pending: number;
  toasts: Toast[];
  login(pass: string): Promise<void>;
  logout(): void;
  /** 操作を実行する。通信断ならキューに積む。業務エラーは画面に通知して false を返す。 */
  act(fn: string, args: Args, label: string): Promise<'done' | 'queued' | false>;
  /** 結果が必要な呼び出し(受付など)。エラーは投げる。 */
  call<T = unknown>(fn: string, args: Args): Promise<T>;
  notify(text: string, kind?: Toast['kind']): void;
  refresh(): Promise<void>;
}

const StoreCtx = createContext<Ctx | null>(null);
export const useStore = (): Ctx => {
  const c = useContext(StoreCtx);
  if (!c) throw new Error('StoreProvider が必要です');
  return c;
};

export function StoreProvider({ children }: { children: ReactNode }) {
  const [pass, setPass] = useState<string | null>(() => safe.get(PASS_KEY));
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [offset, setOffset] = useState(0);
  const [tick, setTick] = useState(Date.now());
  const [online, setOnline] = useState(true);
  const [lastOkAt, setLastOkAt] = useState<number | null>(null);
  const [pending, setPending] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const passRef = useRef(pass);
  passRef.current = pass;
  const inflight = useRef(false);
  const seq = useRef(0);

  const notify = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 2500);
  }, []);

  const logout = useCallback(() => {
    safe.del(PASS_KEY);
    setPass(null);
    setSnap(null);
  }, []);

  const outbox = useMemo(
    () =>
      new Outbox({
        transport: httpTransport,
        getPass: () => passRef.current,
        storage: (() => { try { return localStorage; } catch { return null; } })(),
        onChange: () => setPending(outboxRef.current?.pending ?? 0),
        onRejected: (op, err) => notify(`「${op.label}」は反映されませんでした: ${err.message}`, 'error'),
      }),
    [notify],
  );
  const outboxRef = useRef<Outbox | null>(null);
  outboxRef.current = outbox;
  useEffect(() => { setPending(outbox.pending); }, [outbox]);

  const refresh = useCallback(async () => {
    const p = passRef.current;
    if (!p || inflight.current) return;
    inflight.current = true;
    try {
      const s = (await httpTransport('snapshot', { p_pass: p })) as Snapshot;
      setSnap(s);
      setOffset(clockOffset(s.now, Date.now()));
      setOnline(true);
      setLastOkAt(Date.now());
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'E_AUTH')) {
        notify('パスコードが変更または無効化されました。再度ログインしてください', 'error');
        logout();
      } else if (e instanceof NetworkError) setOnline(false);
    } finally {
      inflight.current = false;
    }
  }, [logout, notify]);

  useEffect(() => {
    if (!pass) return;
    void refresh();
    const poll = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, POLL_MS);
    const onVis = () => { if (document.visibilityState === 'visible') { void refresh(); void outbox.flush(); } };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', onVis);
    return () => { clearInterval(poll); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('online', onVis); };
  }, [pass, refresh, outbox]);

  useEffect(() => { const t = setInterval(() => setTick(Date.now()), 15000); return () => clearInterval(t); }, []);

  const login = useCallback(async (p: string) => {
    const s = (await httpTransport('snapshot', { p_pass: p })) as Snapshot;   // 失敗は呼び出し側で表示
    safe.set(PASS_KEY, p);
    passRef.current = p;
    setSnap(s);
    setOffset(clockOffset(s.now, Date.now()));
    setPass(p);
    setOnline(true);
    setLastOkAt(Date.now());
  }, []);

  const act = useCallback<Ctx['act']>(async (fn, args, label) => {
    try {
      const r = await outbox.send(fn, args, label);
      if (r.status === 'queued') notify('通信できないため保存しました。つながり次第、自動で送信します');
      void refresh();
      return r.status;
    } catch (e) {
      if (e instanceof ApiError) {
        notify(e.message, 'error');
        void refresh();
        return false;
      }
      throw e;
    }
  }, [outbox, notify, refresh]);

  const call = useCallback<Ctx['call']>(async <T,>(fn: string, args: Args) => {
    const r = (await httpTransport(fn, { p_pass: passRef.current, ...args })) as T;
    void refresh();
    return r;
  }, [refresh]);

  const nowMs = tick + offset;   // tick は端末時刻なのでサーバー時刻に補正
  const deskStates = useMemo(() => (snap ? allDeskStates(snap.desks, snap.tickets, nowMs) : []), [snap, nowMs]);
  const views = useMemo(() => (snap ? visitorViews(snap.visitors, snap.tickets) : []), [snap]);

  const value: Ctx = {
    role: snap?.role ?? null, snap, nowMs, deskStates, views, online, lastOkAt, pending, toasts,
    login, logout, act, call, notify, refresh,
  };
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}
