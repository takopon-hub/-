-- 住宅再建無料相談会 受付・待ち行列共有アプリ: データベース定義
--
-- 設計方針
--  * テーブルは API に公開されない app スキーマに置く。public には公開用の関数(RPC)だけを置く。
--  * すべての関数は先頭引数にパスコードを取り、関数内で権限(operator / viewer)を判定する。
--  * 取得する個人情報は「苗字」だけ。電話番号は取得しない。
--  * 閲覧者(viewer)にはメモを返さない。更新系はすべて operator のみ。
--  * 通信断で同じ操作が再送されても壊れないよう、作成系はクライアントが採番した uuid を受け取り、
--    状態遷移系は「すでにその状態なら成功扱い」にする。
--  * Supabase の API 経由では「WHERE のない UPDATE / DELETE」が拒否されるため、全件対象でも where を書く。
--  * エラーは 'E_xxx: 説明' の形式で返す。クライアントは E_xxx で分岐する。
--
-- 初回セットアップ(SQL エディタで実行):
--   1. このファイルを実行する
--   2. select app.init_passcodes('操作用パスコード(8文字以上)', '閲覧用パスコード(8文字以上)');
--
-- 旧バージョン(電話番号あり)からの切り替え: 先に reset.sql を実行してから、このファイルを実行する。

-- 引数を変えた関数が古い定義と並存しないよう、public の関数だけを先に消す(データは消えない)。
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as f from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('snapshot', 'get_log', 'register_visitor', 'update_visitor', 'enqueue', 'start_ticket',
                        'finish_ticket', 'cancel_ticket', 'revert_ticket', 'swap_tickets', 'move_ticket', 'away_ticket', 'resume_ticket',
                        'leave_visitor', 'reopen_visitor', 'upsert_desk', 'set_passcodes', 'purge_all')
  loop
    execute 'drop function ' || r.f;
  end loop;
end $$;

create schema if not exists app;
revoke all on schema app from public;

-- ---------------------------------------------------------------- テーブル

create table if not exists app.config (
  id        boolean primary key default true check (id),   -- 1行だけ
  salt      text not null default encode(sha256(convert_to(random()::text || clock_timestamp()::text, 'UTF8')), 'hex'),
  op_hash   text,
  view_hash text
);
insert into app.config (id) values (true) on conflict do nothing;

-- category: public=公的機関等 / private=民間協会 / finance=金融機関
create table if not exists app.desk (
  id       serial primary key,
  name     text    not null check (length(name) between 1 and 40),
  category text    not null default 'finance' check (category in ('public', 'private', 'finance')),
  booths   int     not null default 1 check (booths between 1 and 10),
  active   boolean not null default true,
  sort     int     not null default 0
);

create table if not exists app.visitor (
  id         uuid primary key,
  no         int  not null unique,
  surname    text not null check (length(surname) between 1 and 20),
  memo       text not null default '' check (length(memo) <= 60),
  wishes     int[] not null default '{}',   -- 相談を希望する相談先(最初に並ぶ先を含む)
  status     text not null default 'in' check (status in ('in', 'left')),
  created_at timestamptz not null default now()
);

-- queued_at = 実際に並んだ時刻(履歴表示用) / queue_at = 行列内の順序(離席による入れ替えで変わる)
create table if not exists app.ticket (
  id         uuid primary key,
  visitor_id uuid not null references app.visitor (id) on delete cascade,
  desk_id    int  not null references app.desk (id),
  status     text not null default 'waiting' check (status in ('waiting', 'serving', 'done', 'cancelled', 'moved', 'away')),
  booth      int,
  queued_at  timestamptz not null default now(),
  queue_at   timestamptz not null default now(),
  started_at timestamptz,
  ended_at   timestamptz
);
-- 相談者は同時に1つの待ち札しか持てない(待機中または相談中)
-- 離席(away)を追加した版への切り替え: 既存テーブルの制約と索引を作り直す(データは消えない)
alter table app.ticket drop constraint if exists ticket_status_check;
alter table app.ticket add constraint ticket_status_check
  check (status in ('waiting', 'serving', 'done', 'cancelled', 'moved', 'away'));
drop index if exists app.ticket_one_active_per_visitor;
create unique index ticket_one_active_per_visitor
  on app.ticket (visitor_id) where status in ('waiting', 'serving', 'away');
-- 同じブースで同時に2人を相談中にできない
create unique index if not exists ticket_one_serving_per_booth
  on app.ticket (desk_id, booth) where status = 'serving';
create index if not exists ticket_desk_idx on app.ticket (desk_id, status);

create table if not exists app.op_log (
  id     bigserial primary key,
  at     timestamptz not null default now(),
  action text not null,
  detail text not null default ''   -- 受付番号など。氏名は入れない
);

alter table app.config  enable row level security;
alter table app.desk    enable row level security;
alter table app.visitor enable row level security;
alter table app.ticket  enable row level security;
alter table app.op_log  enable row level security;

-- ---------------------------------------------------------------- 内部関数

create or replace function app.hash_pass(p text) returns text
language sql stable as $$
  select encode(sha256(convert_to((select salt from app.config) || p, 'UTF8')), 'hex')
$$;

-- パスコードから権限を返す。不一致なら少し待ってから null を返す(総当たり対策)。
create or replace function app.role_of(p text) returns text
language plpgsql as $$
declare c app.config;
begin
  select * into c from app.config;
  if p is not null and length(p) > 0 then
    if c.op_hash is not null and app.hash_pass(p) = c.op_hash then return 'operator'; end if;
    if c.view_hash is not null and app.hash_pass(p) = c.view_hash then return 'viewer'; end if;
  end if;
  perform pg_sleep(0.5);
  return null;
end $$;

create or replace function app.require_operator(p text) returns void
language plpgsql as $$
declare r text := app.role_of(p);
begin
  if r is null then raise exception 'E_AUTH: パスコードが違います'; end if;
  if r <> 'operator' then raise exception 'E_FORBIDDEN: この操作は操作者のみ行えます'; end if;
end $$;

create or replace function app.log(p_action text, p_detail text default '') returns void
language sql as $$ insert into app.op_log (action, detail) values (p_action, p_detail) $$;

create or replace function app.visitor_no(p_visitor uuid) returns text
language sql stable as $$ select lpad(no::text, 3, '0') from app.visitor where id = p_visitor $$;

-- 希望先の配列を検証して、重複を除いて返す(存在しない相談先は拒否)
create or replace function app.clean_wishes(p_wishes int[], p_first int default null) returns int[]
language plpgsql as $$
declare w int[];
begin
  select coalesce(array_agg(distinct d order by d), '{}') into w
    from unnest(coalesce(p_wishes, '{}') || case when p_first is null then '{}'::int[] else array[p_first] end) as d;
  if exists (select 1 from unnest(w) d where not exists (select 1 from app.desk where id = d)) then
    raise exception 'E_INPUT: 存在しない相談先が選ばれています';
  end if;
  return w;
end $$;

-- 初回セットアップ・パスコード再設定
create or replace function app.init_passcodes(p_operator text, p_viewer text) returns void
language plpgsql as $$
begin
  if length(coalesce(p_operator, '')) < 8 or length(coalesce(p_viewer, '')) < 8 then
    raise exception 'E_WEAK: パスコードは8文字以上にしてください';
  end if;
  if p_operator = p_viewer then
    raise exception 'E_SAME: 操作用と閲覧用は別のパスコードにしてください';
  end if;
  update app.config set op_hash = app.hash_pass(p_operator), view_hash = app.hash_pass(p_viewer) where id;
end $$;

-- ---------------------------------------------------------------- 公開 RPC: 読み取り

-- 画面に必要な全データ。閲覧者にはメモを含めない。
create or replace function public.snapshot(p_pass text) returns jsonb
language plpgsql security definer set search_path = app, public as $$
declare r text := app.role_of(p_pass); op boolean;
begin
  if r is null then raise exception 'E_AUTH: パスコードが違います'; end if;
  op := (r = 'operator');
  return jsonb_build_object(
    'role', r,
    'now', now(),
    'desks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'name', d.name, 'category', d.category, 'booths', d.booths, 'active', d.active, 'sort', d.sort
      ) order by d.sort, d.id) from app.desk d), '[]'::jsonb),
    'visitors', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'no', v.no, 'surname', v.surname, 'status', v.status,
        'wishes', to_jsonb(v.wishes), 'createdAt', v.created_at
      ) || case when op then jsonb_build_object('memo', v.memo) else '{}'::jsonb end
      order by v.no) from app.visitor v), '[]'::jsonb),
    'tickets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'visitorId', t.visitor_id, 'deskId', t.desk_id, 'status', t.status,
        'booth', t.booth, 'queuedAt', t.queued_at, 'queueAt', t.queue_at,
        'startedAt', t.started_at, 'endedAt', t.ended_at
      ) order by t.queue_at, t.id) from app.ticket t), '[]'::jsonb)
  );
end $$;

create or replace function public.get_log(p_pass text) returns jsonb
language plpgsql security definer set search_path = app, public as $$
begin
  perform app.require_operator(p_pass);
  return coalesce((select jsonb_agg(jsonb_build_object('at', at, 'action', action, 'detail', detail) order by id desc)
                   from (select * from app.op_log order by id desc limit 200) l), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- 公開 RPC: 受付・待ち行列

-- 受付。p_desk_id=最初に並ぶ相談先(省略可)、p_wishes=相談を希望する相談先(最初の先を含めて記録する)
create or replace function public.register_visitor(
  p_pass text, p_visitor_id uuid, p_ticket_id uuid,
  p_surname text, p_desk_id int, p_wishes int[] default '{}', p_memo text default ''
) returns jsonb
language plpgsql security definer set search_path = app, public as $$
declare v_no int; v_surname text := btrim(coalesce(p_surname, ''));
begin
  perform app.require_operator(p_pass);
  select no into v_no from app.visitor where id = p_visitor_id;
  if found then return jsonb_build_object('no', v_no, 'already', true); end if;  -- 再送

  if length(v_surname) not between 1 and 20 then raise exception 'E_INPUT: 苗字を1〜20文字で入力してください'; end if;
  if length(coalesce(p_memo, '')) > 60 then raise exception 'E_INPUT: メモは60文字以内にしてください'; end if;
  if p_desk_id is not null and not exists (select 1 from app.desk where id = p_desk_id and active) then
    raise exception 'E_DESK_CLOSED: その相談先は休止中です';
  end if;

  perform pg_advisory_xact_lock(7001);
  select coalesce(max(no), 0) + 1 into v_no from app.visitor;
  insert into app.visitor (id, no, surname, memo, wishes)
    values (p_visitor_id, v_no, v_surname, coalesce(p_memo, ''), app.clean_wishes(p_wishes, p_desk_id));
  if p_desk_id is not null then
    insert into app.ticket (id, visitor_id, desk_id) values (p_ticket_id, p_visitor_id, p_desk_id);
  end if;
  perform app.log('受付', lpad(v_no::text, 3, '0') || case when p_desk_id is null then '' else ' → desk ' || p_desk_id end);
  return jsonb_build_object('no', v_no, 'already', false);
end $$;

create or replace function public.update_visitor(
  p_pass text, p_visitor_id uuid, p_surname text, p_memo text, p_wishes int[]
) returns jsonb
language plpgsql security definer set search_path = app, public as $$
declare v_surname text := btrim(coalesce(p_surname, ''));
begin
  perform app.require_operator(p_pass);
  if length(v_surname) not between 1 and 20 then raise exception 'E_INPUT: 苗字を1〜20文字で入力してください'; end if;
  if length(coalesce(p_memo, '')) > 60 then raise exception 'E_INPUT: メモは60文字以内にしてください'; end if;
  update app.visitor set surname = v_surname, memo = coalesce(p_memo, ''), wishes = app.clean_wishes(p_wishes)
    where id = p_visitor_id;
  if not found then raise exception 'E_NOT_FOUND: 相談者が見つかりません'; end if;
  perform app.log('情報修正', app.visitor_no(p_visitor_id));
  return jsonb_build_object('ok', true);
end $$;

-- 相談先の行列の最後尾に並ぶ(次の相談先の追加)
create or replace function public.enqueue(p_pass text, p_ticket_id uuid, p_visitor_id uuid, p_desk_id int) returns jsonb
language plpgsql security definer set search_path = app, public as $$
declare v app.visitor;
begin
  perform app.require_operator(p_pass);
  if exists (select 1 from app.ticket where id = p_ticket_id) then return jsonb_build_object('ok', true, 'already', true); end if;
  select * into v from app.visitor where id = p_visitor_id for update;
  if not found then raise exception 'E_NOT_FOUND: 相談者が見つかりません'; end if;
  if v.status <> 'in' then raise exception 'E_VISITOR_LEFT: この相談者は帰宅済みです'; end if;
  if not exists (select 1 from app.desk where id = p_desk_id and active) then
    raise exception 'E_DESK_CLOSED: その相談先は休止中です';
  end if;
  if exists (select 1 from app.ticket where visitor_id = p_visitor_id and status in ('waiting', 'serving', 'away')) then
    raise exception 'E_ALREADY_ACTIVE: すでに別の相談先に並んでいるか相談中です';
  end if;
  insert into app.ticket (id, visitor_id, desk_id) values (p_ticket_id, p_visitor_id, p_desk_id);
  -- 並んだ先は希望先にも加える(あとから決まった行き先も記録に残る)
  update app.visitor set wishes = app.clean_wishes(wishes, p_desk_id) where id = p_visitor_id;
  perform app.log('並ぶ', lpad(v.no::text, 3, '0') || ' → desk ' || p_desk_id);
  return jsonb_build_object('ok', true, 'already', false);
end $$;

-- 待機中の人を別の相談先の最後尾へ付け替える(行列の動きが悪いとき)
create or replace function public.move_ticket(p_pass text, p_ticket_id uuid, p_new_ticket_id uuid, p_desk_id int) returns jsonb
language plpgsql security definer set search_path = app, public as $$
declare t app.ticket;
begin
  perform app.require_operator(p_pass);
  if exists (select 1 from app.ticket where id = p_new_ticket_id) then return jsonb_build_object('ok', true, 'already', true); end if;
  select * into t from app.ticket where id = p_ticket_id for update;
  if not found then raise exception 'E_NOT_FOUND: 待ち札が見つかりません'; end if;
  if t.status <> 'waiting' then raise exception 'E_BAD_STATE: 待機中ではないため付け替えできません(状況が変わりました)'; end if;
  if t.desk_id = p_desk_id then raise exception 'E_INPUT: 同じ相談先です'; end if;
  if not exists (select 1 from app.desk where id = p_desk_id and active) then
    raise exception 'E_DESK_CLOSED: その相談先は休止中です';
  end if;
  update app.ticket set status = 'moved', ended_at = now() where id = t.id;
  insert into app.ticket (id, visitor_id, desk_id) values (p_new_ticket_id, t.visitor_id, p_desk_id);
  update app.visitor set wishes = app.clean_wishes(wishes, p_desk_id) where id = t.visitor_id;
  perform app.log('付け替え', app.visitor_no(t.visitor_id) || ' desk ' || t.desk_id || ' → ' || p_desk_id);
  return jsonb_build_object('ok', true, 'already', false);
end $$;

-- 離席などで呼び出しに応じられない人(p_a)と、その次の人(p_b)の順番を入れ替える。
-- p_a が p_b より前にいれば入れ替え、すでに後ろにいれば何もしない(再送しても二重に戻らない)。
create or replace function public.swap_tickets(p_pass text, p_a uuid, p_b uuid) returns jsonb
language plpgsql security definer set search_path = app, public as $$
declare a app.ticket; b app.ticket; new_a timestamptz;
begin
  perform app.require_operator(p_pass);
  perform 1 from app.ticket where id in (p_a, p_b) order by id for update;
  select * into a from app.ticket where id = p_a;
  select * into b from app.ticket where id = p_b;
  if a.id is null or b.id is null then raise exception 'E_NOT_FOUND: 待ち札が見つかりません'; end if;
  if a.desk_id <> b.desk_id then raise exception 'E_BAD_STATE: 別々の相談先の待ち札です'; end if;
  if (a.queue_at, a.id) > (b.queue_at, b.id) and a.status = 'waiting' and b.status = 'waiting' then
    return jsonb_build_object('ok', true, 'already', true);   -- すでに入れ替わっている
  end if;
  if a.status <> 'waiting' or b.status <> 'waiting' then
    raise exception 'E_BAD_STATE: 待機中ではないため入れ替えできません(状況が変わりました)';
  end if;
  new_a := case when a.queue_at = b.queue_at then b.queue_at + interval '1 millisecond' else b.queue_at end;
  update app.ticket set queue_at = new_a where id = a.id;
  update app.ticket set queue_at = a.queue_at where id = b.id;
  perform app.log('順番入れ替え', app.visitor_no(a.visitor_id) || ' ⇄ ' || app.visitor_no(b.visitor_id));
  return jsonb_build_object('ok', true, 'already', false);
end $$;

create or replace function public.start_ticket(p_pass text, p_ticket_id uuid, p_booth int default null) returns jsonb
language plpgsql security definer set search_path = app, public as $$
declare t app.ticket; d app.desk; b int;
begin
  perform app.require_operator(p_pass);
  select * into t from app.ticket where id = p_ticket_id for update;
  if not found then raise exception 'E_NOT_FOUND: 待ち札が見つかりません'; end if;
  if t.status = 'serving' then return jsonb_build_object('ok', true, 'already', true, 'booth', t.booth); end if;
  if t.status <> 'waiting' then raise exception 'E_BAD_STATE: この待ち札は開始できません'; end if;
  select * into d from app.desk where id = t.desk_id for update;   -- ブース割り当てを直列化
  if p_booth is not null then
    if p_booth not between 1 and d.booths then raise exception 'E_BAD_BOOTH: ブース番号が範囲外です'; end if;
    if exists (select 1 from app.ticket where desk_id = d.id and status = 'serving' and booth = p_booth) then
      raise exception 'E_BOOTH_BUSY: そのブースは相談中です';
    end if;
    b := p_booth;
  else
    select g into b from generate_series(1, d.booths) g
      where not exists (select 1 from app.ticket where desk_id = d.id and status = 'serving' and booth = g)
      order by g limit 1;
    if b is null then raise exception 'E_NO_BOOTH: 相談中の方がいるため開始できません'; end if;
  end if;
  update app.ticket set status = 'serving', booth = b, started_at = now() where id = p_ticket_id;
  perform app.log('相談開始', app.visitor_no(t.visitor_id) || ' desk ' || t.desk_id);
  return jsonb_build_object('ok', true, 'already', false, 'booth', b);
end $$;

create or replace function public.finish_ticket(p_pass text, p_ticket_id uuid) returns jsonb
language plpgsql security definer set search_path = app, public as $$
declare t app.ticket;
begin
  perform app.require_operator(p_pass);
  select * into t from app.ticket where id = p_ticket_id for update;
  if not found then raise exception 'E_NOT_FOUND: 待ち札が見つかりません'; end if;
  if t.status = 'done' then return jsonb_build_object('ok', true, 'already', true); end if;
  if t.status <> 'serving' then raise exception 'E_BAD_STATE: 相談中ではありません'; end if;
  update app.ticket set status = 'done', ended_at = now() where id = p_ticket_id;
  perform app.log('相談終了', app.visitor_no(t.visitor_id) || ' desk ' || t.desk_id);
  return jsonb_build_object('ok', true, 'already', false);
end $$;

-- 待機中・相談中の待ち札を取り消す(並び間違い、相談を取りやめるなど)
create or replace function public.cancel_ticket(p_pass text, p_ticket_id uuid) returns jsonb
language plpgsql security definer set search_path = app, public as $$
declare t app.ticket;
begin
  perform app.require_operator(p_pass);
  select * into t from app.ticket where id = p_ticket_id for update;
  if not found then raise exception 'E_NOT_FOUND: 待ち札が見つかりません'; end if;
  if t.status = 'cancelled' then return jsonb_build_object('ok', true, 'already', true); end if;
  if t.status in ('done', 'moved') then raise exception 'E_BAD_STATE: 終了済み・付け替え済みの待ち札は取り消せません'; end if;
  update app.ticket set status = 'cancelled', ended_at = now() where id = p_ticket_id;
  perform app.log('取消', app.visitor_no(t.visitor_id) || ' desk ' || t.desk_id);
  return jsonb_build_object('ok', true, 'already', false);
end $$;

-- 昼食などで待ち行列から外れる(離席)。離席中は案内の対象にならず、戻ったら同じ相談先の最後尾に並び直す。
create or replace function public.away_ticket(p_pass text, p_ticket_id uuid) returns jsonb
language plpgsql security definer set search_path = app, public as $$
declare t app.ticket;
begin
  perform app.require_operator(p_pass);
  select * into t from app.ticket where id = p_ticket_id for update;
  if not found then raise exception 'E_NOT_FOUND: 待ち札が見つかりません'; end if;
  if t.status = 'away' then return jsonb_build_object('ok', true, 'already', true); end if;
  if t.status <> 'waiting' then raise exception 'E_BAD_STATE: 待機中ではないため離席にできません(状況が変わりました)'; end if;
  update app.ticket set status = 'away' where id = p_ticket_id;
  perform app.log('離席', app.visitor_no(t.visitor_id) || ' desk ' || t.desk_id);
  return jsonb_build_object('ok', true, 'already', false);
end $$;

create or replace function public.resume_ticket(p_pass text, p_ticket_id uuid) returns jsonb
language plpgsql security definer set search_path = app, public as $$
declare t app.ticket;
begin
  perform app.require_operator(p_pass);
  select * into t from app.ticket where id = p_ticket_id for update;
  if not found then raise exception 'E_NOT_FOUND: 待ち札が見つかりません'; end if;
  if t.status = 'waiting' then return jsonb_build_object('ok', true, 'already', true); end if;
  if t.status <> 'away' then raise exception 'E_BAD_STATE: 離席中ではありません(状況が変わりました)'; end if;
  update app.ticket set status = 'waiting', queue_at = clock_timestamp() where id = p_ticket_id;
  perform app.log('離席から戻る', app.visitor_no(t.visitor_id) || ' desk ' || t.desk_id);
  return jsonb_build_object('ok', true, 'already', false);
end $$;

-- 直前の操作の取り消し: 終了→相談中 / 相談中→待機中 / 取消→待機中
create or replace function public.revert_ticket(p_pass text, p_ticket_id uuid) returns jsonb
language plpgsql security definer set search_path = app, public as $$
declare t app.ticket; d app.desk; b int; v app.visitor;
begin
  perform app.require_operator(p_pass);
  select * into t from app.ticket where id = p_ticket_id for update;
  if not found then raise exception 'E_NOT_FOUND: 待ち札が見つかりません'; end if;
  select * into v from app.visitor where id = t.visitor_id for update;
  if v.status <> 'in' then raise exception 'E_VISITOR_LEFT: 帰宅済みです。先に「帰宅を取り消す」を行ってください'; end if;
  if t.status in ('waiting', 'moved', 'away') then raise exception 'E_BAD_STATE: 戻せる操作がありません'; end if;
  if exists (select 1 from app.ticket where visitor_id = t.visitor_id and status in ('waiting', 'serving', 'away') and id <> t.id) then
    raise exception 'E_ALREADY_ACTIVE: すでに別の相談先に並んでいるか相談中です';
  end if;
  if t.status = 'serving' then
    update app.ticket set status = 'waiting', booth = null, started_at = null where id = t.id;
  elsif t.status = 'cancelled' then
    update app.ticket set status = 'waiting', booth = null, started_at = null, ended_at = null where id = t.id;
  else  -- done
    select * into d from app.desk where id = t.desk_id for update;
    if t.booth is not null and not exists (
      select 1 from app.ticket where desk_id = d.id and status = 'serving' and booth = t.booth) then
      b := t.booth;
    else
      select g into b from generate_series(1, d.booths) g
        where not exists (select 1 from app.ticket where desk_id = d.id and status = 'serving' and booth = g)
        order by g limit 1;
    end if;
    if b is null then raise exception 'E_NO_BOOTH: 相談中の方がいるため戻せません'; end if;
    update app.ticket set status = 'serving', booth = b, ended_at = null where id = t.id;
  end if;
  perform app.log('操作を戻す', v.no::text || ' ' || t.status);
  return jsonb_build_object('ok', true);
end $$;

-- 帰宅(待機中の待ち札は自動で取り消す)
create or replace function public.leave_visitor(p_pass text, p_visitor_id uuid) returns jsonb
language plpgsql security definer set search_path = app, public as $$
declare v app.visitor;
begin
  perform app.require_operator(p_pass);
  select * into v from app.visitor where id = p_visitor_id for update;
  if not found then raise exception 'E_NOT_FOUND: 相談者が見つかりません'; end if;
  if v.status = 'left' then return jsonb_build_object('ok', true, 'already', true); end if;
  if exists (select 1 from app.ticket where visitor_id = v.id and status = 'serving') then
    raise exception 'E_SERVING: 相談中です。先に相談を終了してください';
  end if;
  update app.ticket set status = 'cancelled', ended_at = now() where visitor_id = v.id and status in ('waiting', 'away');
  update app.visitor set status = 'left' where id = v.id;
  perform app.log('帰宅', lpad(v.no::text, 3, '0'));
  return jsonb_build_object('ok', true, 'already', false);
end $$;

create or replace function public.reopen_visitor(p_pass text, p_visitor_id uuid) returns jsonb
language plpgsql security definer set search_path = app, public as $$
begin
  perform app.require_operator(p_pass);
  update app.visitor set status = 'in' where id = p_visitor_id;
  if not found then raise exception 'E_NOT_FOUND: 相談者が見つかりません'; end if;
  perform app.log('帰宅を取り消し', app.visitor_no(p_visitor_id));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- 公開 RPC: 管理

create or replace function public.upsert_desk(
  p_pass text, p_id int, p_name text, p_category text, p_active boolean, p_sort int
) returns jsonb
language plpgsql security definer set search_path = app, public as $$
declare v_id int := p_id;
begin
  perform app.require_operator(p_pass);
  if length(btrim(coalesce(p_name, ''))) not between 1 and 40 then raise exception 'E_INPUT: 相談先名を1〜40文字で入力してください'; end if;
  if p_category not in ('public', 'private', 'finance') then raise exception 'E_INPUT: 区分が不正です'; end if;
  if p_id is null then
    insert into app.desk (name, category, active, sort)
      values (btrim(p_name), p_category, coalesce(p_active, true), coalesce(p_sort, 0)) returning id into v_id;
  else
    update app.desk set name = btrim(p_name), category = p_category, active = coalesce(p_active, active), sort = coalesce(p_sort, sort)
      where id = p_id;
    if not found then raise exception 'E_NOT_FOUND: 相談先が見つかりません'; end if;
  end if;
  perform app.log('相談先を設定', v_id::text);
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.set_passcodes(p_pass text, p_new_operator text, p_new_viewer text) returns jsonb
language plpgsql security definer set search_path = app, public as $$
begin
  perform app.require_operator(p_pass);
  perform app.init_passcodes(p_new_operator, p_new_viewer);
  perform app.log('パスコード変更');
  return jsonb_build_object('ok', true);
end $$;

-- 相談会終了後の全削除。個人情報(相談者・待ち札)と操作ログを消し、必要ならパスコードも無効化する。
-- ※ Supabase は where のない delete / update を API 経由で拒否するため、すべて where を付けている。
create or replace function public.purge_all(p_pass text, p_confirm text, p_revoke_passcodes boolean default false) returns jsonb
language plpgsql security definer set search_path = app, public as $$
declare n int;
begin
  perform app.require_operator(p_pass);
  if p_confirm is distinct from '全データを削除' then raise exception 'E_CONFIRM: 確認の文字が一致しません'; end if;
  select count(*) into n from app.visitor;
  delete from app.ticket where true;
  delete from app.visitor where true;
  delete from app.op_log where true;
  if p_revoke_passcodes then update app.config set op_hash = null, view_hash = null where id; end if;
  return jsonb_build_object('ok', true, 'deletedVisitors', n);
end $$;

-- ---------------------------------------------------------------- 初期データ(相談先)
-- 表示順: 公的機関等 → 民間協会 → 金融機関。弁護士会と建築士事務所協会は2ブースを別の相談先として管理する。

insert into app.desk (name, category, sort)
select * from (values
  ('熊本弁護士会①', 'public', 10), ('熊本弁護士会②', 'public', 20), ('八代市', 'public', 30),
  ('建築士事務所協会①', 'private', 110), ('建築士事務所協会②', 'private', 120), ('賃貸住宅経営者協会', 'private', 130),
  ('肥後銀行', 'finance', 210), ('熊本銀行', 'finance', 220),
  ('天草信用金庫', 'finance', 230), ('熊本中央信用金庫', 'finance', 240), ('熊本第一信用金庫', 'finance', 250), ('熊本信用金庫', 'finance', 260),
  ('熊本県信用組合', 'finance', 270), ('JA八代', 'finance', 280), ('九州労働金庫', 'finance', 290), ('住宅金融支援機構', 'finance', 300)
) as v(name, category, sort)
where not exists (select 1 from app.desk);
