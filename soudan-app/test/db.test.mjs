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
  const ph = args.map((_, i) => `$${i + 1}`).join(', ');
  const r = await db.query(`select public.${fn}(${ph}) as r`, args);
  return r.rows[0].r;
}
const fails = (promise, code) => assert.rejects(promise, (e) => e.message.startsWith(code), `expected ${code}`);

const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
before(async () => {
  if (skip) return;
  db = new pg.Client({ connectionString: url });
  await db.connect();
  await db.query('drop schema if exists app cascade');
  await db.query(schema);
  await db.query('select app.init_passcodes($1, $2)', [OP, VW]);
});
after(async () => { if (db) await db.end(); });

const deskId = async (name) => (await db.query('select id from app.desk where name = $1', [name])).rows[0].id;
async function reg(surname = '山田', desk = 1, wishes = []) {
  const v = uuid(), t = uuid();
  const r = await rpc('register_visitor', [OP, v, t, surname, desk, wishes, '']);
  return { v, t, no: r.no };
}
const snap = (pass = OP) => rpc('snapshot', [pass]);
const queue = async (desk) => (await snap()).tickets.filter((t) => t.deskId === desk && t.status === 'waiting').map((t) => t.visitorId);

test('schema.sql は再実行できる(関数の定義が重複しない)', { skip }, async () => {
  await db.query(schema);
  const n = (await db.query(`select count(*)::int n from pg_proc where pronamespace = 'public'::regnamespace and proname = 'snapshot'`)).rows[0].n;
  assert.equal(n, 1);
  assert.ok((await snap()).desks.length === 16, '再実行で相談先が増えない');
});

test('相談先は区分つきで、公的→民間→金融の順。弁護士会・建築士事務所協会は①②に分かれる', { skip }, async () => {
  const d = (await snap()).desks;
  assert.deepEqual(d.map((x) => x.name).slice(0, 6),
    ['熊本弁護士会①', '熊本弁護士会②', '八代市', '建築士事務所協会①', '建築士事務所協会②', '賃貸住宅経営者協会']);
  assert.deepEqual([...new Set(d.map((x) => x.category))], ['public', 'private', 'finance']);
  assert.ok(d.every((x) => x.booths === 1));
});

test('パスコード: 不一致は拒否、閲覧者は更新できない', { skip }, async () => {
  await fails(rpc('snapshot', ['wrong']), 'E_AUTH');
  await fails(rpc('snapshot', ['']), 'E_AUTH');
  await fails(rpc('register_visitor', [VW, uuid(), uuid(), '山田', 1, [], '']), 'E_FORBIDDEN');
  await fails(rpc('purge_all', [VW, '全データを削除', false]), 'E_FORBIDDEN');
  await fails(rpc('get_log', [VW]), 'E_FORBIDDEN');
});

test('個人情報は苗字だけ。電話番号の列は存在せず、閲覧者にはメモも返らない', { skip }, async () => {
  const cols = (await db.query(`select column_name from information_schema.columns where table_schema = 'app' and table_name = 'visitor'`)).rows.map((r) => r.column_name);
  assert.ok(!cols.includes('phone'));
  const a = await reg('佐藤', 1);
  await rpc('update_visitor', [OP, a.v, '佐藤', '要配慮', [1]]);
  const o = (await snap(OP)).visitors.find((x) => x.id === a.v);
  const w = (await snap(VW)).visitors.find((x) => x.id === a.v);
  assert.equal(o.memo, '要配慮');
  assert.ok(!('memo' in w));
  assert.ok(!JSON.stringify(await snap(VW)).includes('要配慮'));
});

test('受付: 番号は連番、再送しても同じ番号で二重登録されない', { skip }, async () => {
  const v = uuid(), t = uuid();
  const r1 = await rpc('register_visitor', [OP, v, t, '鈴木', 2, [], '']);
  const r2 = await rpc('register_visitor', [OP, v, t, '鈴木', 2, [], '']);
  assert.equal(r1.no, r2.no);
  assert.equal(r2.already, true);
  assert.equal((await reg('高橋')).no, r1.no + 1);
});

test('受付: 希望先を複数記録でき、最初に並ぶ先も希望先に含まれる', { skip }, async () => {
  const a = await reg('希望', 3, [5, 7]);
  const v = (await snap()).visitors.find((x) => x.id === a.v);
  assert.deepEqual(v.wishes, [3, 5, 7]);
  await fails(rpc('register_visitor', [OP, uuid(), uuid(), '不正', 1, [999], '']), 'E_INPUT');
  // 希望なしで受付だけ(最初の相談先を決めない)もできる
  const r = await rpc('register_visitor', [OP, uuid(), uuid(), '先未定', null, [], '']);
  assert.ok(r.no > 0);
});

test('入力チェック: 苗字・メモ・休止中の相談先', { skip }, async () => {
  const args = (s, d, m = '') => [OP, uuid(), uuid(), s, d, [], m];
  await fails(rpc('register_visitor', args('', 1)), 'E_INPUT');
  await fails(rpc('register_visitor', args('山'.repeat(21), 1)), 'E_INPUT');
  await fails(rpc('register_visitor', args('山田', 1, 'あ'.repeat(61))), 'E_INPUT');
  await db.query('update app.desk set active = false where id = 3');
  await fails(rpc('register_visitor', args('山田', 3)), 'E_DESK_CLOSED');
  await db.query('update app.desk set active = true where id = 3');
});

test('次の相談先に並ぶと最後尾に入り、希望先にも加わる。同時に2つの行列には並べない', { skip }, async () => {
  const a = await reg('A1', 4), b = await reg('B1', 4);
  await rpc('start_ticket', [OP, a.t, null]);
  await rpc('finish_ticket', [OP, a.t]);
  await fails(rpc('enqueue', [OP, uuid(), b.v, 5]), 'E_ALREADY_ACTIVE');   // b は4番で待機中
  const t2 = uuid();
  await rpc('enqueue', [OP, t2, a.v, 4]);
  assert.deepEqual(await queue(4), [b.v, a.v]);
  assert.equal((await rpc('enqueue', [OP, t2, a.v, 4])).already, true);    // 再送は無視
  await rpc('cancel_ticket', [OP, t2]);
  await rpc('enqueue', [OP, uuid(), a.v, 11]);                              // 希望になかった先にも並べる
  assert.ok((await snap()).visitors.find((x) => x.id === a.v).wishes.includes(11));
});

test('離席: 呼ばれた人と次の人の順番を入れ替える。再送しても元に戻らない', { skip }, async () => {
  const d = await deskId('熊本信用金庫');
  const [a, b, c] = [await reg('S1', d), await reg('S2', d), await reg('S3', d)];
  assert.deepEqual(await queue(d), [a.v, b.v, c.v]);
  await rpc('swap_tickets', [OP, a.t, b.t]);                                // a が離席 → a と b を入れ替え
  assert.deepEqual(await queue(d), [b.v, a.v, c.v]);
  assert.equal((await rpc('swap_tickets', [OP, a.t, b.t])).already, true);  // 再送は何もしない
  assert.deepEqual(await queue(d), [b.v, a.v, c.v]);
  await rpc('start_ticket', [OP, b.t, null]);                               // b を先に案内
  await fails(rpc('swap_tickets', [OP, a.t, b.t]), 'E_BAD_STATE');          // b は相談中なので入れ替え不可
  // 履歴上の「並んだ時刻」は入れ替えても変わらない
  const t = (await snap()).tickets.find((x) => x.id === a.t);
  assert.ok(Date.parse(t.queuedAt) <= Date.parse(t.queueAt));
});

test('離席の入れ替え: 別々の相談先の札は入れ替えられない', { skip }, async () => {
  const [a, b] = [await reg('X1', 12), await reg('X2', 13)];
  await fails(rpc('swap_tickets', [OP, a.t, b.t]), 'E_BAD_STATE');
});

test('付け替え: 新しい行列の最後尾に入り、元の札は付け替え済みになる。再送は無視', { skip }, async () => {
  const [from, to] = [await deskId('肥後銀行'), await deskId('熊本銀行')];
  const [m1, m2] = [await reg('M1', to), await reg('M2', from)];
  const nt = uuid();
  await rpc('move_ticket', [OP, m2.t, nt, to]);
  assert.deepEqual(await queue(to), [m1.v, m2.v]);
  const s = await snap();
  assert.equal(s.tickets.find((x) => x.id === m2.t).status, 'moved');
  assert.equal((await rpc('move_ticket', [OP, m2.t, nt, to])).already, true);
  await fails(rpc('move_ticket', [OP, nt, uuid(), to]), 'E_INPUT');          // 同じ相談先へは付け替えられない
  await rpc('start_ticket', [OP, nt, null]);
  await fails(rpc('move_ticket', [OP, nt, uuid(), from]), 'E_BAD_STATE');   // 相談中は付け替え不可
  await fails(rpc('cancel_ticket', [OP, m2.t]), 'E_BAD_STATE');             // 付け替え済みは取り消せない
});

test('相談先ごとに1人ずつ。同時に開始しても1ブースで2人が相談中にならない', { skip }, async () => {
  const d = await deskId('八代市');
  const [x, y] = [await reg('Y1', d), await reg('Y2', d)];
  const other = new pg.Client({ connectionString: url });
  await other.connect();
  const call = (c, t) => c.query('select public.start_ticket($1,$2,null)', [OP, t]).then(() => 'ok', (e) => e.message.slice(0, 10));
  const res = await Promise.all([call(db, x.t), call(other, y.t)]);
  await other.end();
  assert.deepEqual(res.sort(), ['E_NO_BOOTH', 'ok']);
  assert.equal((await rpc('start_ticket', [OP, x.t, null])).already ?? true, true);
});

test('終了・取消・帰宅の再送は成功扱い、帰宅後は並べない', { skip }, async () => {
  const a = await reg('D1', 9);
  await fails(rpc('finish_ticket', [OP, a.t]), 'E_BAD_STATE');
  await rpc('start_ticket', [OP, a.t, null]);
  await rpc('finish_ticket', [OP, a.t]);
  assert.equal((await rpc('finish_ticket', [OP, a.t])).already, true);
  await fails(rpc('cancel_ticket', [OP, a.t]), 'E_BAD_STATE');
  await rpc('leave_visitor', [OP, a.v]);
  assert.equal((await rpc('leave_visitor', [OP, a.v])).already, true);
  await fails(rpc('enqueue', [OP, uuid(), a.v, 9]), 'E_VISITOR_LEFT');
  assert.equal((await snap()).visitors.find((x) => x.id === a.v).status, 'left');
});

test('帰宅: 相談中は不可、待機中の札は自動で取り消され、帰宅は取り消せる', { skip }, async () => {
  const a = await reg('E1', 10);
  await rpc('start_ticket', [OP, a.t, null]);
  await fails(rpc('leave_visitor', [OP, a.v]), 'E_SERVING');
  await rpc('revert_ticket', [OP, a.t]);
  await rpc('leave_visitor', [OP, a.v]);
  assert.equal((await snap()).tickets.find((x) => x.id === a.t).status, 'cancelled');
  await rpc('reopen_visitor', [OP, a.v]);
  await rpc('revert_ticket', [OP, a.t]);
  assert.equal((await snap()).tickets.find((x) => x.id === a.t).status, 'waiting');
});

test('操作を戻す: 終了→相談中。別の人が相談中なら戻せない', { skip }, async () => {
  const d = await deskId('JA八代');
  const [a, b] = [await reg('F1', d), await reg('F2', d)];
  await rpc('start_ticket', [OP, a.t, null]);
  await rpc('finish_ticket', [OP, a.t]);
  await rpc('revert_ticket', [OP, a.t]);
  assert.equal((await snap()).tickets.find((x) => x.id === a.t).status, 'serving');
  await rpc('finish_ticket', [OP, a.t]);
  await rpc('start_ticket', [OP, b.t, null]);
  await fails(rpc('revert_ticket', [OP, a.t]), 'E_NO_BOOTH');
});

test('相談先の追加・変更・区分、パスコード変更', { skip }, async () => {
  const r = await rpc('upsert_desk', [OP, null, '臨時窓口', 'public', true, 999]);
  await rpc('upsert_desk', [OP, r.id, '臨時窓口2', 'private', false, 998]);
  const d = (await snap()).desks.find((x) => x.id === r.id);
  assert.deepEqual([d.name, d.category, d.active, d.sort], ['臨時窓口2', 'private', false, 998]);
  await fails(rpc('upsert_desk', [OP, null, '', 'public', true, 0]), 'E_INPUT');
  await fails(rpc('upsert_desk', [OP, null, 'x', 'bad', true, 0]), 'E_INPUT');
  await fails(rpc('set_passcodes', [OP, 'short', 'another-long-1']), 'E_WEAK');
  await fails(rpc('set_passcodes', [OP, 'same-pass-123', 'same-pass-123']), 'E_SAME');
  await rpc('set_passcodes', [OP, OP + 'x', VW + 'x']);
  await fails(rpc('snapshot', [OP]), 'E_AUTH');
  await rpc('set_passcodes', [OP + 'x', OP, VW]);
  assert.equal((await snap()).role, 'operator');
});

test('操作ログに苗字が入らない', { skip }, async () => {
  await reg('個人情報テスト', 1);
  const log = JSON.stringify(await rpc('get_log', [OP]));
  assert.ok(log.length > 10);
  assert.ok(!log.includes('個人情報テスト'));
});

test('離席: 待ち行列から外れ、次の人が先に案内され、戻ると離席前の順番(残りの先頭)に戻る。二重実行・二重並びは拒否', { skip }, async () => {
  const d = await deskId('肥後銀行');
  const a = await reg('離席A', d), b = await reg('離席B', d), c = await reg('離席C', d);
  const tickets = async () => (await snap()).tickets;
  await rpc('away_ticket', [OP, a.t]);
  assert.equal((await rpc('away_ticket', [OP, a.t])).already, true, '二重実行は成功扱い');
  assert.deepEqual((await queue(d)).filter((v) => [a.v, b.v, c.v].includes(v)), [b.v, c.v], '離席中は待ち行列に入らない');
  // 離席中でも「どこにも並んでいない」扱いではなく、別の先に二重に並べない
  await assert.rejects(rpc('enqueue', [OP, uuid(), a.v, d]), (e) => e.message.startsWith('E_ALREADY_ACTIVE'));
  await fails(rpc('start_ticket', [OP, a.t]), 'E_BAD_STATE');
  await rpc('start_ticket', [OP, b.t]);                       // 次の人を先に案内
  await rpc('resume_ticket', [OP, a.t]);
  assert.equal((await rpc('resume_ticket', [OP, a.t])).already, true);
  assert.deepEqual((await queue(d)).filter((v) => [a.v, c.v].includes(v)), [a.v, c.v], '戻ると離席前の順番(Cより前)');
  assert.equal((await tickets()).find((t) => t.id === a.t).status, 'waiting');
  await rpc('away_ticket', [OP, c.t]);
  await rpc('leave_visitor', [OP, c.v]);                      // 離席中の人が帰宅 → 取消になる
  assert.equal((await tickets()).find((t) => t.id === c.t).status, 'cancelled');
  await fails(rpc('away_ticket', [VW, a.t]), 'E_FORBIDDEN');
  await fails(rpc('away_ticket', [OP, b.t]), 'E_BAD_STATE');  // 相談中は離席にできない
});

test('離席: 誰も先に案内されなければ、戻ると元の位置(真ん中)に戻る', { skip }, async () => {
  const d = await deskId('熊本銀行');
  const a = await reg('順A', d), b = await reg('順B', d), c = await reg('順C', d);
  const mine = async () => (await queue(d)).filter((v) => [a.v, b.v, c.v].includes(v));
  await rpc('away_ticket', [OP, b.t]);
  assert.deepEqual(await mine(), [a.v, c.v]);
  await rpc('resume_ticket', [OP, b.t]);
  assert.deepEqual(await mine(), [a.v, b.v, c.v]);
});

test('全削除: 確認文字が必要。相談者・待ち札・ログが消え、相談先は残り、パスコードを無効化できる', { skip }, async () => {
  await fails(rpc('purge_all', [OP, 'delete', false]), 'E_CONFIRM');
  const r = await rpc('purge_all', [OP, '全データを削除', false]);
  assert.ok(r.deletedVisitors > 0);
  for (const t of ['visitor', 'ticket', 'op_log']) {
    assert.equal((await db.query(`select count(*)::int n from app.${t}`)).rows[0].n, 0);
  }
  assert.ok((await db.query('select count(*)::int n from app.desk')).rows[0].n >= 16);
  assert.equal((await snap()).role, 'operator');                          // パスコードは残る
  await rpc('purge_all', [OP, '全データを削除', true]);
  await fails(rpc('snapshot', [OP]), 'E_AUTH');                           // パスコード失効
  await fails(rpc('snapshot', [VW]), 'E_AUTH');
});
