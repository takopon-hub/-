import { describe, expect, it } from 'vitest';
import { allDeskStates, readyDesks, avgMinutes, deskState, isOvertime, roundWait, visitorViews, waitLabel, waitLevel } from './queue';
import type { Desk, Ticket, Visitor } from './types';

const T0 = Date.parse('2026-12-05T10:00:00Z');
const at = (min: number) => new Date(T0 + min * 60000).toISOString();
const desk = (id: number, booths = 1): Desk => ({ id, name: `d${id}`, category: 'finance', booths, active: true, sort: id });
let n = 0;
const tk = (p: Partial<Ticket> & Pick<Ticket, 'deskId' | 'status'>): Ticket => ({
  id: `t${String(++n).padStart(4, '0')}`, visitorId: `v${n}`, booth: null,
  queuedAt: at(0), queueAt: at(0), startedAt: null, endedAt: null, ...p,
});
const done = (deskId: number, mins: number, end = 100) =>
  tk({ deskId, status: 'done', booth: 1, startedAt: at(end - mins), endedAt: at(end) });

describe('avgMinutes', () => {
  it('実績が3件未満なら初期値20分', () => {
    expect(avgMinutes(1, [done(1, 10), done(1, 10)])).toEqual({ minutes: 20, samples: 2 });
  });
  it('3件以上なら実績の平均', () => {
    expect(avgMinutes(1, [done(1, 10, 10), done(1, 20, 40), done(1, 30, 80)]).minutes).toBe(20);
  });
  it('直近10件だけを使い、他の相談先は無視する', () => {
    const old = Array.from({ length: 5 }, (_, i) => done(1, 50, i)); // 古い50分×5
    const recent = Array.from({ length: 10 }, (_, i) => done(1, 10, 200 + i));
    expect(avgMinutes(1, [...old, ...recent, done(2, 59, 300)]).minutes).toBe(10);
  });
  it('極端な値は 5〜60分に丸める', () => {
    expect(avgMinutes(1, [done(1, 1, 10), done(1, 1, 20), done(1, 1, 30)]).minutes).toBe(5);
    expect(avgMinutes(1, [done(1, 90, 100), done(1, 90, 200), done(1, 90, 300)]).minutes).toBe(60);
  });
  it('開始時刻のない完了は数えない', () => {
    const bad = tk({ deskId: 1, status: 'done', endedAt: at(5) });
    expect(avgMinutes(1, [bad, bad, bad]).samples).toBe(0);
  });
});

describe('deskState', () => {
  it('空の相談先は待ち時間0', () => {
    const s = deskState(desk(1), [], T0);
    expect(s.newArrivalWait).toBe(0);
    expect(waitLabel(s.newArrivalWait)).toBe('すぐ');
  });
  it('1ブース: 相談中1人(開始直後)+待ち2人 → 順に約20分・40分、新規は60分', () => {
    const tickets = [
      tk({ deskId: 1, status: 'serving', booth: 1, startedAt: at(0) }),
      tk({ deskId: 1, status: 'waiting', queuedAt: at(1) }),
      tk({ deskId: 1, status: 'waiting', queuedAt: at(2) }),
    ];
    const s = deskState(desk(1), tickets, T0);
    expect(s.waiting.map((w) => Math.round(w.waitMinutes))).toEqual([20, 40]);
    expect(Math.round(s.newArrivalWait)).toBe(60);
  });
  it('経過時間を差し引く(15分経過なら残り5分)', () => {
    const tickets = [
      tk({ deskId: 1, status: 'serving', booth: 1, startedAt: at(0) }),
      tk({ deskId: 1, status: 'waiting', queuedAt: at(1) }),
    ];
    expect(Math.round(deskState(desk(1), tickets, T0 + 15 * 60000).waiting[0].waitMinutes)).toBe(5);
  });
  it('超過していても最低1分とみなし、負の待ち時間にならない', () => {
    const tickets = [
      tk({ deskId: 1, status: 'serving', booth: 1, startedAt: at(0) }),
      tk({ deskId: 1, status: 'waiting' }),
    ];
    expect(deskState(desk(1), tickets, T0 + 90 * 60000).waiting[0].waitMinutes).toBe(1);
  });
  it('2ブース: 待ち4人は2人ずつ並行して進む', () => {
    const tickets = [
      tk({ deskId: 1, status: 'serving', booth: 1, startedAt: at(0) }),
      tk({ deskId: 1, status: 'serving', booth: 2, startedAt: at(0) }),
      ...[1, 2, 3, 4].map((i) => tk({ deskId: 1, status: 'waiting', queuedAt: at(i) })),
    ];
    const s = deskState(desk(1, 2), tickets, T0);
    expect(s.waiting.map((w) => Math.round(w.waitMinutes))).toEqual([20, 20, 40, 40]);
  });
  it('待機順はサーバーが返した並び順のまま(離席で入れ替わった順番が反映される)', () => {
    const a = tk({ deskId: 1, status: 'waiting', queuedAt: at(3), queueAt: at(5) });   // 離席で後ろへ
    const b = tk({ deskId: 1, status: 'waiting', queuedAt: at(5), queueAt: at(3) });
    expect(deskState(desk(1), [b, a], T0).waiting.map((w) => w.ticket.id)).toEqual([b.id, a.id]);
  });
  it('付け替え済み・取消の札は待ちに数えない', () => {
    const t = [tk({ deskId: 1, status: 'moved' }), tk({ deskId: 1, status: 'cancelled' }), tk({ deskId: 1, status: 'waiting' })];
    expect(deskState(desk(1), t, T0).waiting).toHaveLength(1);
  });
});

describe('waitLevel(ボードの色分け)', () => {
  it('0人=なし、1人=薄黄、2〜4人=薄赤から段階的に濃く、5人以上=赤', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(waitLevel)).toEqual([0, 1, 2, 3, 4, 5, 5]);
  });
});

describe('isOvertime(相談時間の強調)', () => {
  it('20分以上で強調する', () => {
    expect([null, 0, 19, 20, 35].map(isOvertime)).toEqual([false, false, false, true, true]);
  });
});

describe('roundWait', () => {
  it('5分単位に切り上げる', () => {
    expect([0, 1, 5, 6, 20.1].map(roundWait)).toEqual([0, 5, 5, 10, 25]);
  });
});

describe('visitorViews', () => {
  const v = (id: string, status: 'in' | 'left' = 'in'): Visitor => ({
    id, no: 1, surname: 'x', status, wishes: [1, 2, 3], createdAt: at(0),
  });
  it('履歴・現在地・相談済み・未決定を判定する', () => {
    const t1 = tk({ deskId: 1, status: 'done', visitorId: 'a', queuedAt: at(0) });
    const t2 = tk({ deskId: 2, status: 'waiting', visitorId: 'a', queuedAt: at(30) });
    const t3 = tk({ deskId: 3, status: 'done', visitorId: 'b' });
    const [a, b, c] = visitorViews([v('a'), v('b'), v('c', 'left')], [t2, t1, t3]);
    expect(a.history.map((t) => t.deskId)).toEqual([1, 2]);
    expect(a.current?.deskId).toBe(2);
    expect(a.consultedDeskIds).toEqual([1]);
    expect(a.idle).toBe(false);
    expect(b.idle).toBe(true);     // 会場内でどこにも並んでいない
    expect(c.idle).toBe(false);    // 帰宅済みは未決定ではない
  });
  it('希望先のうち、相談済み・いま並んでいる先を除いたものが「未相談の希望先」', () => {
    const t1 = tk({ deskId: 1, status: 'done', visitorId: 'a' });
    const t2 = tk({ deskId: 2, status: 'waiting', visitorId: 'a', queuedAt: at(30) });
    const [a, , c] = visitorViews([v('a'), v('b'), v('c', 'left')], [t1, t2]);
    expect(a.wishesLeft).toEqual([3]);
    expect(c.wishesLeft).toEqual([]);   // 帰宅済みは対象外
  });
});

describe('readyDesks(ご案内待ち)', () => {
  it('ブースが空いていて待ちがいる相談先だけを返す', () => {
    const states = allDeskStates([desk(1), desk(2), desk(3)], [
      tk({ deskId: 1, status: 'waiting' }),
      tk({ deskId: 2, status: 'serving', startedAt: at(1), booth: 1 }),
      tk({ deskId: 2, status: 'waiting' }),
    ], T0 + 5 * 60000);
    expect(readyDesks(states).map((s) => s.desk.id)).toEqual([1]);
  });
});

describe('離席(away)', () => {
  it('待ち行列と待ち時間の計算に入らず、離席中として分けて返す', () => {
    const s = deskState(desk(1), [tk({ deskId: 1, status: 'away' }), tk({ deskId: 1, status: 'waiting' })], T0);
    expect(s.waiting).toHaveLength(1);
    expect(s.away).toHaveLength(1);
  });
  it('離席中の人は「行き先未決定」にならず、現在の待ち札は離席中', () => {
    const v: Visitor = { id: 'v1', no: 1, surname: '山田', status: 'in', wishes: [], createdAt: at(0) } as Visitor;
    const [view] = visitorViews([v], [tk({ deskId: 1, status: 'away', visitorId: 'v1' })]);
    expect(view.idle).toBe(false);
    expect(view.current?.status).toBe('away');
  });
});
