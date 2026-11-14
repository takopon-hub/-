// DB テスト: テスト用 Postgres に schema.sql を流して RPC の振る舞いを確かめる。
//   DATABASE_URL=postgres://postgres@localhost:5432/soudan_test npm run test:db
// DATABASE_URL が無ければスキップする。テストは app スキーマを作り直すため、
// 誤って本番DBを消さないよう、DB 名が「_test」で終わらない場合は実行を拒否する。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID as uuid } from 'node:crypto';
import pg from 'pg';

const url = process.env.DATABASE_URL;
const skip = !url;
if (url && !/_test(\?.*)?$/.test(url)) {
  throw new Error('DATABASE_URL のDB名は「_test」で終わる必要があります(本番DBの誤削除防止)');
}
const OP = 'operator-pass-1';
const VW = 'viewer-pass-22';
let db;

async function rpc(fn, args = []) {
  // PostgREST の rpc 呼び出し相当: select public.fn(...)
  const ph = args.map((_, i) => `$${i + 1}`).join(', ');
  const r = await db.query(`select public.${fn}(${ph}) as r`, args);
  return r.rows[0].r;
}
const fails = (promise, code) => assert.rejects(promise, (e) => e.message.startsWith(code), `expected ${code}`);

before(async () => {
  if (skip) return;
  db = new pg.Client({ connectionString: url });
  await db.connect();
  await db.query('drop schema if exists app cascade');
  await db.query(readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
  await db.query('select app.init_passcodes($1, $2)', [OP, VW]);
});
after(async () => { if (db) await db.end(); });

async function reg(surname = '山田', desk = 1, phone = '090-1234-5678') {
  const v = uuid(), t = uuid();
  const r = await rpc('register_visitor', [OP, v, t, surname, phone, desk, '']);
  return { v, t, no: r.no };
}
const snap = (pass = OP) => rpc('snapshot', [pass]);
const deskId = async (name) => (await db.query('select id from app.desk where name = $1', [name])).rows[0].id;

test('パスコード: 不一致は拒否、閲覧者は更新できない', { skip }, async () => {
  await fails(rpc('snapshot', ['wrong']), 'E_AUTH');
  await fails(rpc('snapshot', ['']), 'E_AUTH');
  await fails(rpc('register_visitor', [VW, uuid(), uuid(), '山田', '09012345678', 1, '']), 'E_FORBIDDEN');
  await fails(rpc('purge_all', [VW, '全データを削除', false]), 'E_FORBIDDEN');
  await fails(rpc('get_log', [VW]), 'E_FORBIDDEN');
});

test('閲覧者のスナップショットに電話番号・メモが含まれない', { skip }, async () => {
  const a = await reg('佐藤', 1, '080-9999-0000');
  const op = await snap(OP);
  const vw = await snap(VW);
  assert.equal(op.role, 'operator');
  assert.equal(vw.role, 'viewer');
  const o = op.visitors.find((x) => x.id === a.v);
  const w = vw.visitors.find((x) => x.id === a.v);
  assert.equal(o.phone, '08099990000');
  assert.equal(w.surname, '佐藤');
  assert.ok(!('phone' in w) && !('memo' in w));
  assert.ok(!JSON.stringify(vw).includes('08099990000'));
});

test('受付: 番号は連番、再送しても同じ番号で二重登録されない', { skip }, async () => {
  const v = uuid(), t = uuid();
  const r1 = await rpc('register_visitor', [OP, v, t, '鈴木', '09011112222', 2, '']);
  const r2 = await rpc('register_visitor', [OP, v, t, '鈴木', '09011112222', 2, '']);
  assert.equal(r1.no, r2.no);
  assert.equal(r2.already, true);
  const next = await reg('高橋');
  assert.equal(next.no, r1.no + 1);
});

test('入力チェック: 電話番号・苗字・メモ・休止中の相談先', { skip }, async () => {
  const args = (s, p, d, m = '') => [OP, uuid(), uuid(), s, p, d, m];
  await fails(rpc('register_visitor', args('山田', '123', 1)), 'E_INPUT');
  await fails(rpc('register_visitor', args('', '09011112222', 1)), 'E_INPUT');
  await fails(rpc('register_visitor', args('山田', '09011112222', 1, 'あ'.repeat(61))), 'E_INPUT');
  await db.query('update app.desk set active = false where id = 3');
  await fails(rpc('register_visitor', args('山田', '09011112222', 3)), 'E_DESK_CLOSED');
  await db.query('update app.desk set active = true where id = 3');
});

test('並び直しは最後尾に入り、同時に2つの行列には並べない', { skip }, async () => {
  const a = await reg('A1', 4), b = await reg('B1', 4);
  await rpc('start_ticket', [OP, a.t, null]);
  await rpc('finish_ticket', [OP, a.t]);
  await fails(rpc('enqueue', [OP, uuid(), b.v, 5]), 'E_ALREADY_ACTIVE'); // b は4番で待機中
  const t2 = uuid();
  await rpc('enqueue', [OP, t2, a.v, 4]);   // a は4番へ再度並ぶ → b の後ろ
  const s = await snap();
  const q = s.tickets.filter((t) => t.deskId === 4 && t.status === 'waiting').map((t) => t.visitorId);
  assert.deepEqual(q, [b.v, a.v]);
  assert.equal((await rpc('enqueue', [OP, t2, a.v, 4])).already, true);   // 再送は無視
});

test('ブース: 同時対応数を超えて開始できない。2ブースなら2人まで', { skip }, async () => {
  const d1 = await deskId('肥後銀行');      // 1ブース
  const d2 = await deskId('熊本弁護士会');  // 2ブース
  const [x, y] = [await reg('X', d1), await reg('Y', d1)];
  await rpc('start_ticket', [OP, x.t, null]);
  await fails(rpc('start_ticket', [OP, y.t, null]), 'E_NO_BOOTH');
  const [p, q, r] = [await reg('P', d2), await reg('Q', d2), await reg('R', d2)];
  assert.equal((await rpc('start_ticket', [OP, p.t, null])).booth, 1);
  assert.equal((await rpc('start_ticket', [OP, q.t, null])).booth, 2);
  await fails(rpc('start_ticket', [OP, r.t, null]), 'E_NO_BOOTH');
  await rpc('finish_ticket', [OP, p.t]);
  assert.equal((await rpc('start_ticket', [OP, r.t, null])).booth, 1);       // 空いたブースを再利用
  assert.equal((await rpc('start_ticket', [OP, r.t, null])).already, true);  // 再送
});

test('同時に開始しても、1ブースで2人が相談中にならない', { skip }, async () => {
  const d = await deskId('八代市');
  const [a, b] = [await reg('C1', d), await reg('C2', d)];
  const other = new pg.Client({ connectionString: url });
  await other.connect();
  const call = (c, t) => c.query('select public.start_ticket($1,$2,null)', [OP, t]).then(() => 'ok', (e) => e.message.slice(0, 10));
  const res = await Promise.all([call(db, a.t), call(other, b.t)]);
  await other.end();
  assert.deepEqual(res.sort(), ['E_NO_BOOTH', 'ok']);
});

test('終了・取消・帰宅の再送は成功扱い、取消後の操作は拒否', { skip }, async () => {
  const a = await reg('D1', 9);
  await fails(rpc('finish_ticket', [OP, a.t]), 'E_BAD_STATE');   // 待機中は終了できない
  await rpc('start_ticket', [OP, a.t, null]);
  await rpc('finish_ticket', [OP, a.t]);
  assert.equal((await rpc('finish_ticket', [OP, a.t])).already, true);
  await fails(rpc('cancel_ticket', [OP, a.t]), 'E_BAD_STATE');   // 終了済みは取消不可
  await rpc('leave_visitor', [OP, a.v, 'carryover']);
  assert.equal((await rpc('leave_visitor', [OP, a.v, 'carryover'])).already, true);
  await fails(rpc('enqueue', [OP, uuid(), a.v, 9]), 'E_VISITOR_LEFT');
  const v = (await snap()).visitors.find((x) => x.id === a.v);
  assert.deepEqual([v.status, v.leaveKind], ['left', 'carryover']);
});

test('帰宅: 相談中は不可、待機中の札は自動で取り消される', { skip }, async () => {
  const a = await reg('E1', 10);
  await rpc('start_ticket', [OP, a.t, null]);
  await fails(rpc('leave_visitor', [OP, a.v, 'dropped']), 'E_SERVING');
  await rpc('revert_ticket', [OP, a.t]);                           // 相談中 → 待機中
  await rpc('leave_visitor', [OP, a.v, 'dropped']);
  assert.equal((await snap()).tickets.find((x) => x.id === a.t).status, 'cancelled');
  await rpc('reopen_visitor', [OP, a.v]);
  await rpc('revert_ticket', [OP, a.t]);                           // 取消 → 待機中
  assert.equal((await snap()).tickets.find((x) => x.id === a.t).status, 'waiting');
});

test('操作を戻す: 終了→相談中、元のブースが埋まっていれば別の空きブース', { skip }, async () => {
  const d2 = await deskId('建築士事務所協会');
  const [a, b] = [await reg('F1', d2), await reg('F2', d2)];
  await rpc('start_ticket', [OP, a.t, null]);   // ブース1
  await rpc('finish_ticket', [OP, a.t]);
  await rpc('start_ticket', [OP, b.t, null]);   // 空いたブース1を使用
  await rpc('revert_ticket', [OP, a.t]);        // a は元のブース1が埋まっているのでブース2へ
  const t = (await snap()).tickets.find((x) => x.id === a.t);
  assert.deepEqual([t.status, t.booth], ['serving', 2]);
});

test('相談先の追加・変更と、パスコード変更', { skip }, async () => {
  const r = await rpc('upsert_desk', [OP, null, '臨時窓口', 1, true, 999]);
  assert.ok(r.id > 14);
  await rpc('upsert_desk', [OP, r.id, '臨時窓口', 2, false, 999]);
  const d = (await snap()).desks.find((x) => x.id === r.id);
  assert.deepEqual([d.booths, d.active], [2, false]);
  await fails(rpc('upsert_desk', [OP, null, '', 1, true, 0]), 'E_INPUT');
  await fails(rpc('set_passcodes', [OP, 'short', 'another-long-1']), 'E_WEAK');
  await fails(rpc('set_passcodes', [OP, 'same-pass-123', 'same-pass-123']), 'E_SAME');
  await rpc('set_passcodes', [OP, OP + 'x', VW + 'x']);
  await fails(rpc('snapshot', [OP]), 'E_AUTH');
  await rpc('set_passcodes', [OP + 'x', OP, VW]);
  assert.equal((await snap()).role, 'operator');
});

test('操作ログに氏名・電話番号が入らない', { skip }, async () => {
  await reg('個人情報テスト', 1, '070-5555-6666');
  const log = JSON.stringify(await rpc('get_log', [OP]));
  assert.ok(log.length > 10);
  assert.ok(!log.includes('個人情報テスト') && !log.includes('07055556666'));
});

test('全削除: 確認文字が必要。個人情報とログが消え、相談先は残り、パスコードを無効化できる', { skip }, async () => {
  await fails(rpc('purge_all', [OP, 'delete', false]), 'E_CONFIRM');
  const r = await rpc('purge_all', [OP, '全データを削除', true]);
  assert.ok(r.deletedVisitors > 0);
  for (const t of ['visitor', 'ticket', 'op_log']) {
    assert.equal((await db.query(`select count(*)::int n from app.${t}`)).rows[0].n, 0);
  }
  assert.ok((await db.query('select count(*)::int n from app.desk')).rows[0].n >= 14);
  await fails(rpc('snapshot', [OP]), 'E_AUTH');   // パスコード失効
  await fails(rpc('snapshot', [VW]), 'E_AUTH');
});
