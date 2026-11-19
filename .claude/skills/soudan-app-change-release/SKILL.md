---
name: soudan-app-change-release
description: 住宅再建無料相談会の受付アプリ(soudan-app)に、仕様変更・不具合修正の依頼が来たとき、要件確認 → 実装 → テスト → 画面確認 → プッシュ → 本番(Supabase)への反映手順の案内までを一通り行う。「受付アプリを直して」「ボード/受付/相談先画面を変えて」「離席・待ち行列・色・確認画面を追加して」などで使う。
---

# 相談会アプリの改修〜反映(soudan-app-change-release)

対象: リポジトリ内の `soudan-app/`(TypeScript + React + Vite、DBは Supabase の Postgres)。
利用者は日本語話者で、IT の専門家ではない。説明は日本語で、手順は番号つきで、そのまま実行できる形にする。

## どういう時に使うか
- 相談会アプリの画面・業務ルール・DB を変える依頼を受けたとき(例: 色分け、離席、確認画面、実績表示、ダーク/ライト)。
- 不具合の報告を受けたとき(例: データが消えない、エラー文が出る、見にくい)。
- 変更を本番で使えるところまで持っていきたいとき。

## 手順(順番どおり)
1. **前提を読む**: `soudan-app/PLAN.md`(確定事項と第2版以降の仕様変更)と `README.md`。すでにユーザーが答えた運用ルールは聞き直さない。
2. **曖昧な運用ルールだけ質問する**(例: 戻ったとき最後尾か元の順番か)。決められる細部は自分で決めて、報告で「こう解釈した」と明記する。
3. **影響範囲を決める**: DB(`supabase/schema.sql`)/ 計算(`src/lib/queue.ts`, `types.ts`, `format.ts`)/ 画面(`src/ui/*`)/ 見た目(`src/styles.css`)/ テスト。
4. **DB を変えるときの決まり**
   - 公開関数(`public.*`)は第1引数を必ず `p_pass text` にする(検査テストあり)。権限は DB 内で判定する。
   - `UPDATE` / `DELETE` には必ず `where` を付ける(Supabase の API は WHERE なしを拒否する。全件でも `where true` / `where id`)。
   - `schema.sql` は何度実行しても壊れない形にする。新しい関数名は、先頭の「古い関数を消す」DO ブロックの名前リストに追加する。制約や索引の変更は `drop ... if exists` → 作り直しにする。
   - 再送されても壊れないように、作成系は uuid を受け取り、状態遷移は「すでにその状態なら成功扱い」にする。
   - エラーは `E_xxx: 説明` の形式。ログに個人情報を入れない。個人情報は一切取らない(氏名・苗字・電話・メモなし。受付番号のみ)。
5. **画面を変えるときの決まり**
   - 色は CSS 変数で、ライト/ダークの両方を定義する(`data-theme` と `prefers-color-scheme` の両対応)。明るい札の上に `var(--text)` を使うとダークで白抜きになる。
   - 相談者の動き(開始・行き先・付け替え・帰宅・離席)は、登録前に確認画面(`useAsk` / `ConfirmProvider`)を出す。
   - 通信断に備え、操作は `act()` 経由(未送信キューで再送される)。
6. **テストを足す**: ロジックは `src/lib/*.test.ts`、DB は `test/db.test.mjs`、画面は `test/e2e.cjs`。確認画面を増やしたら e2e の該当クリックに確認ボタン(`[data-confirm-ok]`)の押下を足す。
7. **テストを実行する**(下の「環境メモ」参照)
   - `npm test` / `npm run typecheck` / `npm run build`
   - DB テスト: `DATABASE_URL=postgres://postgres@localhost/soudan_test npm run test:db`
   - 画面の通し確認: 開発用DBを初期化してから `node test/e2e.cjs`
8. **画面を目で確認する**: `SHOTS=<scratchpad のパス>` を付けて e2e を回し、画像を開いて見る(ダークも)。長い画像は切り出して見る。
9. **記録を更新する**: `PLAN.md` に仕様変更を追記する(必要なら `README.md`)。
10. **コミットしてプッシュする**: 指定された開発ブランチにだけ。コミット文はシステムの指示にある著者表記の行を付ける。PR は頼まれるまで作らない。
11. **ユーザーに報告する**(下の「報告の書き方」)。

## 環境メモ(クラウドのコンテナ)
- コンテナが再起動すると Postgres・開発サーバーが止まる。起動:
  `su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/tmp/pgsoudan/data -l /var/tmp/pgsoudan/pgN.log start"`(ログは毎回新しいファイル名にする。`log` はディレクトリ)。
- 開発用API: `DATABASE_URL=postgres://postgres@localhost/soudan_dev node dev/api-shim.mjs`(:54321)、画面: `npm run dev`(:5173)。
- e2e の前に、開発DBを毎回初期化する: `schema.sql` を流す → `select public.purge_all('operator-demo-1','全データを削除',false)` → `select app.init_passcodes('operator-demo-1','viewer-demo-22')`。(e2e の最後にパスコードを失効させるため。)
- DB テストは DB 名が `_test`、e2e は `_dev` で終わらないと拒否する。この安全装置は外さない。
- Supabase の本番に接続できるのは公開キーだけ。**service_role キー・DB パスワード・本番パスコードは聞かない・使わない。**
- コマンドに heredoc や複数の入れ子があると安全確認で止まることがある。ファイル作成は Write/Edit、コマンドは単純にする。

## 気をつけること・失敗しやすい点
- **本番の DB は自動では変わらない。** DB を変えたら、ユーザーが Supabase の SQL エディタで `schema.sql` を実行するまで、新しい画面はエラーになる(例: 「could not find the function ...」)。報告の先頭で必ず知らせる。直らないときは `notify pgrst, 'reload schema';` を実行してもらう。
- 旧スキーマからの大改造のときだけ `reset.sql`(全データ削除)が要る。通常の追加は `schema.sql` のみで、データとパスコードは残る。
- ローカルの Postgres には無い制限が Supabase にはある(WHERE なしの更新・削除の拒否)。検査テスト(`test/schema-lint.test.ts`)を通す。
- 「待っている人」は待機中だけ。離席(away)・相談中は別扱いで、`current`(現在の待ち札)には離席も含める。新しい状態を足したら、一意索引・`enqueue`・`leave_visitor`・`revert_ticket`・`visitorViews` を見直す。
- 順番は `queue_at`(並び順の基準)で決まる。付け替えは最後尾(新しい札)、入替は `swap_tickets`、離席からの復帰は `queue_at` を変えない(元の順番)。
- 本番の Supabase 上では確認できていない、という事実を報告で隠さない。「テストは通った/本番では未確認」を分けて書く。
- 同意チェックは廃止済み。氏名・電話番号・メモなど個人情報の欄を足さない(番号管理)。
- DB テストの並び: パスコードを失効させる「全削除」テストは最後に置く。
- 依頼が複数あるときは、すべてに対応したか、依頼文と照らして確認する。

## 報告の書き方(ユーザー向け)
1. 何をしたか(依頼ごとに、画面での見え方)。
2. **DB を変えた場合は先頭に太字で**: 「先に Supabase の SQL エディタで `soudan-app/supabase/schema.sql` を実行してください。データは消えません」。
3. 確認したこと(テスト件数、画面の通し確認)と、確認できていないこと(本番 Supabase)。
4. 自分で解釈・決めた点と、変えたいときの案(短く)。
5. コミット番号。Cloudflare Pages は自動で再ビルドされる旨。

## 完成の条件(すべて満たすこと)
- [ ] `npm test`、`npm run typecheck`、`npm run build` が通る。
- [ ] DB を変えた場合、DB テストが全件通り、`schema.sql` を再実行しても壊れない。
- [ ] 画面の通し確認(e2e)が `E2E OK` になり、変えた画面の画像を目で確認した(ダーク/ライトで読める)。
- [ ] `PLAN.md` に仕様変更が追記されている。
- [ ] 開発ブランチにコミットしてプッシュ済みで、作業ツリーがきれい。
- [ ] ユーザーに、DB 反映の手順(必要な場合)・確認済み/未確認・解釈した点を日本語で伝えた。
