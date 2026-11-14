// 画面の通し確認(Playwright)。開発用サーバー(vite と dev/api-shim.mjs)と、
// 空の開発用DB(パスコード operator-demo-1 / viewer-demo-22)が起動している状態で実行する。
//   BASE=http://localhost:5173 SHOTS=/path/to/dir node test/e2e.cjs
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const BASE = process.env.BASE ?? 'http://localhost:5173';
const SHOTS = process.env.SHOTS;
const OP = 'operator-demo-1';
const VW = 'viewer-demo-22';
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };

async function login(page, pass) {
  await page.goto(BASE);
  await page.fill('#pass', pass);
  await page.click('button:has-text("ログイン")');
}

(async () => {
  const browser = await chromium.launch();
  const phone = { ...devices['iPhone 13'], locale: 'ja-JP' };
  const opCtx = await browser.newContext(phone);
  const vwCtx = await browser.newContext(phone);
  const op = await opCtx.newPage();
  const vw = await vwCtx.newPage();
  const errors = [];
  for (const p of [op, vw]) p.on('pageerror', (e) => errors.push(e.message));

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

  // --- 受付(操作者): 苗字・電話・相談先・同意
  async function register(surname, phoneNo, deskName) {
    await op.click('nav.tabs a:has-text("受付")');
    const next = op.locator('button:has-text("次の方を受付する")');
    if (await next.count()) await next.click();
    await op.fill('#surname', surname);
    await op.fill('#phone', phoneNo);
    await op.click(`label.radio:has-text("${deskName}")`);
    assert.equal(await op.locator('button:has-text("受付する")').isDisabled(), true, '同意前は受付できない');
    await op.check('.check input');
    await op.click('button:has-text("受付する")');
    await op.waitForSelector('.big-no');
    return (await op.locator('.big-no').innerText()).trim();
  }
  const n1 = await register('山田', '090-1111-2222', '肥後銀行');
  const n2 = await register('佐藤', '080-3333-4444', '肥後銀行');
  const n3 = await register('鈴木', '070-5555-6666', '熊本弁護士会');
  assert.deepEqual([n1, n2, n3], ['001', '002', '003']);
  await shot(op, '01-register-done');

  // --- ボード: 肥後銀行は待ち2人(閲覧者にも約3秒以内に反映)
  await op.click('nav.tabs a:has-text("ボード")');
  await op.waitForSelector('article.desk:has-text("肥後銀行") .count b:text-is("2")');
  await vw.waitForSelector('article.desk:has-text("肥後銀行") .count b:text-is("2")', { timeout: 8000 });
  await shot(vw, '02-board-viewer');

  // --- 相談先画面: 先頭を開始 → 終了 → 次の行き先(弁護士会へ並び直し)
  await op.click('article.desk:has-text("肥後銀行") h3');
  await op.click('button:has-text("案内して開始")');
  await op.waitForSelector('text=ブース1');
  await shot(op, '03-desk-serving');
  await op.click('button:has-text("終了")');
  await op.waitForSelector('[role=dialog]');
  await shot(op, '04-next-sheet');
  await op.click('[role=dialog] button.row-btn:has-text("熊本弁護士会")');

  // 弁護士会(2ブース)の待ち: 鈴木→山田の順(山田は最後尾)
  await op.goto(BASE + '/#/');
  await op.waitForSelector('article.desk:has-text("熊本弁護士会") .count b:text-is("2")');
  const chips = await op.locator('article.desk:has-text("熊本弁護士会") .chips li').allInnerTexts();
  assert.deepEqual(chips, ['003 鈴木', '001 山田'], '並び直しは最後尾');

  // --- 閲覧者: 電話番号・メモは見えない。操作ボタンも無い
  await vw.click('nav.tabs a:has-text("相談者")');
  await vw.click('a.row-btn:has-text("山田")');
  await vw.waitForSelector('text=電話番号とメモは操作者のみ表示されます');
  const html = await vw.content();
  assert.ok(!html.includes('09011112222') && !html.includes('090-1111-2222'), '閲覧者に電話番号が出ない');
  assert.equal(await vw.locator('button:has-text("帰宅")').count(), 0);
  await shot(vw, '05-visitor-viewer');

  // --- 操作者: 相談者詳細に電話(tel:)と履歴
  await op.click('nav.tabs a:has-text("相談者")');
  await op.click('a.row-btn:has-text("山田")');
  await op.waitForSelector('a.tel[href="tel:09011112222"]');
  await shot(op, '06-visitor-operator');

  // --- 通信断: オフラインで操作 → 保存され、復帰後に自動送信
  await op.click('button:has-text("帰宅(持ち帰り)")');          // 山田は待機中のまま帰宅できる
  await op.waitForSelector('.badge:has-text("帰宅(持ち帰り)")');
  await opCtx.setOffline(true);
  await op.click('nav.tabs a:has-text("相談者")');
  await op.click('a.row-btn:has-text("佐藤")');
  await op.click('button:has-text("帰宅(相談完了)")');
  await op.waitForSelector('.banner.warn:has-text("未送信")');
  await op.waitForSelector('.banner.error:has-text("通信できません")', { timeout: 8000 });
  await shot(op, '07-offline');
  await opCtx.setOffline(false);
  await op.waitForSelector('.banner.warn', { state: 'detached', timeout: 12000 });
  await op.waitForSelector('.badge:has-text("帰宅(相談完了)")');
  await vw.click('nav.tabs a:has-text("相談者")');
  await vw.waitForSelector('a.row-btn:has-text("佐藤") .badge:has-text("帰宅(相談完了)")', { timeout: 8000 });

  // --- 全削除: 確認文字がないと押せない。削除後はパスコード失効でログアウト
  await op.click('nav.tabs a:has-text("管理")');
  await shot(op, '08-admin');
  const purge = op.locator('button:has-text("すべて削除する")');
  assert.equal(await purge.isDisabled(), true);
  await op.fill('#purge', '全データを削除');
  op.once('dialog', (d) => d.accept());
  await purge.click();
  await op.waitForSelector('#pass');                              // ログイン画面に戻る
  await vw.waitForSelector('#pass', { timeout: 8000 });           // 閲覧者も失効で戻る

  assert.deepEqual(errors, [], 'ブラウザ上のエラーなし');
  await browser.close();
  console.log('E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
