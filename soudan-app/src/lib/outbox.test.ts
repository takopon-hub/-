import { describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError, type Args } from './api';
import { Outbox } from './outbox';

function setup(script: Array<'ok' | 'net' | 'reject'>) {
  const calls: Array<{ fn: string; args: Args }> = [];
  const rejected: string[] = [];
  const mem = new Map<string, string>();
  const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  const transport = vi.fn(async (fn: string, args: Args) => {
    calls.push({ fn, args });
    const step = script.shift() ?? 'ok';
    if (step === 'net') throw new NetworkError('x');
    if (step === 'reject') throw new ApiError('E_BAD_STATE', 'ng', 400);
    return { ok: true };
  });
  const make = () => new Outbox({ transport, getPass: () => 'pw', storage, retryMs: 5, onRejected: (op) => rejected.push(op.fn) });
  return { make, calls, rejected, mem };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Outbox', () => {
  it('通信できれば即時送信し、パスコードを付ける', async () => {
    const s = setup([]);
    const ob = s.make();
    expect(await ob.send('finish_ticket', { p_ticket_id: 'a' })).toEqual({ status: 'done', result: { ok: true } });
    expect(s.calls[0].args).toEqual({ p_pass: 'pw', p_ticket_id: 'a' });
    expect(ob.pending).toBe(0);
  });

  it('通信断なら保存して再送し、順番を保つ', async () => {
    const s = setup(['net', 'net']);
    const ob = s.make();
    expect((await ob.send('a', {})).status).toBe('queued');
    expect((await ob.send('b', {})).status).toBe('queued');   // キューが残っている間は追い越さない
    expect(ob.pending).toBe(2);
    await wait(60);
    expect(ob.pending).toBe(0);
    expect(s.calls.map((c) => c.fn)).toEqual(['a', 'a', 'a', 'b']);   // 失敗した a の再送 → a → b
  });

  it('保存したキューは再起動後に再送される。保存内容にパスコードを含めない', async () => {
    const s = setup(['net']);
    const ob = s.make();
    await ob.send('enqueue', { p_visitor_id: 'v' });
    expect(s.mem.get('soudan.outbox')).not.toContain('pw');
    const ob2 = s.make();            // 画面の再読み込み
    expect(ob2.pending).toBe(1);
    await wait(30);
    expect(ob2.pending).toBe(0);
  });

  it('業務エラーで拒否された操作は捨てて通知し、後続は送る', async () => {
    const s = setup(['net', 'reject']);
    const ob = s.make();
    await ob.send('a', {});
    await ob.send('b', {});
    await wait(60);
    expect(s.rejected).toEqual(['a']);
    expect(ob.pending).toBe(0);
  });

  it('即時送信での業務エラーは呼び出し側に投げる(キューに積まない)', async () => {
    const s = setup(['reject']);
    const ob = s.make();
    await expect(ob.send('a', {})).rejects.toBeInstanceOf(ApiError);
    expect(ob.pending).toBe(0);
  });
});
