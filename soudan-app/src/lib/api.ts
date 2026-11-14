const BASE: string = import.meta.env.VITE_API_URL ?? '/rest/v1/rpc';
const KEY: string | undefined = import.meta.env.VITE_API_KEY;
const TIMEOUT_MS = 10_000;

/** サーバーが業務上の理由で拒否した(再送しても結果は変わらない) */
export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

/** 通信できなかった・タイムアウト・サーバー側の一時的な失敗(再送してよい) */
export class NetworkError extends Error {}

export type Args = Record<string, unknown>;
export type Transport = (fn: string, args: Args) => Promise<unknown>;

export const httpTransport: Transport = async (fn, args) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (KEY) {
      headers.apikey = KEY;
      if (KEY.startsWith('eyJ')) headers.Authorization = `Bearer ${KEY}`;
    }
    res = await fetch(`${BASE}/${fn}`, { method: 'POST', headers, body: JSON.stringify(args), signal: ctrl.signal });
  } catch {
    throw new NetworkError('通信できません');
  } finally {
    clearTimeout(timer);
  }
  if (res.ok) return res.json();
  if (res.status >= 500 || res.status === 429 || res.status === 408) throw new NetworkError(`サーバーが応答しません(${res.status})`);
  let message = `エラー(${res.status})`;
  try {
    const body = (await res.json()) as { message?: string };
    if (body.message) message = body.message;
  } catch { /* 本文なし */ }
  const m = /^(E_[A-Z_]+):\s*(.*)$/s.exec(message);
  throw new ApiError(m ? m[1] : 'E_UNKNOWN', m ? m[2] : message, res.status);
};
