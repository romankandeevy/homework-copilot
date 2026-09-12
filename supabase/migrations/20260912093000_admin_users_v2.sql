-- Пользователи v2: фильтры по активности, статусу и классу, отметка
-- сотрудника в строке и полоса цифр над таблицей.
--
-- 1. admin_users_list - та же сигнатура, старые фильтры работают как
--    раньше. Новые ключи p_filters:
--      seen   - online (10 минут) | today (с полуночи по Москве) | 7d | 30d
--               | stale (не заходил 30 дней или ни разу);
--      status - active (без бана и открытых флагов) | banned | fraud;
--      grade  - класс школы, 1-11.
--    Сортировка дополнительно принимает grade. В строке появился isStaff:
--    аккаунт из private.admin_users.
--    last_seen_at пишет track_my_activity. До 12 сентября 2026 пульс из
--    браузера не уходил (голый void в App.tsx), поэтому у всех, кто не
--    заходил после этого дня, поле пустое и они попадают в stale.
--
-- 2. admin_users_stats - цифры над таблицей: ученики, новые за 7 дней,
--    плательщики и сумма их пополнений за вычетом возвратов, онлайн сейчас.
--    Аккаунты администраторов не считаются нигде (private.is_staff), как и
--    в выручке дашборда. balanceCeiling - самый большой баланс: правый край
--    ползунка баланса.

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
  seen text := filters ->> 'seen';
  status_filter text := filters ->> 'status';
  grade_filter text := filters ->> 'grade';
  msk_midnight timestamptz := date_trunc('day', now() at time zone 'Europe/Moscow') at time zone 'Europe/Moscow';
  result jsonb;
begin
  perform private.require_admin('support');

  if seen is not null and seen not in ('online', 'today', '7d', '30d', 'stale') then
    raise exception 'unknown activity filter' using errcode = '22023';
  end if;
  if status_filter is not null and status_filter not in ('active', 'banned', 'fraud') then
    raise exception 'unknown status filter' using errcode = '22023';
  end if;
  if grade_filter is not null and grade_filter !~ '^([1-9]|1[01])$' then
    raise exception 'unknown grade filter' using errcode = '22023';
  end if;

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
      private.is_staff(p.id) as is_staff,
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
  -- coalesce обязателен: отсутствующий ключ даёт NULL (NULL = 'true'), и
  -- NULL в любой ветке OR без него превращал not (...) в NULL - строка
  -- выпадала, даже когда ни один фильтр не задан.
  filtered as (
    select * from base t
    where not coalesce(
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
      or (grade_filter is not null and t.grade <> grade_filter::smallint)
      or (status_filter = 'active' and (t.is_banned or t.open_flags > 0))
      or (status_filter = 'banned' and not t.is_banned)
      or (status_filter = 'fraud' and t.open_flags = 0)
      or (seen = 'online' and not coalesce(t.last_seen_at > now() - interval '10 minutes', false))
      or (seen = 'today' and not coalesce(t.last_seen_at >= msk_midnight, false))
      or (seen = '7d' and not coalesce(t.last_seen_at > now() - interval '7 days', false))
      or (seen = '30d' and not coalesce(t.last_seen_at > now() - interval '30 days', false))
      or (seen = 'stale' and coalesce(t.last_seen_at > now() - interval '30 days', false))
    , false)
  ),
  ranked as (
    select
      jsonb_build_object(
        'id', t.id, 'email', t.email, 'fullName', t.full_name, 'grade', t.grade,
        'createdAt', t.created_at, 'lastSeenAt', t.last_seen_at, 'balance', t.balance,
        'isBanned', t.is_banned, 'bannedUntil', t.banned_until, 'isStaff', t.is_staff,
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
            when 'grade' then t.grade
            else extract(epoch from coalesce(t.last_seen_at, t.created_at)) end end asc nulls last,
          case when descending then case p_sort
            when 'created' then extract(epoch from t.created_at)
            when 'balance' then t.balance
            when 'tasks' then t.tasks
            when 'paid' then t.paid_total
            when 'grade' then t.grade
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

create or replace function public.admin_users_stats()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin('support');

  return jsonb_build_object(
    'students', (select count(*) from public.profiles p where not private.is_staff(p.id)),
    'new7d', (select count(*) from public.profiles p
      where p.created_at > now() - interval '7 days' and not private.is_staff(p.id)),
    'payers', (select count(distinct t.user_id) from private.verified_balance_top_ups t where not private.is_staff(t.user_id)),
    'paidKopecks',
      coalesce((select sum(t.amount) from private.verified_balance_top_ups t where not private.is_staff(t.user_id)), 0)
      - coalesce((select sum(r.amount) from private.top_up_refunds r where not private.is_staff(r.user_id)), 0),
    'online', (select count(*) from public.profiles p
      where p.last_seen_at > now() - interval '10 minutes' and not private.is_staff(p.id)),
    'balanceCeiling', coalesce((select max(w.balance) from public.wallet_accounts w), 0)
  );
end;
$$;

revoke all on function public.admin_users_stats() from public, anon;
grant execute on function public.admin_users_stats() to authenticated;
