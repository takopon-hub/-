import type { Desk, Ticket, Visitor } from './types';

/** 実績が少ないときに使う1回あたりの相談時間(分) */
export const DEFAULT_MINUTES = 20;
/** 実績をこの件数以上集めたら平均で置き換える */
export const MIN_SAMPLES = 3;
/** 平均に使う直近の件数 */
export const RECENT_SAMPLES = 10;

const MIN_AVG = 5;
const MAX_AVG = 60;

const ms = (s: string | null) => (s ? Date.parse(s) : NaN);

/** 相談先ごとの平均相談時間(分)。直近の実績が MIN_SAMPLES 件未満なら DEFAULT_MINUTES。 */
export function avgMinutes(deskId: number, tickets: Ticket[]): { minutes: number; samples: number } {
  const done = tickets
    .filter((t) => t.deskId === deskId && t.status === 'done' && t.startedAt && t.endedAt)
    .sort((a, b) => ms(b.endedAt) - ms(a.endedAt))
    .slice(0, RECENT_SAMPLES);
  if (done.length < MIN_SAMPLES) return { minutes: DEFAULT_MINUTES, samples: done.length };
  const mean = done.reduce((s, t) => s + (ms(t.endedAt) - ms(t.startedAt)) / 60000, 0) / done.length;
  return { minutes: Math.min(MAX_AVG, Math.max(MIN_AVG, mean)), samples: done.length };
}

export interface WaitingEntry {
  ticket: Ticket;
  /** この人が呼ばれるまでの目安(分) */
  waitMinutes: number;
}

export interface DeskState {
  desk: Desk;
  waiting: WaitingEntry[];
  serving: Ticket[];
  /** 離席中(待ち行列から外れている) */
  away: Ticket[];
  avg: number;
  samples: number;
  /** いま並んだ場合の目安待ち時間(分) */
  newArrivalWait: number;
}

/** 5分単位に切り上げる(ホワイトボードに書きやすい)。0 は「すぐ」。 */
export function roundWait(minutes: number): number {
  return minutes <= 0 ? 0 : Math.ceil(minutes / 5) * 5;
}

export function waitLabel(minutes: number): string {
  const m = roundWait(minutes);
  return m === 0 ? 'すぐ' : `約${m}分`;
}

/**
 * 待ち行列の目安を計算する。
 * 各ブースの空き見込み = 相談中の人の残り時間(平均 - 経過、最低1分)。空きブースは0。
 * 待機順に、最も早く空くブースへ割り当てていく。
 */
export function deskState(desk: Desk, tickets: Ticket[], nowMs: number): DeskState {
  const { minutes: avg, samples } = avgMinutes(desk.id, tickets);
  const mine = tickets.filter((t) => t.deskId === desk.id);
  const serving = mine
    .filter((t) => t.status === 'serving')
    .sort((a, b) => (a.booth ?? 0) - (b.booth ?? 0));
  // 待機順はサーバーが返した並び(queue_at, id 順)をそのまま使う。離席による入れ替えもこの順に反映される。
  const away = mine.filter((t) => t.status === 'away');
  const waitingTickets = mine.filter((t) => t.status === 'waiting');

  const free: number[] = Array.from({ length: Math.max(desk.booths, 1) }, () => 0);
  serving.slice(0, free.length).forEach((t, i) => {
    const elapsed = (nowMs - ms(t.startedAt)) / 60000;
    free[i] = Math.max(1, avg - (Number.isFinite(elapsed) ? elapsed : 0));
  });

  const waiting: WaitingEntry[] = waitingTickets.map((ticket) => {
    const i = free.indexOf(Math.min(...free));
    const waitMinutes = free[i];
    free[i] += avg;
    return { ticket, waitMinutes };
  });
  return { desk, waiting, serving, away, avg, samples, newArrivalWait: Math.min(...free) };
}

export function allDeskStates(desks: Desk[], tickets: Ticket[], nowMs: number): DeskState[] {
  return desks.map((d) => deskState(d, tickets, nowMs));
}

/** ご案内待ち: ブースが空いているのに、待っている人がいる相談先(案内担当が動くべき相談先) */
export function readyDesks(states: DeskState[]): DeskState[] {
  return states.filter((s) => s.desk.active && s.waiting.length > 0 && s.serving.length < s.desk.booths);
}

/** ボードの色分け用の段階。0=待ちなし 1=薄黄(1人) 2〜4=薄赤→濃い赤(2〜4人) 5=赤(5人以上) */
export function waitLevel(waitingCount: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (waitingCount <= 0) return 0;
  if (waitingCount === 1) return 1;
  if (waitingCount >= 5) return 5;
  return waitingCount as 2 | 3 | 4;
}

/** 相談時間がこの分数を超えたら強調表示する */
export const OVERTIME_MINUTES = 20;
export const isOvertime = (elapsedMinutes: number | null) => elapsedMinutes !== null && elapsedMinutes >= OVERTIME_MINUTES;

export interface VisitorView {
  visitor: Visitor;
  /** 待機中・相談中・離席中の待ち札 */
  current: Ticket | null;
  /** 古い順の全待ち札 */
  history: Ticket[];
  /** 相談を終えた相談先(重複なし) */
  consultedDeskIds: number[];
  /** 会場内にいるのに、どこにも並んでいない(次の行き先が未決定) */
  idle: boolean;
  /** 希望していて、まだ相談していない(いま並んでいる先も除く)相談先 */
  wishesLeft: number[];
}

export function visitorViews(visitors: Visitor[], tickets: Ticket[]): VisitorView[] {
  const byVisitor = new Map<string, Ticket[]>();
  for (const t of tickets) {
    const list = byVisitor.get(t.visitorId);
    if (list) list.push(t);
    else byVisitor.set(t.visitorId, [t]);
  }
  return visitors.map((visitor) => {
    const history = (byVisitor.get(visitor.id) ?? []).sort(
      (a, b) => ms(a.queuedAt) - ms(b.queuedAt) || a.id.localeCompare(b.id),
    );
    const current = history.find((t) => t.status === 'waiting' || t.status === 'serving' || t.status === 'away') ?? null;
    const consultedDeskIds = [...new Set(history.filter((t) => t.status === 'done').map((t) => t.deskId))];
    const wishesLeft = visitor.status === 'left'
      ? []
      : visitor.wishes.filter((d) => !consultedDeskIds.includes(d) && d !== current?.deskId);
    return { visitor, current, history, consultedDeskIds, idle: visitor.status === 'in' && !current, wishesLeft };
  });
}

/** サーバー時刻との差(ms)。端末の時計がずれていても経過時間を正しく出す。 */
export function clockOffset(serverNow: string, clientNowMs: number): number {
  const s = Date.parse(serverNow);
  return Number.isFinite(s) ? s - clientNowMs : 0;
}
