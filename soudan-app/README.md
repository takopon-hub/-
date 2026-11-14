# 住宅再建無料相談会 受付・待ち行列共有アプリ

受付、相談先ごとの待ち行列、相談の開始・終了、帰宅までを、職員のスマホで共有するWebアプリです。
計画と運用方針は [PLAN.md](./PLAN.md) を参照してください。

## できること

| 画面 | 操作者(財務局6名) | 閲覧者(各相談先の職員ほか) |
|---|---|---|
| ボード(14相談先の待ち人数・相談中・目安時間) | ○ | ○ |
| 受付(苗字・携帯番号・最初の相談先・同意確認) | ○ | — |
| 相談先画面(案内して開始 / 終了 / 取消) | ○ | 見るだけ |
| 終了後の「次の行き先」(別の相談先の最後尾へ / 帰宅 / 持ち帰り) | ○ | — |
| 相談者の検索・履歴 | ○(電話・メモも) | ○(番号・苗字・履歴のみ) |
| 管理(相談先・パスコード・全削除・操作ログ) | ○ | — |

## 構成

- `supabase/schema.sql` — DB定義。テーブルは非公開の `app` スキーマにあり、公開されるのはパスコード付きの関数(RPC)だけ。権限判定と携帯番号・メモの出し分けは **DB側** で行う。
- `src/lib/queue.ts` — 待ち時間の計算(直近10件の平均、3件未満は20分、5分単位に切り上げ)
- `src/lib/outbox.ts` — 通信断のときに操作を端末に保存して順番どおり再送する。サーバー側が冪等なので二重にならない。
- `src/ui/` — 画面(React)
- `dev/api-shim.mjs` — 開発用。ローカルPostgreSQLをSupabase(PostgREST)と同じ呼び出し形式で公開する。

更新の取得は3秒ごとのポーリングです(パスコード認証のため。40台でも負荷は小さい)。

## 本番(Supabase)への配置手順

1. Supabase でプロジェクトを作り、SQL エディタで `supabase/schema.sql` を実行する。
2. 続けて、パスコードを設定する(8文字以上、操作用と閲覧用は別):
   ```sql
   select app.init_passcodes('操作用パスコード', '閲覧用パスコード');
   ```
3. `.env.example` を `.env.production` にコピーして `VITE_API_URL` と `VITE_API_KEY`(anon / publishable key)を設定し、`npm run build`。
4. `dist/` を任意の静的ホスティング(HTTPS)に置く。
5. 相談会の終了後は、管理画面の「相談会終了後のデータ削除」で全削除する(パスコードの無効化も同時に可能)。

> API キー(anon)はブラウザに配布される前提の鍵です。テーブルは `app` スキーマにあり API から直接読めないため、パスコードなしでデータを取得することはできません。

## 開発

```sh
npm install
npm test                # 画面に依存しないロジックのテスト(待ち時間・再送キュー)
```

DBテストと画面の通し確認には PostgreSQL が必要です。**テストは `app` スキーマを作り直すため、DB名が `_test` で終わるDBにしか接続しません。**

```sh
createdb soudan_test
DATABASE_URL=postgres://localhost/soudan_test npm run test:db

# 画面の通し確認(Playwright)
createdb soudan_dev
psql soudan_dev -f supabase/schema.sql -c "select app.init_passcodes('operator-demo-1','viewer-demo-22')"
DATABASE_URL=postgres://localhost/soudan_dev npm run dev:api &   # :54321
npm run dev &                                                    # :5173
node test/e2e.cjs      # 最後に全削除とパスコード失効まで行うので、再実行前に init_passcodes をやり直す
```

## 未実装・今後

- 開催前の通し試験(100人規模の模擬運用)と、紙の受付表への切り戻し手順の作成
- PWAのアイコン(現在は未設定)
- 同意の案内文面(パンフレット記載・口頭説明)は主催側で作成
