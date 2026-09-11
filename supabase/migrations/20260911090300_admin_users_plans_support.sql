-- Пользователи, тарифы, заметки и поддержка в реальном времени.
--
-- Тариф здесь - набор лимитов и состав услуги, а не цена решения. Цена
-- решения по-прежнему живёт в src/lib/solutionPricing.ts и её зеркале в
-- базе (правило CLAUDE.md), тариф её не трогает. Он задаёт дневной предел
-- решений, который читает решатель, и выдаётся вручную из админки, пока
-- нет платёжного провайдера. «Дата следующего списания» - срок тарифа.

-- ---------------------------------------------------------------------------
-- 1. Тарифы
-- ---------------------------------------------------------------------------

create table if not exists private.plans (
  id text primary key,
  title text not null,
  description text not null default '',
  price_kopecks integer not null default 0,
  period_days integer not null default 30,
  daily_solve_limit integer,
  features jsonb not null default '[]'::jsonb,
  is_default boolean not null default false,
  active boolean not null default true,
  sort integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint plans_id_format check (id ~ '^[a-z0-9_-]{2,40}$'),
  constraint plans_title_length check (char_length(title) between 1 and 80),
  constraint plans_price_range check (price_kopecks between 0 and 10000000),
  constraint plans_period_range check (period_days between 1 and 3650),
  constraint plans_limit_range check (daily_solve_limit is null or daily_solve_limit between 0 and 10000),
  constraint plans_features_array check (jsonb_typeof(features) = 'array')
);

create unique index if not exists plans_single_default_idx on private.plans (is_default) where is_default;

-- Базовый тариф повторяет то, что уже зашито в решатель: 60 решений в сутки.
insert into private.plans (id, title, description, price_kopecks, period_days, daily_solve_limit, features, is_default, sort)
values (
  'base', 'Базовый', 'Оплата за каждое решение с баланса.', 0, 30, 60,
  '["Решение задачи от 4 ₽", "ИИ-чат с оплатой по факту", "Расписание уроков"]'::jsonb, true, 0
)
on conflict (id) do nothing;

create table if not exists private.user_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null references private.plans(id) on delete restrict,
  started_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  source text not null default 'admin',
  granted_by uuid,
  note text,
  constraint user_plans_source_known check (source in ('admin', 'promo', 'payment'))
);

create index if not exists user_plans_user_idx on private.user_plans (user_id, started_at desc);
create unique index if not exists user_plans_active_idx on private.user_plans (user_id) where revoked_at is null;

alter table private.plans enable row level security;
alter table private.user_plans enable row level security;
revoke all on table private.plans, private.user_plans from public, anon, authenticated;

-- Действующий тариф: выданный и не истёкший, иначе тариф по умолчанию.
create or replace function private.effective_plan(p_user_id uuid)
returns private.plans
language sql
stable
security definer
set search_path = ''
as $$
  select p.*
  from private.plans p
  where p.id = coalesce(
    (
      select up.plan_id
      from private.user_plans up
      join private.plans pl on pl.id = up.plan_id and pl.active
      where up.user_id = p_user_id
        and up.revoked_at is null
        and (up.expires_at is null or up.expires_at > now())
      limit 1
    ),
    (select id from private.plans where is_default limit 1)
  );
$$;

revoke all on function private.effective_plan(uuid) from public, anon, authenticated;

-- Тариф ученика для личного кабинета.
create or replace function public.get_my_plan()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  plan private.plans;
  grant_row private.user_plans%rowtype;
begin
  if current_user_id is null then
    return null;
  end if;
  plan := private.effective_plan(current_user_id);
  select * into grant_row
  from private.user_plans
  where user_id = current_user_id and revoked_at is null and (expires_at is null or expires_at > now())
  limit 1;
  return jsonb_build_object(
    'id', plan.id,
    'title', plan.title,
    'description', plan.description,
    'features', plan.features,
    'dailySolveLimit', plan.daily_solve_limit,
    'expiresAt', grant_row.expires_at
  );
end;
$$;

revoke all on function public.get_my_plan() from public, anon;
grant execute on function public.get_my_plan() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Заметки администратора о пользователе
-- ---------------------------------------------------------------------------

create table if not exists private.admin_user_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists admin_user_notes_user_idx on private.admin_user_notes (user_id, created_at desc);
alter table private.admin_user_notes enable row level security;
revoke all on table private.admin_user_notes from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Список пользователей: серверная пагинация, сортировка, фильтры
-- ---------------------------------------------------------------------------

create or replace function public.admin_users_list(
  p_search text default '',
  p_filters jsonb default '{}'::jsonb,
  p_sort text default 'last_seen',
  p_dir text default 'desc',
  p_page integer default 1,
  p_page_size integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_size integer := greatest(1, least(coalesce(p_page_size, 50), 5000));
  safe_page integer := greatest(1, coalesce(p_page, 1));
  search text := trim(coalesce(p_search, ''));
  filters jsonb := coalesce(p_filters, '{}'::jsonb);
  descending boolean := lower(coalesce(p_dir, 'desc')) <> 'asc';
  result jsonb;
begin
  perform private.require_admin('support');

  with base as (
    select
      p.id,
      au.email,
      p.full_name,
      p.grade,
      p.created_at,
      p.last_seen_at,
      coalesce(w.balance, 0) as balance,
      coalesce(ac.is_banned, false) and (ac.banned_until is null or ac.banned_until > now()) as is_banned,
      ac.banned_until,
      ep.id as plan_id,
      ep.title as plan_title,
      (select count(*)::integer from public.homework_solution_access a where a.user_id = p.id) as tasks,
      exists (select 1 from private.verified_balance_top_ups t where t.user_id = p.id) as paid,
      coalesce((select sum(t.amount)::integer from private.verified_balance_top_ups t where t.user_id = p.id), 0) as paid_total,
      (select count(*)::integer from private.fraud_flags f where f.user_id = p.id and f.status = 'open') as open_flags,
      (select f.risk from private.fraud_flags f where f.user_id = p.id and f.status = 'open'
        order by case f.risk when 'high' then 3 when 'medium' then 2 else 1 end desc limit 1) as max_risk
    from public.profiles p
    join auth.users au on au.id = p.id
    left join public.wallet_accounts w on w.user_id = p.id
    left join public.account_controls ac on ac.user_id = p.id
    left join lateral (select * from private.effective_plan(p.id)) ep on true
    where search = ''
      or au.email ilike '%' || search || '%'
      or p.full_name ilike '%' || search || '%'
      or p.id::text = search
  ),
  filtered as (
    select * from base t
    where not (
         (filters ? 'plan' and coalesce(t.plan_id, '') <> filters ->> 'plan')
      or (filters ? 'registeredFrom' and t.created_at < (filters ->> 'registeredFrom')::timestamptz)
      or (filters ? 'registeredTo' and t.created_at >= ((filters ->> 'registeredTo')::date + 1)::timestamptz)
      or (filters ? 'balanceMin' and t.balance < (filters ->> 'balanceMin')::integer)
      or (filters ? 'balanceMax' and t.balance > (filters ->> 'balanceMax')::integer)
      or (filters ->> 'fraud' = 'true' and t.open_flags = 0)
      or (filters ->> 'banned' = 'true' and not t.is_banned)
      or (filters ->> 'banned' = 'false' and t.is_banned)
      or (filters ->> 'paid' = 'yes' and not t.paid)
      or (filters ->> 'paid' = 'no' and t.paid)
    )
  ),
  ranked as (
    select
      jsonb_build_object(
        'id', t.id, 'email', t.email, 'fullName', t.full_name, 'grade', t.grade,
        'createdAt', t.created_at, 'lastSeenAt', t.last_seen_at, 'balance', t.balance,
        'isBanned', t.is_banned, 'bannedUntil', t.banned_until,
        'planId', t.plan_id, 'planTitle', t.plan_title, 'tasks', t.tasks,
        'paid', t.paid, 'paidTotal', t.paid_total, 'openFlags', t.open_flags, 'maxRisk', t.max_risk,
        'status', case when t.is_banned then 'banned' when t.open_flags > 0 then 'fraud' else 'active' end
      ) as row_json,
      row_number() over (
        order by
          case when not descending then case p_sort
            when 'created' then extract(epoch from t.created_at)
            when 'balance' then t.balance
            when 'tasks' then t.tasks
            when 'paid' then t.paid_total
            else extract(epoch from coalesce(t.last_seen_at, t.created_at)) end end asc nulls last,
          case when descending then case p_sort
            when 'created' then extract(epoch from t.created_at)
            when 'balance' then t.balance
            when 'tasks' then t.tasks
            when 'paid' then t.paid_total
            else extract(epoch from coalesce(t.last_seen_at, t.created_at)) end end desc nulls last,
          case when p_sort = 'email' and not descending then t.email end asc,
          case when p_sort = 'email' and descending then t.email end desc,
          t.id
      ) as ord
    from filtered t
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'page', safe_page,
    'pageSize', safe_size,
    'items', coalesce((
      select jsonb_agg(row_json order by ord) from ranked
      where ord > (safe_page - 1) * safe_size and ord <= safe_page * safe_size
    ), '[]'::jsonb),
    'plans', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title) order by sort, id), '[]'::jsonb) from private.plans)
  ) into result;

  return result;
end;
$$;

revoke all on function public.admin_users_list(text, jsonb, text, text, integer, integer) from public, anon;
grant execute on function public.admin_users_list(text, jsonb, text, text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Блокировка со сроком, лимит, тариф, заметки
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_user_ban(
  p_user_id uuid,
  p_is_banned boolean,
  p_reason text default null,
  p_until timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_admin('admin');
  normalized_reason text := nullif(trim(coalesce(p_reason, '')), '');
  previous public.account_controls%rowtype;
begin
  if p_user_id = actor_id and p_is_banned then
    raise exception 'an administrator cannot block their own account' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
  if p_is_banned and char_length(coalesce(normalized_reason, '')) not between 3 and 500 then
    raise exception 'block reason must contain 3 to 500 characters' using errcode = '22023';
  end if;
  if p_is_banned and p_until is not null and p_until <= now() then
    raise exception 'block end must be in the future' using errcode = '22023';
  end if;

  select * into previous from public.account_controls where user_id = p_user_id;

  insert into public.account_controls (user_id, is_banned, ban_reason, banned_at, banned_by, banned_until, updated_at)
  values (
    p_user_id, p_is_banned,
    case when p_is_banned then normalized_reason end,
    case when p_is_banned then now() end,
    case when p_is_banned then actor_id end,
    case when p_is_banned then p_until end,
    now()
  )
  on conflict (user_id) do update
  set is_banned = excluded.is_banned,
      ban_reason = excluded.ban_reason,
      banned_at = excluded.banned_at,
      banned_by = excluded.banned_by,
      banned_until = excluded.banned_until,
      updated_at = excluded.updated_at;

  perform private.audit(
    case when p_is_banned then 'user_banned' else 'user_unbanned' end,
    p_user_id,
    jsonb_build_object('reason', normalized_reason, 'until', p_until),
    jsonb_build_object('isBanned', coalesce(previous.is_banned, false), 'reason', previous.ban_reason, 'until', previous.banned_until),
    jsonb_build_object('isBanned', p_is_banned, 'reason', case when p_is_banned then normalized_reason end, 'until', case when p_is_banned then p_until end)
  );

  return jsonb_build_object('userId', p_user_id, 'isBanned', p_is_banned, 'reason', normalized_reason, 'until', p_until);
end;
$$;

drop function if exists public.admin_set_user_ban(uuid, boolean, text);
revoke all on function public.admin_set_user_ban(uuid, boolean, text, timestamptz) from public, anon;
grant execute on function public.admin_set_user_ban(uuid, boolean, text, timestamptz) to authenticated;

create or replace function public.admin_set_user_limit(p_user_id uuid, p_limit integer, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous public.account_controls%rowtype;
begin
  perform private.require_admin('admin');
  if p_limit is not null and p_limit not between 0 and 1000 then
    raise exception 'limit must be between 0 and 1000' using errcode = '22023';
  end if;
  select * into previous from public.account_controls where user_id = p_user_id;
  insert into public.account_controls (user_id, daily_solve_limit, limit_reason, updated_at)
  values (p_user_id, p_limit, case when p_limit is null then null else nullif(left(trim(coalesce(p_reason, '')), 300), '') end, now())
  on conflict (user_id) do update
  set daily_solve_limit = excluded.daily_solve_limit, limit_reason = excluded.limit_reason, updated_at = now();
  perform private.audit('user_limit_changed', p_user_id, jsonb_build_object('reason', p_reason),
    jsonb_build_object('dailySolveLimit', previous.daily_solve_limit), jsonb_build_object('dailySolveLimit', p_limit));
  return jsonb_build_object('userId', p_user_id, 'dailySolveLimit', p_limit);
end;
$$;

create or replace function public.admin_set_user_plan(
  p_user_id uuid,
  p_plan_id text,
  p_expires_at timestamptz default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin('admin');
  previous private.user_plans%rowtype;
begin
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
  if p_plan_id is not null and not exists (select 1 from private.plans where id = p_plan_id and active) then
    raise exception 'plan not found' using errcode = 'P0002';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'plan end must be in the future' using errcode = '22023';
  end if;

  select * into previous from private.user_plans where user_id = p_user_id and revoked_at is null for update;
  update private.user_plans set revoked_at = now() where user_id = p_user_id and revoked_at is null;

  if p_plan_id is not null then
    insert into private.user_plans (user_id, plan_id, expires_at, granted_by, note)
    values (p_user_id, p_plan_id, p_expires_at, actor, nullif(left(trim(coalesce(p_note, '')), 300), ''));
  end if;

  perform private.audit(
    case when p_plan_id is null then 'user_plan_revoked' else 'user_plan_granted' end,
    p_user_id,
    jsonb_build_object('note', p_note),
    jsonb_build_object('planId', previous.plan_id, 'expiresAt', previous.expires_at),
    jsonb_build_object('planId', p_plan_id, 'expiresAt', p_expires_at)
  );
  return jsonb_build_object('userId', p_user_id, 'planId', p_plan_id, 'expiresAt', p_expires_at);
end;
$$;

create or replace function public.admin_user_note(p_action text, p_user_id uuid default null, p_body text default null, p_note_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin('support');
  note_id uuid;
  removed private.admin_user_notes%rowtype;
begin
  if p_action = 'add' then
    if char_length(trim(coalesce(p_body, ''))) not between 1 and 2000 then
      raise exception 'note must contain 1 to 2000 characters' using errcode = '22023';
    end if;
    insert into private.admin_user_notes (user_id, author_id, body)
    values (p_user_id, actor, trim(p_body))
    returning id into note_id;
    perform private.audit('user_note_added', p_user_id, jsonb_build_object('noteId', note_id), null, jsonb_build_object('body', trim(p_body)));
    return jsonb_build_object('id', note_id);
  elsif p_action = 'delete' then
    delete from private.admin_user_notes where id = p_note_id returning * into removed;
    if removed.id is null then
      raise exception 'note not found' using errcode = 'P0002';
    end if;
    perform private.audit('user_note_deleted', removed.user_id, jsonb_build_object('noteId', p_note_id), jsonb_build_object('body', removed.body), null);
    return jsonb_build_object('deleted', true);
  end if;
  raise exception 'unknown note action' using errcode = '22023';
end;
$$;

-- Действия, которые выполняет функция на Vercel (вход под пользователем,
-- письмо сброса пароля): журнал пишется от лица администратора.
create or replace function public.admin_record_external_action(p_event text, p_target_user_id uuid, p_payload jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_event not in ('user_impersonated', 'password_reset_sent') then
    raise exception 'unknown external action' using errcode = '22023';
  end if;
  perform private.require_admin('admin');
  return private.audit(p_event, p_target_user_id, coalesce(p_payload, '{}'::jsonb));
end;
$$;

-- Массовые действия по выбранным строкам.
create or replace function public.admin_users_bulk(p_user_ids uuid[], p_action text, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
  done integer := 0;
  failed jsonb := '[]'::jsonb;
  amount integer := (p_payload ->> 'amount')::integer;
begin
  perform private.require_admin('admin');
  if coalesce(array_length(p_user_ids, 1), 0) = 0 or array_length(p_user_ids, 1) > 500 then
    raise exception 'select 1 to 500 users' using errcode = '22023';
  end if;
  if p_action not in ('ban', 'unban', 'credit') then
    raise exception 'unknown bulk action' using errcode = '22023';
  end if;

  foreach target in array p_user_ids loop
    begin
      if p_action = 'ban' then
        perform public.admin_set_user_ban(target, true, p_payload ->> 'reason', nullif(p_payload ->> 'until', '')::timestamptz);
      elsif p_action = 'unban' then
        perform public.admin_set_user_ban(target, false, null, null);
      else
        perform public.admin_adjust_balance(target, amount, p_payload ->> 'reason');
      end if;
      done := done + 1;
    exception when others then
      failed := failed || jsonb_build_object('userId', target, 'error', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('done', done, 'failed', failed);
end;
$$;

revoke all on function public.admin_set_user_limit(uuid, integer, text) from public, anon;
grant execute on function public.admin_set_user_limit(uuid, integer, text) to authenticated;
revoke all on function public.admin_set_user_plan(uuid, text, timestamptz, text) from public, anon;
grant execute on function public.admin_set_user_plan(uuid, text, timestamptz, text) to authenticated;
revoke all on function public.admin_user_note(text, uuid, text, uuid) from public, anon;
grant execute on function public.admin_user_note(text, uuid, text, uuid) to authenticated;
revoke all on function public.admin_record_external_action(text, uuid, jsonb) from public, anon;
grant execute on function public.admin_record_external_action(text, uuid, jsonb) to authenticated;
revoke all on function public.admin_users_bulk(uuid[], text, jsonb) from public, anon;
grant execute on function public.admin_users_bulk(uuid[], text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Карточка пользователя
-- ---------------------------------------------------------------------------

create or replace function public.admin_user_card(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  role_name text;
  plan private.plans;
  result jsonb;
begin
  perform private.require_admin('support');
  role_name := private.current_admin_role();

  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'user not found' using errcode = 'P0002';
  end if;

  plan := private.effective_plan(p_user_id);

  select jsonb_build_object(
    'profile', (
      select jsonb_build_object(
        'id', p.id, 'email', u.email, 'fullName', p.full_name, 'grade', p.grade,
        'createdAt', p.created_at, 'lastSeenAt', p.last_seen_at, 'lastSignInAt', u.last_sign_in_at,
        'emailConfirmedAt', u.email_confirmed_at,
        'providers', coalesce(u.raw_app_meta_data -> 'providers', '[]'::jsonb),
        'isAdmin', exists (select 1 from private.admin_users a where a.user_id = p.id)
      )
      from public.profiles p join auth.users u on u.id = p.id where p.id = p_user_id
    ),
    'controls', (
      select jsonb_build_object(
        'isBanned', coalesce(ac.is_banned, false) and (ac.banned_until is null or ac.banned_until > now()),
        'banReason', ac.ban_reason, 'bannedAt', ac.banned_at, 'bannedUntil', ac.banned_until,
        'dailySolveLimit', ac.daily_solve_limit, 'limitReason', ac.limit_reason
      )
      from (select 1) x left join public.account_controls ac on ac.user_id = p_user_id
    ),
    'wallet', jsonb_build_object(
      'balance', coalesce((select balance from public.wallet_accounts where user_id = p_user_id), 0),
      'credited', coalesce((select sum(amount) from public.wallet_entries where user_id = p_user_id and amount > 0), 0),
      'debited', coalesce((select sum(-amount) from public.wallet_entries where user_id = p_user_id and amount < 0), 0),
      'entries', coalesce((
        select jsonb_agg(jsonb_build_object('id', e.id, 'amount', e.amount, 'kind', e.kind, 'description', e.description, 'key', e.idempotency_key, 'createdAt', e.created_at) order by e.created_at desc)
        from (select * from public.wallet_entries where user_id = p_user_id order by created_at desc limit 100) e
      ), '[]'::jsonb)
    ),
    'plan', jsonb_build_object(
      'current', jsonb_build_object('id', plan.id, 'title', plan.title, 'dailySolveLimit', plan.daily_solve_limit, 'priceKopecks', plan.price_kopecks),
      'grant', (
        select jsonb_build_object('planId', up.plan_id, 'startedAt', up.started_at, 'expiresAt', up.expires_at, 'note', up.note)
        from private.user_plans up where up.user_id = p_user_id and up.revoked_at is null limit 1
      ),
      'history', coalesce((
        select jsonb_agg(jsonb_build_object('planId', up.plan_id, 'startedAt', up.started_at, 'expiresAt', up.expires_at, 'revokedAt', up.revoked_at, 'source', up.source) order by up.started_at desc)
        from private.user_plans up where up.user_id = p_user_id
      ), '[]'::jsonb),
      'available', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title) order by sort, id), '[]'::jsonb) from private.plans where active)
    ),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'amount', t.amount, 'reference', t.provider_reference, 'source', t.source, 'createdAt', t.created_at,
        'refunded', coalesce((select sum(r.amount) from private.top_up_refunds r where r.top_up_id = t.id), 0)
      ) order by t.created_at desc)
      from private.verified_balance_top_ups t where t.user_id = p_user_id
    ), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(row_json order by created_at desc)
      from (
        select j.created_at, jsonb_build_object(
          'key', j.idempotency_key, 'subject', j.subject, 'grade', j.grade, 'source', j.source, 'task', j.task,
          'preview', j.condition_preview, 'status', j.status, 'stage', j.stage, 'error', j.error,
          'createdAt', j.created_at, 'finishedAt', j.finished_at,
          'logId', (select l.id from private.solution_logs l where l.idempotency_key = j.idempotency_key and l.user_id = p_user_id order by l.created_at desc limit 1),
          'costKopecks', (select sum(c.cost_kopecks) from private.solution_costs c where c.idempotency_key = j.idempotency_key and c.user_id = p_user_id)
        ) as row_json
        from public.homework_jobs j where j.user_id = p_user_id
        order by j.created_at desc limit 50
      ) jobs
    ), '[]'::jsonb),
    'economics', jsonb_build_object(
      'solutionCostKopecks', coalesce((select sum(cost_kopecks) from private.solution_costs where user_id = p_user_id), 0),
      'chatCostKopecks', coalesce((select sum(provider_cost_kopecks) from public.chat_generations where user_id = p_user_id), 0),
      'chatChargedKopecks', coalesce((select sum(charged_kopecks) from public.chat_generations where user_id = p_user_id), 0),
      'solutionChargedKopecks', coalesce((
        select sum(-e.amount) from public.wallet_entries e
        where e.user_id = p_user_id and e.kind = 'debit'
          and not exists (select 1 from public.wallet_entries r where r.user_id = e.user_id and r.idempotency_key = left(e.idempotency_key || ':refund', 160))
          and e.idempotency_key not like '%:settle'
      ), 0),
      'paidKopecks', coalesce((select sum(amount) from private.verified_balance_top_ups where user_id = p_user_id), 0),
      'refundedKopecks', coalesce((select sum(amount) from private.top_up_refunds where user_id = p_user_id), 0)
    ),
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object('ip', d.ip, 'userAgent', d.user_agent, 'deviceId', d.device_id, 'hits', d.hits, 'firstSeenAt', d.first_seen_at, 'lastSeenAt', d.last_seen_at) order by d.last_seen_at desc)
      from (select * from private.user_devices where user_id = p_user_id order by last_seen_at desc limit 50) d
    ), '[]'::jsonb),
    'activity', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'event', a.event_type, 'path', a.path, 'createdAt', a.created_at) order by a.created_at desc)
      from (select * from private.user_activity_events where user_id = p_user_id order by created_at desc limit 50) a
    ), '[]'::jsonb),
    'linked', coalesce((
      select jsonb_agg(jsonb_build_object('userId', l.other, 'email', u.email, 'via', l.via, 'value', l.value, 'isBanned', coalesce(ac.is_banned, false)))
      from (
        select distinct b.user_id as other, 'ip' as via, a.ip as value
        from private.user_devices a
        join private.user_devices b on b.ip = a.ip and b.user_id is not null and b.user_id <> a.user_id
        where a.user_id = p_user_id and a.ip is not null
        union
        select distinct b.user_id, 'device', a.device_id
        from (
          select user_id, device_id from public.homework_jobs where user_id = p_user_id and device_id <> ''
          union select user_id, device_id from private.user_devices where user_id = p_user_id and device_id is not null
          union select user_id, device_id from private.welcome_grants where user_id = p_user_id
        ) a
        join (
          select user_id, device_id from public.homework_jobs where user_id is not null and device_id <> ''
          union select user_id, device_id from private.user_devices where user_id is not null and device_id is not null
          union select user_id, device_id from private.welcome_grants
        ) b on b.device_id = a.device_id and b.user_id <> p_user_id
        limit 100
      ) l
      join auth.users u on u.id = l.other
      left join public.account_controls ac on ac.user_id = l.other
    ), '[]'::jsonb),
    'tickets', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'subject', c.subject, 'category', c.category, 'status', c.status, 'updatedAt', c.updated_at) order by c.updated_at desc)
      from public.support_conversations c where c.user_id = p_user_id
    ), '[]'::jsonb),
    'flags', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'ruleId', f.rule_id, 'risk', f.risk, 'explanation', f.explanation, 'status', f.status, 'createdAt', f.created_at) order by f.created_at desc)
      from private.fraud_flags f where f.user_id = p_user_id
    ), '[]'::jsonb),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'body', n.body, 'authorEmail', u.email, 'createdAt', n.created_at) order by n.created_at desc)
      from private.admin_user_notes n left join auth.users u on u.id = n.author_id
      where n.user_id = p_user_id
    ), '[]'::jsonb),
    'audit', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'event', l.event_type, 'actorEmail', u.email, 'before', l.before_value, 'after', l.after_value, 'payload', l.payload, 'createdAt', l.created_at) order by l.created_at desc)
      from (select * from private.admin_audit_log where target_user_id = p_user_id order by created_at desc limit 50) l
      left join auth.users u on u.id = l.actor_id
    ), '[]'::jsonb),
    'viewerRole', role_name
  ) into result;

  return result;
end;
$$;

revoke all on function public.admin_user_card(uuid) from public, anon;
grant execute on function public.admin_user_card(uuid) to authenticated;

-- Полный лог решения: запрос к модели, ответ, замечания проверки.
create or replace function public.admin_solution_log(p_log_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform private.require_admin('support');
  select to_jsonb(l) || jsonb_build_object('email', u.email) into result
  from private.solution_logs l
  left join auth.users u on u.id = l.user_id
  where l.id = p_log_id;
  if result is null then
    raise exception 'log not found' using errcode = 'P0002';
  end if;
  return result;
end;
$$;

revoke all on function public.admin_solution_log(uuid) from public, anon;
grant execute on function public.admin_solution_log(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Поддержка: приоритет, назначенный, прочтение, оценка, заметки, шаблоны
-- ---------------------------------------------------------------------------

alter table public.support_conversations
  add column if not exists priority text not null default 'normal',
  add column if not exists assigned_to uuid references auth.users(id) on delete set null,
  add column if not exists first_response_at timestamptz,
  add column if not exists last_user_message_at timestamptz,
  add column if not exists user_last_read_at timestamptz,
  add column if not exists owner_last_read_at timestamptz,
  add column if not exists rating smallint,
  add column if not exists rating_comment text,
  add column if not exists rated_at timestamptz;

alter table public.support_conversations drop constraint if exists support_conversations_priority_known;
alter table public.support_conversations
  add constraint support_conversations_priority_known check (priority in ('low', 'normal', 'high', 'urgent'));
alter table public.support_conversations drop constraint if exists support_conversations_rating_range;
alter table public.support_conversations
  add constraint support_conversations_rating_range check (rating is null or rating between 1 and 5);

update public.support_conversations c
set last_user_message_at = (select max(m.created_at) from public.support_messages m where m.conversation_id = c.id and m.author_type = 'user')
where last_user_message_at is null;

-- Ответ из админки подписан администратором; ответ из Telegram - нет.
alter table public.support_messages drop constraint if exists support_messages_author_shape;
alter table public.support_messages
  add constraint support_messages_author_shape check (
    (author_type = 'user' and author_user_id is not null)
    or author_type = 'owner'
  );

-- Отметка времени последнего сообщения ученика и первого ответа.
create or replace function private.support_message_stamps()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.author_type = 'user' then
    update public.support_conversations
    set last_user_message_at = new.created_at, user_last_read_at = new.created_at
    where id = new.conversation_id;
  else
    update public.support_conversations
    set first_response_at = coalesce(first_response_at, new.created_at),
        owner_last_read_at = new.created_at
    where id = new.conversation_id;
  end if;
  return new;
end;
$$;

revoke all on function private.support_message_stamps() from public, anon, authenticated;
drop trigger if exists support_messages_stamps on public.support_messages;
create trigger support_messages_stamps
  after insert on public.support_messages
  for each row execute function private.support_message_stamps();

create table if not exists private.support_notes (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  body text not null check (char_length(body) between 1 and 8000),
  attachment jsonb,
  created_at timestamptz not null default now()
);

create index if not exists support_notes_conversation_idx on private.support_notes (conversation_id, created_at);

create table if not exists private.support_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 80),
  body text not null check (char_length(body) between 1 and 4000),
  sort integer not null default 0,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

insert into private.support_templates (title, body, sort)
select * from (values
  ('Приветствие', 'Здравствуйте, {{name}}! Спасибо, что написали. Уже смотрю ваш вопрос.', 0),
  ('Проверили баланс', '{{name}}, проверил историю операций: сейчас на балансе {{balance}}. Если какое-то списание кажется лишним, напишите дату и сумму - разберёмся.', 1),
  ('Неверное решение', '{{name}}, спасибо за сигнал. Разбираю задачу «{{lastTask}}». Если решение действительно неверное, вернём деньги на баланс.', 2),
  ('Закрываем', 'Вопрос решён - закрываю обращение. Если что-то ещё понадобится, просто напишите сюда же.', 3)
) as seed(title, body, sort)
where not exists (select 1 from private.support_templates);

alter table private.support_notes enable row level security;
alter table private.support_templates enable row level security;
revoke all on table private.support_notes, private.support_templates from public, anon, authenticated;

-- Админ со вторым фактором читает обращения напрямую: так до него доходит
-- Realtime (postgres_changes уважает RLS).
create or replace function public.is_support_agent()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.admin_users where user_id = (select auth.uid()))
    and private.current_aal() = 'aal2';
$$;

revoke all on function public.is_support_agent() from public, anon;
grant execute on function public.is_support_agent() to authenticated;

drop policy if exists support_conversations_select_agent on public.support_conversations;
create policy support_conversations_select_agent
  on public.support_conversations for select to authenticated
  using ((select public.is_support_agent()));

drop policy if exists support_messages_select_agent on public.support_messages;
create policy support_messages_select_agent
  on public.support_messages for select to authenticated
  using ((select public.is_support_agent()));

-- Ученик отмечает прочтение и оценивает закрытое обращение.
create or replace function public.mark_support_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.support_conversations
  set user_last_read_at = now()
  where id = p_conversation_id and user_id = (select auth.uid());
end;
$$;

create or replace function public.rate_support_conversation(p_conversation_id uuid, p_rating integer, p_comment text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  conversation public.support_conversations%rowtype;
begin
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'rating must be between 1 and 5' using errcode = '22023';
  end if;
  select * into conversation from public.support_conversations
  where id = p_conversation_id and user_id = (select auth.uid()) for update;
  if conversation.id is null then
    raise exception 'support conversation not found' using errcode = 'P0002';
  end if;
  if conversation.status <> 'resolved' then
    raise exception 'conversation is not resolved' using errcode = '22023';
  end if;
  update public.support_conversations
  set rating = p_rating, rating_comment = nullif(left(trim(coalesce(p_comment, '')), 500), ''), rated_at = now()
  where id = p_conversation_id;
  return jsonb_build_object('rating', p_rating);
end;
$$;

revoke all on function public.mark_support_read(uuid) from public, anon;
grant execute on function public.mark_support_read(uuid) to authenticated;
revoke all on function public.rate_support_conversation(uuid, integer, text) from public, anon;
grant execute on function public.rate_support_conversation(uuid, integer, text) to authenticated;

-- Настройки, которые читает админка и поддержка (SLA и прочие пороги).
create table if not exists private.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

insert into private.app_settings (key, value) values
  ('support_sla_minutes', '30'::jsonb),
  ('error_alert_users', '5'::jsonb),
  ('error_alert_window_minutes', '10'::jsonb),
  ('error_spike_hourly', '20'::jsonb)
on conflict (key) do nothing;

alter table private.app_settings enable row level security;
revoke all on table private.app_settings from public, anon, authenticated;

create or replace function private.setting_int(p_key text, p_default integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (value #>> '{}')::integer from private.app_settings where key = p_key), p_default);
$$;

revoke all on function private.setting_int(text, integer) from public, anon, authenticated;

create or replace function public.admin_support_inbox(
  p_status text default null,
  p_assignee text default null,
  p_priority text default null,
  p_search text default '',
  p_page integer default 1,
  p_page_size integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin('support');
  sla integer := private.setting_int('support_sla_minutes', 30);
  safe_size integer := greatest(1, least(coalesce(p_page_size, 50), 200));
  safe_page integer := greatest(1, coalesce(p_page, 1));
  search text := trim(coalesce(p_search, ''));
  total integer;
begin
  select count(*) into total
  from public.support_conversations c
  join auth.users u on u.id = c.user_id
  left join public.profiles p on p.id = c.user_id
  where (p_status is null or p_status = 'all'
      or (p_status = 'open' and c.status <> 'resolved')
      or c.status = p_status)
    and (p_assignee is null or (p_assignee = 'me' and c.assigned_to = actor) or (p_assignee = 'none' and c.assigned_to is null) or c.assigned_to::text = p_assignee)
    and (p_priority is null or c.priority = p_priority)
    and (search = '' or u.email ilike '%' || search || '%' or p.full_name ilike '%' || search || '%' or c.subject ilike '%' || search || '%');

  return jsonb_build_object(
    'total', total,
    'page', safe_page,
    'pageSize', safe_size,
    'slaMinutes', sla,
    'agents', (
      select coalesce(jsonb_agg(jsonb_build_object('id', a.user_id, 'email', u.email, 'role', a.role)), '[]'::jsonb)
      from private.admin_users a join auth.users u on u.id = a.user_id
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'userId', c.user_id, 'email', u.email, 'fullName', p.full_name,
        'category', c.category, 'subject', c.subject, 'status', c.status, 'priority', c.priority,
        'assignedTo', c.assigned_to, 'assignedEmail', au.email,
        'createdAt', c.created_at, 'updatedAt', c.updated_at, 'lastMessageAt', c.last_message_at,
        'lastUserMessageAt', c.last_user_message_at, 'firstResponseAt', c.first_response_at,
        'ownerLastReadAt', c.owner_last_read_at,
        'rating', c.rating,
        'lastMessage', (select m.body from public.support_messages m where m.conversation_id = c.id order by m.created_at desc limit 1),
        'lastAuthor', (select m.author_type from public.support_messages m where m.conversation_id = c.id order by m.created_at desc limit 1),
        'unread', (select count(*) from public.support_messages m where m.conversation_id = c.id and m.author_type = 'user' and m.created_at > coalesce(c.owner_last_read_at, '-infinity'::timestamptz)),
        'waitingMinutes', case when c.status = 'pending_owner' and c.last_user_message_at is not null
          then floor(extract(epoch from (now() - c.last_user_message_at)) / 60)::integer end,
        'slaBreached', c.status = 'pending_owner' and c.last_user_message_at < now() - make_interval(mins => sla)
      ) order by case c.priority when 'urgent' then 4 when 'high' then 3 when 'normal' then 2 else 1 end desc,
               (c.status = 'pending_owner') desc, c.updated_at desc)
      from (
        select c.*
        from public.support_conversations c
        join auth.users u on u.id = c.user_id
        left join public.profiles p on p.id = c.user_id
        where (p_status is null or p_status = 'all'
            or (p_status = 'open' and c.status <> 'resolved')
            or c.status = p_status)
          and (p_assignee is null or (p_assignee = 'me' and c.assigned_to = actor) or (p_assignee = 'none' and c.assigned_to is null) or c.assigned_to::text = p_assignee)
          and (p_priority is null or c.priority = p_priority)
          and (search = '' or u.email ilike '%' || search || '%' or p.full_name ilike '%' || search || '%' or c.subject ilike '%' || search || '%')
        order by case c.priority when 'urgent' then 4 when 'high' then 3 when 'normal' then 2 else 1 end desc,
                 (c.status = 'pending_owner') desc, c.updated_at desc
        limit safe_size offset (safe_page - 1) * safe_size
      ) c
      join auth.users u on u.id = c.user_id
      left join public.profiles p on p.id = c.user_id
      left join auth.users au on au.id = c.assigned_to
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_support_thread(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  conversation public.support_conversations%rowtype;
  plan private.plans;
begin
  perform private.require_admin('support');
  select * into conversation from public.support_conversations where id = p_conversation_id;
  if conversation.id is null then
    raise exception 'support conversation not found' using errcode = 'P0002';
  end if;
  plan := private.effective_plan(conversation.user_id);

  return jsonb_build_object(
    'conversation', to_jsonb(conversation) || jsonb_build_object('slaMinutes', private.setting_int('support_sla_minutes', 30)),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'authorType', m.author_type, 'authorEmail', u.email, 'body', m.body, 'createdAt', m.created_at) order by m.created_at)
      from public.support_messages m left join auth.users u on u.id = m.author_user_id and m.author_type = 'owner'
      where m.conversation_id = p_conversation_id
    ), '[]'::jsonb),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'body', n.body, 'attachment', n.attachment, 'authorEmail', u.email, 'createdAt', n.created_at) order by n.created_at)
      from private.support_notes n left join auth.users u on u.id = n.author_id
      where n.conversation_id = p_conversation_id
    ), '[]'::jsonb),
    'user', (
      select jsonb_build_object(
        'id', p.id, 'email', u.email, 'fullName', p.full_name, 'grade', p.grade,
        'balance', coalesce(w.balance, 0),
        'planTitle', plan.title,
        'isBanned', coalesce(ac.is_banned, false),
        'createdAt', p.created_at
      )
      from public.profiles p join auth.users u on u.id = p.id
      left join public.wallet_accounts w on w.user_id = p.id
      left join public.account_controls ac on ac.user_id = p.id
      where p.id = conversation.user_id
    ),
    'recentTasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', j.idempotency_key, 'subject', j.subject, 'task', j.task, 'preview', j.condition_preview,
        'status', j.status, 'error', j.error, 'createdAt', j.created_at,
        'logId', (select l.id from private.solution_logs l where l.idempotency_key = j.idempotency_key and l.user_id = j.user_id order by l.created_at desc limit 1)
      ) order by j.created_at desc)
      from (select * from public.homework_jobs where user_id = conversation.user_id order by created_at desc limit 5) j
    ), '[]'::jsonb),
    'flags', coalesce((
      select jsonb_agg(jsonb_build_object('ruleId', f.rule_id, 'risk', f.risk, 'explanation', f.explanation, 'status', f.status))
      from private.fraud_flags f where f.user_id = conversation.user_id and f.status in ('open', 'deferred')
    ), '[]'::jsonb),
    'walletEntries', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'amount', e.amount, 'description', e.description, 'createdAt', e.created_at) order by e.created_at desc)
      from (select * from public.wallet_entries where user_id = conversation.user_id order by created_at desc limit 8) e
    ), '[]'::jsonb),
    'ideaApproval', (
      select jsonb_build_object('status', coalesce(d.decision, 'pending'), 'credited', exists (select 1 from private.support_feature_credits fc where fc.conversation_id = p_conversation_id))
      from (select 1) x left join private.support_idea_decisions d on d.conversation_id = p_conversation_id
    ),
    'templates', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'body', t.body) order by t.sort, t.title)
      from private.support_templates t
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_support_reply(p_conversation_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin('support');
  body text := trim(coalesce(p_body, ''));
  message_id uuid;
  conversation public.support_conversations%rowtype;
begin
  if char_length(body) not between 1 and 4000 then
    raise exception 'message must contain 1 to 4000 characters' using errcode = '22023';
  end if;
  select * into conversation from public.support_conversations where id = p_conversation_id for update;
  if conversation.id is null then
    raise exception 'support conversation not found' using errcode = 'P0002';
  end if;

  insert into public.support_messages (conversation_id, author_type, author_user_id, body)
  values (p_conversation_id, 'owner', actor, body)
  returning id into message_id;

  update public.support_conversations
  set status = 'pending_user', updated_at = now(), last_message_at = now(), resolved_at = null,
      assigned_to = coalesce(assigned_to, actor)
  where id = p_conversation_id;

  perform private.audit('support_replied', conversation.user_id, jsonb_build_object('conversationId', p_conversation_id, 'messageId', message_id));
  return jsonb_build_object('messageId', message_id);
end;
$$;

create or replace function public.admin_support_update(
  p_conversation_id uuid,
  p_status text default null,
  p_priority text default null,
  p_assigned_to uuid default null,
  p_unassign boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  conversation public.support_conversations%rowtype;
  updated public.support_conversations%rowtype;
begin
  perform private.require_admin('support');
  if p_status is not null and p_status not in ('pending_owner', 'pending_user', 'resolved') then
    raise exception 'invalid support status' using errcode = '22023';
  end if;
  if p_priority is not null and p_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'invalid support priority' using errcode = '22023';
  end if;
  if p_assigned_to is not null and not exists (select 1 from private.admin_users where user_id = p_assigned_to) then
    raise exception 'assignee is not an administrator' using errcode = '22023';
  end if;

  select * into conversation from public.support_conversations where id = p_conversation_id for update;
  if conversation.id is null then
    raise exception 'support conversation not found' using errcode = 'P0002';
  end if;

  update public.support_conversations
  set status = coalesce(p_status, status),
      resolved_at = case when p_status = 'resolved' then now() when p_status is not null then null else resolved_at end,
      priority = coalesce(p_priority, priority),
      assigned_to = case when p_unassign then null else coalesce(p_assigned_to, assigned_to) end,
      updated_at = now()
  where id = p_conversation_id
  returning * into updated;

  perform private.audit(
    'support_status_changed', conversation.user_id,
    jsonb_build_object('conversationId', p_conversation_id),
    jsonb_build_object('status', conversation.status, 'priority', conversation.priority, 'assignedTo', conversation.assigned_to),
    jsonb_build_object('status', updated.status, 'priority', updated.priority, 'assignedTo', updated.assigned_to)
  );
  return jsonb_build_object('conversationId', p_conversation_id, 'status', updated.status, 'priority', updated.priority, 'assignedTo', updated.assigned_to);
end;
$$;

create or replace function public.admin_support_mark_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin('support');
  update public.support_conversations set owner_last_read_at = now() where id = p_conversation_id;
end;
$$;

-- Внутренняя заметка; вложение - лог задачи одним кликом.
create or replace function public.admin_support_note(p_conversation_id uuid, p_body text default null, p_log_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin('support');
  log_row private.solution_logs%rowtype;
  attachment jsonb;
  body text := trim(coalesce(p_body, ''));
  note_id uuid;
begin
  if p_log_id is not null then
    select * into log_row from private.solution_logs where id = p_log_id;
    if log_row.id is null then
      raise exception 'log not found' using errcode = 'P0002';
    end if;
    attachment := jsonb_build_object(
      'logId', log_row.id, 'subject', log_row.subject, 'task', log_row.task, 'outcome', log_row.outcome,
      'status', log_row.status, 'error', log_row.error, 'models', log_row.models, 'seconds', log_row.seconds,
      'issues', log_row.issues, 'createdAt', log_row.created_at
    );
    if body = '' then
      body := format('Лог задачи: %s · %s · %s', coalesce(nullif(log_row.subject, ''), 'без предмета'), log_row.outcome, to_char(log_row.created_at, 'DD.MM HH24:MI'));
    end if;
  end if;
  if char_length(body) not between 1 and 8000 then
    raise exception 'note must contain 1 to 8000 characters' using errcode = '22023';
  end if;
  insert into private.support_notes (conversation_id, author_id, body, attachment)
  values (p_conversation_id, actor, body, attachment)
  returning id into note_id;
  return jsonb_build_object('id', note_id);
end;
$$;

create or replace function public.admin_support_template(p_action text, p_id uuid default null, p_title text default null, p_body text default null, p_sort integer default 0)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin('support');
  template_id uuid;
begin
  if p_action = 'save' then
    if p_id is null then
      insert into private.support_templates (title, body, sort, updated_by) values (trim(p_title), trim(p_body), coalesce(p_sort, 0), actor)
      returning id into template_id;
    else
      update private.support_templates set title = trim(p_title), body = trim(p_body), sort = coalesce(p_sort, sort), updated_by = actor, updated_at = now()
      where id = p_id returning id into template_id;
    end if;
    return jsonb_build_object('id', template_id);
  elsif p_action = 'delete' then
    delete from private.support_templates where id = p_id;
    return jsonb_build_object('deleted', true);
  end if;
  raise exception 'unknown template action' using errcode = '22023';
end;
$$;

revoke all on function public.admin_support_inbox(text, text, text, text, integer, integer) from public, anon;
grant execute on function public.admin_support_inbox(text, text, text, text, integer, integer) to authenticated;
revoke all on function public.admin_support_thread(uuid) from public, anon;
grant execute on function public.admin_support_thread(uuid) to authenticated;
revoke all on function public.admin_support_reply(uuid, text) from public, anon;
grant execute on function public.admin_support_reply(uuid, text) to authenticated;
revoke all on function public.admin_support_update(uuid, text, text, uuid, boolean) from public, anon;
grant execute on function public.admin_support_update(uuid, text, text, uuid, boolean) to authenticated;
revoke all on function public.admin_support_mark_read(uuid) from public, anon;
grant execute on function public.admin_support_mark_read(uuid) to authenticated;
revoke all on function public.admin_support_note(uuid, text, uuid) from public, anon;
grant execute on function public.admin_support_note(uuid, text, uuid) to authenticated;
revoke all on function public.admin_support_template(text, uuid, text, text, integer) from public, anon;
grant execute on function public.admin_support_template(text, uuid, text, text, integer) to authenticated;
