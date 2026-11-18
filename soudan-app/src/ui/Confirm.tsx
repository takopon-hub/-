import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Sheet } from './common';

export interface AskOptions {
  title: string;
  /** 登録内容を1行ずつ(「誰が」「どこへ」など) */
  lines: Array<[string, string]>;
  okLabel: string;
  note?: string;
}
type Ask = (o: AskOptions) => Promise<boolean>;

const Ctx = createContext<Ask>(() => Promise.resolve(true));
export const useAsk = () => useContext(Ctx);

/** 相談者の動きを登録する前に、登録内容を確認させる画面 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<AskOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);
  const ask = useCallback<Ask>((o) => new Promise<boolean>((resolve) => {
    resolver.current?.(false);
    resolver.current = resolve;
    setOpts(o);
  }), []);
  const done = (v: boolean) => { resolver.current?.(v); resolver.current = null; setOpts(null); };
  return (
    <Ctx.Provider value={ask}>
      {children}
      {opts && (
        <Sheet title={opts.title} onClose={() => done(false)}>
          <dl className="kv confirm-kv">
            {opts.lines.map(([k, v]) => <div key={k} className="confirm-row"><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
          {opts.note && <p className="hint">{opts.note}</p>}
          <div className="actions">
            <button className="btn primary" data-confirm-ok onClick={() => done(true)}>{opts.okLabel}</button>
            <button className="btn ghost" data-confirm-cancel onClick={() => done(false)}>やめる</button>
          </div>
        </Sheet>
      )}
    </Ctx.Provider>
  );
}
