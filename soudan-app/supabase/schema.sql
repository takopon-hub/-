-- 住宅再建無料相談会 受付・待ち行列共有アプリ: データベース定義
--
-- 設計方針
--  * テーブルは API に公開されない app スキーマに置く。public には公開用の関数(RPC)だけを置く。
--  * すべての関数は先頭引数にパスコードを取り、関数内で権限(operator / viewer)を判定する。
--  * 閲覧者(viewer)には携帯番号とメモを返さない。更新系はすべて operator のみ。
--  * 通信断で同じ操作が再送されても壊れないよう、作成系はクライアントが採番した uuid を受け取り、
--    状態遷移系は「すでにその状態なら成功扱い」にする。
--  * エラーは 'E_xxx: 説明' の形式で返す。クライアントは E_xxx で分岐する。
--
-- 初回セットアップ(SQL エディタで実行):
--   select app.init_passcodes('操作用パスコード(8文字以上)', '閲覧用パスコード(8文字以上)');

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

create table if not exists app.desk (
  id     serial primary key,
  name   text    not null check (length(name) between 1 and 40),
  booths int     not null default 1 check (booths between 1 and 10),
  active boolean not null default true,
  sort   int     not null default 0
);

create table if not exists app.visitor (
  id         uuid primary key,
  no         int  not null unique,
  surname    text not null check (length(surname) between 1 and 20),
  phone      text not null,
  memo       text not null default '' check (length(memo) <= 60),
  status     text not null default 'in' check (status in ('in', 'left')),
  leave_kind text check (leave_kind in ('done', 'carryover', 'dropped')),
  created_at timestamptz not null default now(),
  check ((status = 'left') = (leave_kind is not null))
);

create table if not exists app.ticket (
  id         uuid primary key,
  visitor_id uuid not null references app.visitor (id) on delete cascade,
  desk_id    int  not null references app.desk (id),
  status     text not null default 'waiting' check (status in ('waiting', 'serving', 'done', 'cancelled')),
  booth      int,
  queued_at  timestamptz not null default now(),
  started_at timestamptz,
  ended_at   timestamptz
);
-- 相談者は同時に1つの待ち札しか持てない(待機中または相談中)
create unique index if not exists ticket_one_active_per_visitor
  on app.ticket (visitor_id) where status in ('waiting', 'serving');
-- 同じブースで同時に2人を相談中にできない
create unique index if not exists ticket_one_serving_per_booth
  on app.ticket (desk_id, booth) where status = 'serving';
create index if not exists ticket_desk_idx on app.ticket (desk_id, status);

create table if not exists app.op_log (
  id     bigserial primary key,
  at     timestamptz not null default now(),
  action text not null,
  detail text not null default ''   -- 受付番号など。氏名・電話番号は入れない
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

-- 初回セットアップ・パスコード再設定(SQL エディタ専用。API からは呼べない)
create or replace function app.init_passcodes(p_operator text, p_viewer text) returns void
language plpgsql as $$
begin
  if length(coalesce(p_operator, '')) < 8 or length(coalesce(p_viewer, '')) < 8 then
    raise exception 'E_WEAK: パスコードは8文字以上にしてください';
  end if;
  if p_operator = p_viewer then
    raise exception 'E_SAME: 操作用と閲覧用は別のパスコードにしてください';
  end if;
  update app.config set op_hash = app.hash_pass(p_operator), view_hash = app.hash_pass(p_viewer);
end $$;

-- ---------------------------------------------------------------- 公開 RPC: 読み取り

-- 画面に必要な全データ。閲覧者には携帯番号とメモを含めない。
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
        'id', d.id, 'name', d.name, 'booths', d.booths, 'active', d.active, 'sort', d.sort
      ) order by d.sort, d.id) from app.desk d), '[]'::jsonb),
    'visitors', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'no', v.no, 'surname', v.surname, 'status', v.status,
        'leaveKind', v.leave_kind, 'createdAt', v.created_at
      ) || case when op then jsonb_build_object('phone', v.phone, 'memo', v.memo) else '{}'::jsonb end
      order by v.no) from app.visitor v), '[]'::jsonb),
    'tickets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'visitorId', t.visitor_id, 'deskId', t.desk_id, 'status', t.status,
        'booth', t.booth, 'queuedAt', t.queued_at, 'startedAt', t.started_at, 'endedAt', t.ended_at
      ) order by t.queued_at, t.id) from app.ticket t), '[]'::jsonb)
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

create or replace function public.register_visitor(
  p_pass text, p_visitor_id uuid, p_ticket_id uuid,
  p_surname text, p_phone text, p_desk_id int, p_memo text default ''
) returns jsonb
language plpgsql security definer set search_path = app, public as $$
declare v_no int; v_phone text; v_surname text := btrim(coalesce(p_surname, ''));
begin
  perform app.require_operator(p_pass);
  select no into v_no from app.visitor where id = p_visitor_id;
  if found then return jsonb_build_object('no', v_no, 'already', true); end if;  -- 再送

  if length(v_surname) not between 1 and 20 then raise exception 'E_INPUT: 苗字を1〜20文字で入力してください'; end if;
  v_phone := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  if v_phone !~ '^0[0-9]{9,10}$' then raise exception 'E_INPUT: 電話番号は0から始まる10〜11桁で入力してください'; end if;
  if length(coalesce(p_memo, '')) > 60 then raise exception 'E_INPUT: メモは60文字以内にしてください'; end if;
  if p_desk_id is not null and not exists (select 1 from app.desk where id = p_desk_id and active) then
    raise exception 'E_DESK_CLOSED: その相談先は休止中です';
  end if;

  perform pg_advisory_xact_lock(7001);
  select coalesce(max(no), 0) + 1 into v_no from app.visitor;
  insert into app.visitor (id, no, surname, phone, memo) values (p_visitor_id, v_no, v_surname, v_phone, coalesce(p_memo, ''));
  if p_desk_id is not null then
    insert into app.ticket (id, visitor_id, desk_id) values (p_ticket_id, p_visitor_id, p_desk_id);
  end if;
  perform app.log('受付', lpad(v_no::text, 3, '0') || case when p_desk_id is null then '' else ' → desk ' || p_desk_id end);
  return jsonb_build_object('no', v_no, 'already', false);
end $$;

create or replace function public.update_visitor(
  p_pass text, p_visitor_id uuid, p_surname text, p_phone text, p_memo text
) returns jsonb
language plpgsql security definer set search_path = app, public as $$
declare v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'); v_surname text := btrim(coalesce(p_surname, ''));
begin
  perform app.require_operator(p_pass);
  if length(v_surname) not between 1 and 20 then raise exception 'E_INPUT: 苗字を1〜20文字で入力してください'; end if;
  if v_phone !~ '^0[0-9]{9,10}$' then raise exception 'E_INPUT: 電話番号は0から始まる10〜11桁で入力してください'; end if;
  if length(coalesce(p_memo, '')) > 60 then raise exception 'E_INPUT: メモは60文字以内にしてください'; end if;
  update app.visitor set surname = v_surname, phone = v_phone, memo = coalesce(p_memo, '') where id = p_visitor_id;
  if not found then raise exception 'E_NOT_FOUND: 相談者が見つかりません'; end if;
  perform app.log('情報修正', app.visitor_no(p_visitor_id));
  return jsonb_build_object('ok', true);
end $$;

-- 相談先の行列の最後尾に並ぶ(再受付)
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
  if exists (select 1 from app.ticket where visitor_id = p_visitor_id and status in ('waiting', 'serving')) then
    raise exception 'E_ALREADY_ACTIVE: すでに別の相談先に並んでいるか相談中です';
  end if;
  insert into app.ticket (id, visitor_id, desk_id) values (p_ticket_id, p_visitor_id, p_desk_id);
  perform app.log('並ぶ', lpad(v.no::text, 3, '0') || ' → desk ' || p_desk_id);
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
    if b is null then raise exception 'E_NO_BOOTH: 空いているブースがありません'; end if;
  end if;
  update app.ticket set status = 'serving', booth = b, started_at = now() where id = p_ticket_id;
  perform app.log('相談開始', app.visitor_no(t.visitor_id) || ' desk ' || t.desk_id || ' ブース' || b);
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

-- 待機中・相談中の待ち札を取り消す(途中でやめる、並び間違いなど)
create or replace function public.cancel_ticket(p_pass text, p_ticket_id uuid) returns jsonb
language plpgsql security definer set search_path = app, public as $$
declare t app.ticket;
begin
  perform app.require_operator(p_pass);
  select * into t from app.ticket where id = p_ticket_id for update;
  if not found then raise exception 'E_NOT_FOUND: 待ち札が見つかりません'; end if;
  if t.status = 'cancelled' then return jsonb_build_object('ok', true, 'already', true); end if;
  if t.status = 'done' then raise exception 'E_BAD_STATE: 終了済みの待ち札は取り消せません'; end if;
  update app.ticket set status = 'cancelled', ended_at = now() where id = p_ticket_id;
  perform app.log('取消', app.visitor_no(t.visitor_id) || ' desk ' || t.desk_id);
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
  if t.status = 'waiting' then raise exception 'E_BAD_STATE: 戻せる操作がありません'; end if;
  if exists (select 1 from app.ticket where visitor_id = t.visitor_id and status in ('waiting', 'serving') and id <> t.id) then
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
    if b is null then raise exception 'E_NO_BOOTH: 空いているブースがないため戻せません'; end if;
    update app.ticket set status = 'serving', booth = b, ended_at = null where id = t.id;
  end if;
  perform app.log('操作を戻す', v.no::text || ' ' || t.status);
  return jsonb_build_object('ok', true);
end $$;

-- 帰宅 / 途中離脱。kind: done=相談完了, carryover=持ち帰り, dropped=途中離脱
create or replace function public.leave_visitor(p_pass text, p_visitor_id uuid, p_kind text) returns jsonb
language plpgsql security definer set search_path = app, public as $$
declare v app.visitor;
begin
  perform app.require_operator(p_pass);
  if p_kind not in ('done', 'carryover', 'dropped') then raise exception 'E_INPUT: 帰宅の区分が不正です'; end if;
  select * into v from app.visitor where id = p_visitor_id for update;
  if not found then raise exception 'E_NOT_FOUND: 相談者が見つかりません'; end if;
  if v.status = 'left' then
    if v.leave_kind = p_kind then return jsonb_build_object('ok', true, 'already', true); end if;
    update app.visitor set leave_kind = p_kind where id = v.id;      -- 区分の訂正
    return jsonb_build_object('ok', true, 'already', false);
  end if;
  if exists (select 1 from app.ticket where visitor_id = v.id and status = 'serving') then
    raise exception 'E_SERVING: 相談中です。先に相談を終了してください';
  end if;
  update app.ticket set status = 'cancelled', ended_at = now() where visitor_id = v.id and status = 'waiting';
  update app.visitor set status = 'left', leave_kind = p_kind where id = v.id;
  perform app.log('帰宅', lpad(v.no::text, 3, '0') || ' ' || p_kind);
  return jsonb_build_object('ok', true, 'already', false);
end $$;

create or replace function public.reopen_visitor(p_pass text, p_visitor_id uuid) returns jsonb
language plpgsql security definer set search_path = app, public as $$
begin
  perform app.require_operator(p_pass);
  update app.visitor set status = 'in', leave_kind = null where id = p_visitor_id;
  if not found then raise exception 'E_NOT_FOUND: 相談者が見つかりません'; end if;
  perform app.log('帰宅を取り消し', app.visitor_no(p_visitor_id));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- 公開 RPC: 管理

create or replace function public.upsert_desk(
  p_pass text, p_id int, p_name text, p_booths int, p_active boolean, p_sort int
) returns jsonb
language plpgsql security definer set search_path = app, public as $$
declare v_id int := p_id;
begin
  perform app.require_operator(p_pass);
  if length(btrim(coalesce(p_name, ''))) not between 1 and 40 then raise exception 'E_INPUT: 相談先名を1〜40文字で入力してください'; end if;
  if p_booths not between 1 and 10 then raise exception 'E_INPUT: ブース数は1〜10です'; end if;
  if p_id is null then
    insert into app.desk (name, booths, active, sort) values (btrim(p_name), p_booths, coalesce(p_active, true), coalesce(p_sort, 0))
      returning id into v_id;
  else
    if p_booths < (select count(*) from app.ticket where desk_id = p_id and status = 'serving' and booth > p_booths) then
      raise exception 'E_BOOTH_BUSY: 減らそうとしているブースで相談中の人がいます';
    end if;
    update app.desk set name = btrim(p_name), booths = p_booths, active = coalesce(p_active, active), sort = coalesce(p_sort, sort)
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
create or replace function public.purge_all(p_pass text, p_confirm text, p_revoke_passcodes boolean default false) returns jsonb
language plpgsql security definer set search_path = app, public as $$
declare n int;
begin
  perform app.require_operator(p_pass);
  if p_confirm is distinct from '全データを削除' then raise exception 'E_CONFIRM: 確認の文字が一致しません'; end if;
  select count(*) into n from app.visitor;
  delete from app.ticket;
  delete from app.visitor;
  delete from app.op_log;
  if p_revoke_passcodes then update app.config set op_hash = null, view_hash = null; end if;
  return jsonb_build_object('ok', true, 'deletedVisitors', n);
end $$;

-- ---------------------------------------------------------------- 初期データ(相談先14団体)

insert into app.desk (name, booths, sort)
select * from (values
  ('熊本県信用組合', 1, 10), ('天草信用金庫', 1, 20), ('熊本中央信用金庫', 1, 30),
  ('熊本第一信用金庫', 1, 40), ('熊本信用金庫', 1, 50), ('熊本弁護士会', 2, 60),
  ('肥後銀行', 1, 70), ('熊本銀行', 1, 80), ('住宅金融支援機構', 1, 90),
  ('九州労働金庫', 1, 100), ('JA八代', 1, 110), ('八代市', 1, 120),
  ('建築士事務所協会', 2, 130), ('賃貸住宅経営者協会', 1, 140)
) as v(name, booths, sort)
where not exists (select 1 from app.desk);
