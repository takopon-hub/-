import { ApiError, NetworkError, type Args, type Transport } from './api';

/**
 * 通信断に備えた送信キュー。
 *  - 通信できなかった操作は端末に保存し、順番を保ったまま自動で再送する。
 *  - 再送しても二重にならないよう、サーバー側の関数は冪等(同じIDなら成功扱い)になっている。
 *  - サーバーが業務上の理由で拒否した操作はキューから外し、onRejected で利用者に知らせる。
 *  - パスコードはキューに保存せず、送信時に getPass() から付ける。
 */
export interface Op {
  id: number;
  fn: string;
  args: Args;
  label: string;
}

export interface OutboxOptions {
  transport: Transport;
  getPass: () => string | null;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  storageKey?: string;
  retryMs?: number;
  onRejected?: (op: Op, err: ApiError) => void;
  onChange?: () => void;
}

export type SendResult = { status: 'done'; result: unknown } | { status: 'queued' };

export class Outbox {
  private ops: Op[] = [];
  private seq = 0;
  private flushing: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private o: OutboxOptions) {
    try {
      const raw = o.storage?.getItem(o.storageKey ?? 'soudan.outbox');
      if (raw) {
        this.ops = JSON.parse(raw) as Op[];
        this.seq = this.ops.reduce((m, x) => Math.max(m, x.id), 0);
      }
    } catch { /* 破損していたら空で始める */ }
    if (this.ops.length) this.schedule(0);
  }

  get pending(): number { return this.ops.length; }
  get labels(): string[] { return this.ops.map((x) => x.label); }

  private save() {
    try { this.o.storage?.setItem(this.o.storageKey ?? 'soudan.outbox', JSON.stringify(this.ops)); } catch { /* 保存できなくても動作は続ける */ }
    this.o.onChange?.();
  }

  private async call(fn: string, args: Args) {
    return this.o.transport(fn, { p_pass: this.o.getPass(), ...args });
  }

  /** 操作を送る。キューが空なら即時送信し、通信できなければキューに積んで再送する。 */
  async send(fn: string, args: Args, label = fn): Promise<SendResult> {
    if (this.ops.length === 0) {
      try {
        return { status: 'done', result: await this.call(fn, args) };
      } catch (e) {
        if (!(e instanceof NetworkError)) throw e;   // 業務エラーは呼び出し側へ
      }
    }
    this.ops.push({ id: ++this.seq, fn, args, label });
    this.save();
    this.schedule(this.o.retryMs ?? 3000);
    return { status: 'queued' };
  }

  private schedule(ms: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, ms);
  }

  /** 先頭から順に再送する。通信できなければ止めて、あとでやり直す。 */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      while (this.ops.length) {
        const op = this.ops[0];
        try {
          await this.call(op.fn, op.args);
        } catch (e) {
          if (e instanceof NetworkError) { this.schedule(this.o.retryMs ?? 3000); break; }
          if (e instanceof ApiError) this.o.onRejected?.(op, e);
          else throw e;
        }
        this.ops.shift();
        this.save();
      }
    })().finally(() => { this.flushing = null; });
    return this.flushing;
  }
}
