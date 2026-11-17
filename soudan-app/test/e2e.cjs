// 画面の通し確認(Playwright)。開発用サーバー(vite と dev/api-shim.mjs)と、
// 空の開発用DB(パスコード operator-demo-1 / viewer-demo-22)が起動している状態で実行する。
//   BASE=http://localhost:5173 SHOTS=/path/to/dir DATABASE_URL=postgres://.../soudan_dev node test/e2e.cjs
// DATABASE_URL を渡すと、20分超の強調表示と全削除の結果をDBで確かめる(開発用DB専用。_dev で終わること)。
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const BASE = process.env.BASE ?? 'http://localhost:5173';
const SHOTS = process.env.SHOTS;
const DBURL = process.env.DATABASE_URL;
if (DBURL && !/_dev(\?.*)?$/.test(DBURL)) throw new Error('DATABASE_URL は開発用DB(名前が _dev で終わる)にしてください');
const OP = 'operator-demo-1';
const VW = 'viewer-demo-22';
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };

async function login(page, pass) {
  await page.goto(BASE);
  await page.fill('#pass', pass);
  await page.click('button:has-text("ログイン")');
}

(async () => {
  const pg = DBURL ? new (require('pg').Client)({ connectionString: DBURL }) : null;
  if (pg) await pg.connect();
  const browser = await chromium.launch();
  const phone = { ...devices['iPhone 13'], locale: 'ja-JP' };
  const opCtx = await browser.newContext(phone);
  const vwCtx = await browser.newContext(phone);
  const op = await opCtx.newPage();
  const vw = await vwCtx.newPage();
  const errors = [];
  for (const p of [op, vw]) p.on('pageerror', (e) => errors.push(e.message));
  op.on('dialog', (d) => d.accept());

  // --- ログイン
  await login(vw, 'wrong-pass-123');
  await vw.waitForSelector('text=パスコードが違います');
  await vw.fill('#pass', VW);
  await vw.click('button:has-text("ログイン")');
  await vw.waitForSelector('text=閲覧のみ');
  assert.equal(await vw.locator('nav.tabs a', { hasText: '受付' }).count(), 0, '閲覧者に受付タブが出ない');
  assert.equal(await vw.locator('nav.tabs a', { hasText: '管理' }).count(), 0, '閲覧者に管理タブが出ない');
  await login(op, OP);
  await op.waitForSelector('text=操作者');

  // --- 受付: 苗字・最初の相談先・希望先。電話番号の入力欄はない
  async function register(surname, firstDesk, wishDesks = []) {
    await op.click('nav.tabs a:has-text("受付")');
    const next = op.locator('button:has-text("次の方を受付する")');
    if (await next.count()) await next.click();
    assert.equal(await op.locator('#phone').count(), 0, '電話番号の入力欄がない');
    await op.fill('#surname', surname);
    await op.click(`label.radio:has-text("${firstDesk}")`);
    for (const w of wishDesks) await op.click(`button.chip:text-is("${w}")`);
    assert.equal(await op.locator('button:has-text("受付する")').isDisabled(), true, '同意前は受付できない');
    await op.check('.check input');
    await op.click('button:has-text("受付する")');
    await op.waitForSelector('.big-no');
    return (await op.locator('.big-no').innerText()).trim();
  }
  const n1 = await register('山田', '肥後銀行', ['熊本銀行', '熊本弁護士会①']);
  assert.equal(n1, '001');
  for (const s of ['佐藤', '鈴木', '田中', '高橋']) await register(s, '肥後銀行');
  await register('中村', '熊本弁護士会①');
  await op.click('nav.tabs a:has-text("受付")');
  await op.click('button:has-text("次の方を受付する")');
  await shot(op, '01-register-form');

  // --- ボード: 区分の順序と色分け、待ち人数の段階色
  await op.click('nav.tabs a:has-text("ボード")');
  await op.waitForSelector('h2.group-title');
  const groups = await op.locator('h2.group-title').allInnerTexts();
  assert.deepEqual(groups, ['公的機関等', '民間協会', '金融機関']);
  const names = await op.locator('article.desk h3').allInnerTexts();
  assert.deepEqual(names.slice(0, 6), ['熊本弁護士会①', '熊本弁護士会②', '八代市', '建築士事務所協会①', '建築士事務所協会②', '賃貸住宅経営者協会']);
  const cls = (n) => op.locator(`article.desk:has(h3:text-is("${n}"))`).getAttribute('class');
  assert.match(await cls('熊本弁護士会①'), /\blv1\b/, '1人待ちは薄黄');
  assert.match(await cls('熊本弁護士会②'), /\blv0\b/, '待ちなしは色なし');
  assert.match(await cls('肥後銀行'), /\blv5\b/, '5人待ちは赤');
  assert.match(await cls('熊本弁護士会①'), /cat-public/);
  assert.match(await cls('賃貸住宅経営者協会'), /cat-private/);
  assert.match(await cls('肥後銀行'), /cat-finance/);
  await vw.waitForSelector('article.desk.lv5:has(h3:text-is("肥後銀行"))', { timeout: 8000 });
  await shot(vw, '02-board-viewer');

  // --- ボード先頭の注意表示: 空いているブースに待ちがいる相談先が並ぶ
  await op.waitForSelector('.guide-box');
  assert.match(await op.locator('.guide-box').innerText(), /肥後銀行 が空いています/);
  assert.match(await cls('肥後銀行'), /\bready\b/);
  await shot(op, '02b-board-guide');

  // --- 相談先画面: 先頭の山田が不在 → 次の佐藤と入れ替え
  await op.click('article.desk:has(h3:text-is("肥後銀行")) h3');
  await op.waitForSelector('ol.numbered li');
  const order = () => op.locator('ol.numbered li .name').evaluateAll((els) => els.map((e) => e.childNodes[0].textContent.trim()));
  assert.deepEqual((await order()).slice(0, 3), ['001 山田さん', '002 佐藤さん', '003 鈴木さん']);
  await op.locator('ol.numbered li').first().locator('button:has-text("不在 → 次の人と入替")').click();
  await op.waitForFunction(() => document.querySelector('ol.numbered li .name')?.textContent?.startsWith('002'));
  assert.deepEqual((await order()).slice(0, 3), ['002 佐藤さん', '001 山田さん', '003 鈴木さん']);
  await shot(op, '03-desk-swapped');

  // --- 付け替え: 鈴木(3番目)を熊本信用金庫の最後尾へ
  await op.locator('ol.numbered li', { hasText: '003 鈴木' }).locator('button:has-text("別の相談先へ付け替え")').click();
  await op.waitForSelector('[role=dialog]');
  await shot(op, '04-move-sheet');
  await op.click('[role=dialog] button.row-btn:has-text("熊本信用金庫")');
  await op.waitForFunction(() => ![...document.querySelectorAll('ol.numbered li .name')].some((e) => e.textContent.includes('003')));

  // --- 佐藤を開始 → 20分超の強調(DBで開始時刻を25分前にずらす)
  await op.locator('ol.numbered li').first().locator('button:has-text("案内して開始")').click();
  await op.waitForSelector('.elapsed');
  assert.equal(await op.locator('.elapsed.over').count(), 0, '開始直後は強調しない');
  if (pg) {
    await pg.query(`update app.ticket set started_at = now() - interval '25 minutes' where status = 'serving'`);
    await op.waitForSelector('.elapsed.over', { timeout: 8000 });
    assert.match(await op.locator('.elapsed.over').first().innerText(), /2[0-9]\s*分経過/);
    await shot(op, '05-desk-overtime');
  }

  // --- 終了 → 次の行き先: 佐藤は希望なし → 弁護士会①へ
  await op.click('button:has-text("終了")');
  await op.waitForSelector('[role=dialog]');
  assert.equal(await op.locator('[role=dialog] h3:has-text("受付時に希望していた")').count(), 0);
  await op.click('[role=dialog] button.row-btn:has-text("熊本弁護士会①")');

  // --- 一連の流れ: 行き先を決めたあと、続けて次の人(山田)の案内シートが出る → そこから開始
  await op.waitForSelector('[role=dialog]:has-text("続けて、次の方をご案内")');
  assert.match(await op.locator('[role=dialog]').innerText(), /001 山田さん/);
  await shot(op, '05b-guide-sheet');
  await op.click('[role=dialog] button:has-text("案内して開始")');
  await op.waitForSelector('ul.list li:has-text("001 山田")');
  await op.click('button:has-text("終了")');
  await op.waitForSelector('[role=dialog] h3:has-text("受付時に希望していた")');
  const wished = await op.locator('[role=dialog] ul.list').first().locator('li strong').allInnerTexts();
  assert.deepEqual(wished.sort(), ['熊本弁護士会①', '熊本銀行'].sort());
  assert.equal(await op.locator('[role=dialog] .badge:has-text("希望")').count(), 2);
  await shot(op, '06-next-sheet');
  await op.click('[role=dialog] button.row-btn:has-text("熊本銀行")');
  await op.click('[role=dialog] button:has-text("あとで")');

  // --- 閲覧者: メモ・操作ボタンなし、希望先は見える
  await vw.click('nav.tabs a:has-text("相談者")');
  await vw.click('a.row-btn:has-text("山田")');
  await vw.waitForSelector('text=メモは操作者のみ表示されます');
  assert.equal(await vw.locator('button:has-text("帰宅")').count(), 0);
  const vwText = await vw.locator('main').innerText();
  assert.ok(vwText.includes('熊本銀行') && !/携帯|電話/.test(vwText), '閲覧者に電話・携帯の表示がない');
  await shot(vw, '07-visitor-viewer');

  // --- 通信断: オフラインで「帰宅」→ 保存され、復帰後に自動送信される
  await op.click('nav.tabs a:has-text("相談者")');
  await op.click('a.row-btn:has-text("田中")');
  await opCtx.setOffline(true);
  await op.click('button:text-is("帰宅")');
  await op.waitForSelector('.banner.warn:has-text("未送信")');
  await op.waitForSelector('.banner.error:has-text("通信できません")', { timeout: 8000 });
  await shot(op, '08-offline');
  await opCtx.setOffline(false);
  await op.waitForSelector('.banner.warn', { state: 'detached', timeout: 12000 });
  await op.waitForSelector('.badge:text-is("帰宅")');

  // --- 全削除(Supabaseと同様に WHERE なしの全件削除をAPI経由で呼ぶ): 確認文字がないと押せない
  await op.click('nav.tabs a:has-text("管理")');
  await shot(op, '09-admin');
  const purge = op.locator('button:has-text("すべて削除する")');
  assert.equal(await purge.isDisabled(), true);
  await op.fill('#purge', '全データを削除');
  await purge.click();
  await op.waitForSelector('#pass');
  await vw.waitForSelector('#pass', { timeout: 8000 });
  if (pg) {
    for (const t of ['visitor', 'ticket', 'op_log']) {
      assert.equal((await pg.query(`select count(*)::int n from app.${t}`)).rows[0].n, 0, `${t} が空になる`);
    }
  }

  assert.deepEqual(errors, [], 'ブラウザ上のエラーなし');
  await browser.close();
  if (pg) await pg.end();
  console.log('E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
