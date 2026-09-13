-- Админка видит телефон у аккаунтов без почты.
--
-- Аккаунт, вошедший кодом из СМС, почты не имеет: карточка показывала бы
-- «-» вместо адреса, список - «Без имени», а найти такого ученика было бы
-- нечем. Теперь в профиле карточки есть телефон, дата его подтверждения и
-- способ входа, в списке - телефон и поиск по цифрам номера.
--
-- Поля только добавляются: выкаченная прод-админка читает прежние, и они
-- на месте (AGENTS.md «Админка»: база одна у превью и прода).

-- 1. Карточка пользователя.
--
-- Функция большая, а меняется в ней только профиль. Прежняя уходит в
-- private без изменений и становится основой, наружу смотрит обёртка:
-- берёт её ответ и дописывает в профиль три поля. Роль проверяет и
-- обращение в журнал пишет основа, как раньше; обёртка require_admin сама
-- не зовёт, чтобы обращение не считалось дважды.
alter function public.admin_user_card(uuid) rename to admin_user_card_base;
alter function public.admin_user_card_base(uuid) set schema private;
revoke all on function private.admin_user_card_base(uuid) from public, anon, authenticated;

create or replace function public.admin_user_card(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  profile_with_phone jsonb;
begin
  result := private.admin_user_card_base(p_user_id);

  select coalesce(result -> 'profile', '{}'::jsonb) || jsonb_build_object(
    'phone', nullif(u.phone, ''),
    'phoneConfirmedAt', u.phone_confirmed_at,
    'provider', u.raw_app_meta_data ->> 'provider'
  )
  into profile_with_phone
  from auth.users u
  where u.id = p_user_id;

  if found then
    result := jsonb_set(result, '{profile}', profile_with_phone);
  end if;

  return result;
end;
$$;

revoke all on function public.admin_user_card(uuid) from public, anon;
grant execute on function public.admin_user_card(uuid) to authenticated;

-- 2. Список пользователей: телефон в строке и поиск по цифрам номера.
--
-- Копия версии из 20260912101000_internal_accounts.sql, изменены три места:
-- `au.phone` в base, условие поиска по номеру и поле 'phone' в строке.
-- Поиск по номеру включается от четырёх цифр, иначе «5» в строке поиска
-- находила бы половину базы. «8 912…» ищется как «7912…»: так номер хранит
-- Supabase.
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
  search_digits text := regexp_replace(trim(coalesce(p_search, '')), '\D', '', 'g');
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

  if length(search_digits) = 11 and left(search_digits, 1) = '8' then
    search_digits := '7' || substr(search_digits, 2);
  end if;
  if length(search_digits) < 4 then
    search_digits := '';
  end if;

  with base as (
    select
      p.id,
      au.email,
      au.phone,
      p.full_name,
      p.grade,
      p.created_at,
      p.last_seen_at,
      coalesce(w.balance, 0) as balance,
      coalesce(ac.is_banned, false) and (ac.banned_until is null or ac.banned_until > now()) as is_banned,
      ac.banned_until,
      ep.id as plan_id,
      ep.title as plan_title,
      exists (select 1 from private.admin_users au where au.user_id = p.id) as is_staff,
      exists (select 1 from private.internal_accounts ia where ia.user_id = p.id) as is_internal,
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
      or (search_digits <> '' and au.phone like '%' || search_digits || '%')
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
        'id', t.id, 'email', t.email, 'phone', nullif(t.phone, ''), 'fullName', t.full_name, 'grade', t.grade,
        'createdAt', t.created_at, 'lastSeenAt', t.last_seen_at, 'balance', t.balance,
        'isBanned', t.is_banned, 'bannedUntil', t.banned_until, 'isStaff', t.is_staff, 'isInternal', t.is_internal,
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
