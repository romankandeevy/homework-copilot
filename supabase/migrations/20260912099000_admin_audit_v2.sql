-- Журнал действий v2: фильтры по периоду, администратору и ученику,
-- пресет «опасные действия», сводка обращений к админ-API по путям.
--
-- Фильтры и агрегаты по минутам считает база, интерфейс только показывает.
-- Прежние admin_audit_log_list и admin_request_log_list остаются как есть.
--
-- Срок хранения (проверено по cron.job и телам функций уборки 12.09.2026):
--   private.admin_audit_log - плановой уборки нет: ни purge_expired_records
--     (cron purge-expired-records), ни purge_admin_service_rows
--     (cron purge-admin-service-rows) эту таблицу не трогают. Строки уходят
--     только при удалении аккаунта: delete_my_account стирает действия, автор
--     которых - удаляемый аккаунт, а у действий над ним внешний ключ обнуляет
--     target_user_id.
--   private.admin_request_log - 90 дней, её чистят обе ежедневные уборки.

-- ---------------------------------------------------------------------------
-- 1. Опасные действия
-- ---------------------------------------------------------------------------

-- Удаления, бан, возвраты денег, сброс пароля, смена прав администратора.
-- Списания (отрицательная корректировка баланса, выравнивание кошелька
-- вниз) определяются по содержимому записи - см. admin_audit_is_dangerous.
create or replace function private.admin_audit_danger_events()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'plan_deleted',
    'solution_deleted',
    'user_note_deleted',
    'user_banned',
    'payment_refunded',
    'reservation_refunded',
    'reconciliation_fixed',
    'password_reset_sent',
    'admin_role_changed'
  ]::text[];
$$;

revoke all on function private.admin_audit_danger_events() from public, anon, authenticated;

-- Сравнение jsonb-чисел не требует приведения типа, поэтому строка вместо
-- числа в старой записи не роняет весь запрос.
create or replace function private.admin_audit_is_dangerous(
  p_event text,
  p_payload jsonb,
  p_before jsonb,
  p_after jsonb
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    p_event = any (private.admin_audit_danger_events())
    or (
      p_event = 'balance_adjusted'
      and coalesce(jsonb_typeof(p_payload -> 'amount') = 'number' and (p_payload -> 'amount') < to_jsonb(0), false)
    )
    or (
      p_event = 'wallet_aligned'
      and coalesce(
        jsonb_typeof(p_before -> 'balance') = 'number'
          and jsonb_typeof(p_after -> 'balance') = 'number'
          and (p_after -> 'balance') < (p_before -> 'balance'),
        false
      )
    );
$$;

revoke all on function private.admin_audit_is_dangerous(text, jsonb, jsonb, jsonb) from public, anon, authenticated;

-- Подстрока для ilike: % и _ из ввода ищутся буквально.
create or replace function private.admin_audit_like_contains(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select '%' || replace(replace(replace(p_value, '\', '\\'), '%', '\%'), '_', '\_') || '%';
$$;

revoke all on function private.admin_audit_like_contains(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Действия администраторов
-- ---------------------------------------------------------------------------

-- p_actor: uuid администратора или 'system' (снятие бана по сроку, cron).
-- p_user: почта, имя или id ученика - вся история действий над ним.
-- p_from / p_to: дни по Москве включительно, null - без границы.
create or replace function public.admin_audit_log_v2(
  p_page integer default 1,
  p_page_size integer default 50,
  p_event text default null,
  p_actor text default null,
  p_user text default null,
  p_from date default null,
  p_to date default null,
  p_dangerous boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_size integer := greatest(1, least(coalesce(p_page_size, 50), 200));
  safe_page integer := greatest(1, coalesce(p_page, 1));
  event_filter text := nullif(trim(coalesce(p_event, '')), '');
  actor_filter text := nullif(lower(trim(coalesce(p_actor, ''))), '');
  needle text := nullif(left(trim(coalesce(p_user, '')), 200), '');
  only_dangerous boolean := coalesce(p_dangerous, false);
  actor_uuid uuid;
  user_ids uuid[];
  pattern text;
  from_at timestamptz;
  to_at timestamptz;
  result jsonb;
begin
  perform private.require_admin('support');

  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'period start is after period end' using errcode = '22023';
  end if;
  from_at := p_from::timestamp at time zone 'Europe/Moscow';
  to_at := (p_to + 1)::timestamp at time zone 'Europe/Moscow';

  if actor_filter is not null and actor_filter <> 'system' then
    if actor_filter !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'invalid actor filter' using errcode = '22023';
    end if;
    actor_uuid := actor_filter::uuid;
  end if;

  if needle is not null then
    if needle ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      user_ids := array[needle::uuid];
    else
      pattern := private.admin_audit_like_contains(needle);
      select coalesce(array_agg(s.id), '{}'::uuid[]) into user_ids
      from (
        select u.id
        from auth.users u
        left join public.profiles p on p.id = u.id
        where u.email ilike pattern or p.full_name ilike pattern
        limit 500
      ) s;
    end if;
  end if;

  with filtered as (
    select l.*
    from private.admin_audit_log l
    where (event_filter is null or l.event_type = event_filter)
      and (
        actor_filter is null
        or (actor_filter = 'system' and l.actor_id is null)
        or (actor_uuid is not null and l.actor_id = actor_uuid)
      )
      and (from_at is null or l.created_at >= from_at)
      and (to_at is null or l.created_at < to_at)
      and (not only_dangerous or private.admin_audit_is_dangerous(l.event_type, l.payload, l.before_value, l.after_value))
      and (
        needle is null
        or l.target_user_id = any (user_ids)
        -- Смена роли пишет почту в payload: запись находится и после удаления аккаунта.
        or (pattern is not null and l.payload ->> 'email' ilike pattern)
      )
  ),
  page as (
    select *
    from filtered
    order by created_at desc, id
    limit safe_size offset (safe_page - 1) * safe_size
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'page', safe_page,
    'pageSize', safe_size,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'event', l.event_type,
        'actorId', l.actor_id,
        'actorEmail', au.email,
        'actorRole', l.actor_role,
        'actorIp', l.actor_ip,
        'targetUserId', l.target_user_id,
        'targetEmail', tu.email,
        'targetName', tp.full_name,
        'payload', l.payload,
        'before', l.before_value,
        'after', l.after_value,
        'dangerous', private.admin_audit_is_dangerous(l.event_type, l.payload, l.before_value, l.after_value),
        'createdAt', l.created_at
      ) order by l.created_at desc, l.id)
      from page l
      left join auth.users au on au.id = l.actor_id
      left join auth.users tu on tu.id = l.target_user_id
      left join public.profiles tp on tp.id = l.target_user_id
    ), '[]'::jsonb)
  ) into result;

  return result || jsonb_build_object(
    -- Для фильтра «Кто»: нынешние администраторы и бывшие, у кого есть записи.
    'actors', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'email', u.email, 'role', a.role, 'current', a.is_current)
        order by a.is_current desc, u.email nulls last)
      from (
        select au.user_id as id, au.role, true as is_current
        from private.admin_users au
        union all
        select l.actor_id, (array_agg(l.actor_role order by l.created_at desc))[1], false
        from private.admin_audit_log l
        where l.actor_id is not null
          and not exists (select 1 from private.admin_users x where x.user_id = l.actor_id)
        group by l.actor_id
      ) a
      left join auth.users u on u.id = a.id
    ), '[]'::jsonb),
    'hasSystem', exists (select 1 from private.admin_audit_log where actor_id is null),
    'eventCounts', coalesce((
      select jsonb_object_agg(c.event_type, c.n)
      from (select event_type, count(*) as n from private.admin_audit_log group by event_type) c
    ), '{}'::jsonb),
    'dangerEvents', to_jsonb(private.admin_audit_danger_events()),
    'oldestAt', (select min(created_at) from private.admin_audit_log)
  );
end;
$$;

revoke all on function public.admin_audit_log_v2(integer, integer, text, text, text, date, date, boolean) from public, anon;
grant execute on function public.admin_audit_log_v2(integer, integer, text, text, text, date, date, boolean) to authenticated;

comment on function public.admin_audit_log_v2(integer, integer, text, text, text, date, date, boolean) is
  'Журнал действий администраторов с фильтрами: событие, автор или system, ученик (почта, имя, id), период по Москве, только опасные. Роль support и выше.';

-- ---------------------------------------------------------------------------
-- 3. Обращения к админ-API: список
-- ---------------------------------------------------------------------------

-- p_path - подстрока пути, p_ip - начало адреса. myIp - адрес этого же
-- запроса (private.request_ip), по нему интерфейс помечает «это вы».
create or replace function public.admin_request_log_v2(
  p_page integer default 1,
  p_page_size integer default 100,
  p_path text default null,
  p_from date default null,
  p_to date default null,
  p_actor_id uuid default null,
  p_ip text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_size integer := greatest(1, least(coalesce(p_page_size, 100), 500));
  safe_page integer := greatest(1, coalesce(p_page, 1));
  path_text text := nullif(left(trim(coalesce(p_path, '')), 200), '');
  ip_text text := nullif(left(trim(coalesce(p_ip, '')), 64), '');
  path_pattern text;
  ip_pattern text;
  from_at timestamptz;
  to_at timestamptz;
  my_ip text;
  result jsonb;
begin
  perform private.require_admin('owner');

  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'period start is after period end' using errcode = '22023';
  end if;
  from_at := p_from::timestamp at time zone 'Europe/Moscow';
  to_at := (p_to + 1)::timestamp at time zone 'Europe/Moscow';
  path_pattern := case when path_text is null then null else private.admin_audit_like_contains(path_text) end;
  ip_pattern := case when ip_text is null then null else replace(replace(replace(ip_text, '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  my_ip := private.request_ip();

  with in_period as (
    select l.*
    from private.admin_request_log l
    where (from_at is null or l.created_at >= from_at)
      and (to_at is null or l.created_at < to_at)
  ),
  filtered as (
    select *
    from in_period l
    where (path_pattern is null or l.path ilike path_pattern)
      and (p_actor_id is null or l.actor_id = p_actor_id)
      and (ip_pattern is null or l.ip like ip_pattern)
  ),
  page as (
    select *
    from filtered
    order by created_at desc, id desc
    limit safe_size offset (safe_page - 1) * safe_size
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'page', safe_page,
    'pageSize', safe_size,
    'distinctIps', (select count(distinct ip) from filtered),
    'myIp', my_ip,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'actorId', l.actor_id, 'actorEmail', u.email, 'role', l.role,
        'path', l.path, 'ip', l.ip, 'createdAt', l.created_at
      ) order by l.created_at desc, l.id desc)
      from page l
      left join auth.users u on u.id = l.actor_id
    ), '[]'::jsonb),
    -- Подсказки для полей: реальные пути и адреса за период, частые сверху.
    'paths', coalesce((
      select jsonb_agg(jsonb_build_object('path', p.path, 'calls', p.calls) order by p.calls desc, p.path)
      from (select path, count(*) as calls from in_period group by path order by calls desc, path limit 200) p
    ), '[]'::jsonb),
    'ips', coalesce((
      select jsonb_agg(jsonb_build_object('ip', i.ip, 'calls', i.calls) order by i.calls desc, i.ip)
      from (select ip, count(*) as calls from in_period where ip is not null group by ip order by calls desc, ip limit 50) i
    ), '[]'::jsonb),
    'actors', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.actor_id, 'email', u.email, 'role', a.role) order by u.email nulls last)
      from (
        select au.user_id as actor_id, au.role from private.admin_users au
        union
        select distinct l.actor_id, l.role
        from in_period l
        where not exists (select 1 from private.admin_users x where x.user_id = l.actor_id)
      ) a
      left join auth.users u on u.id = a.actor_id
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.admin_request_log_v2(integer, integer, text, date, date, uuid, text) from public, anon;
grant execute on function public.admin_request_log_v2(integer, integer, text, date, date, uuid, text) to authenticated;

comment on function public.admin_request_log_v2(integer, integer, text, date, date, uuid, text) is
  'Журнал обращений к admin-RPC с фильтрами: путь, период по Москве, администратор, начало IP. Возвращает IP текущего запроса и число разных IP. Только owner.';

-- ---------------------------------------------------------------------------
-- 4. Обращения к админ-API: сводка по путям
-- ---------------------------------------------------------------------------

-- Для каждого пути: вызовов, доля в процентах, пик вызовов в одну минуту,
-- сколько минут вызовов было больше p_threshold в минуту. Порог задаёт
-- интерфейс (там же объяснено, почему такой), база только считает.
create or replace function public.admin_request_log_summary(
  p_from date default null,
  p_to date default null,
  p_path text default null,
  p_actor_id uuid default null,
  p_ip text default null,
  p_threshold integer default 2,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_threshold integer := greatest(1, least(coalesce(p_threshold, 2), 1000));
  safe_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
  path_text text := nullif(left(trim(coalesce(p_path, '')), 200), '');
  ip_text text := nullif(left(trim(coalesce(p_ip, '')), 64), '');
  path_pattern text;
  ip_pattern text;
  from_at timestamptz;
  to_at timestamptz;
  my_ip text;
  result jsonb;
begin
  perform private.require_admin('owner');

  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'period start is after period end' using errcode = '22023';
  end if;
  from_at := p_from::timestamp at time zone 'Europe/Moscow';
  to_at := (p_to + 1)::timestamp at time zone 'Europe/Moscow';
  path_pattern := case when path_text is null then null else private.admin_audit_like_contains(path_text) end;
  ip_pattern := case when ip_text is null then null else replace(replace(replace(ip_text, '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  my_ip := private.request_ip();

  with filtered as (
    select l.path, l.actor_id, l.ip, l.created_at
    from private.admin_request_log l
    where (from_at is null or l.created_at >= from_at)
      and (to_at is null or l.created_at < to_at)
      and (path_pattern is null or l.path ilike path_pattern)
      and (p_actor_id is null or l.actor_id = p_actor_id)
      and (ip_pattern is null or l.ip like ip_pattern)
  ),
  per_minute as (
    select path, date_trunc('minute', created_at) as minute, count(*)::integer as calls
    from filtered
    group by path, date_trunc('minute', created_at)
  ),
  peaks as (
    select distinct on (path) path, minute as peak_at, calls as peak
    from per_minute
    order by path, calls desc, minute desc
  ),
  minutes as (
    select path,
      count(*)::integer as active_minutes,
      (count(*) filter (where calls > safe_threshold))::integer as hot_minutes
    from per_minute
    group by path
  ),
  totals as (
    select path,
      count(*)::integer as calls,
      count(distinct actor_id)::integer as actors,
      count(distinct ip)::integer as ips,
      min(created_at) as first_at,
      max(created_at) as last_at
    from filtered
    group by path
  ),
  grand as (
    select count(*)::integer as calls, count(distinct ip)::integer as ips, count(distinct path)::integer as paths
    from filtered
  )
  select jsonb_build_object(
    'total', g.calls,
    'distinctIps', g.ips,
    'distinctPaths', g.paths,
    'threshold', safe_threshold,
    'myIp', my_ip,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'path', t.path,
        'calls', t.calls,
        'share', round(t.calls * 100.0 / nullif(g.calls, 0), 1),
        'peakPerMinute', pk.peak,
        'peakAt', pk.peak_at,
        'activeMinutes', m.active_minutes,
        'hotMinutes', m.hot_minutes,
        'actors', t.actors,
        'ips', t.ips,
        'firstAt', t.first_at,
        'lastAt', t.last_at
      ) order by t.calls desc, t.path)
      from (select * from totals order by calls desc, path limit safe_limit) t
      join peaks pk on pk.path = t.path
      join minutes m on m.path = t.path
    ), '[]'::jsonb)
  )
  into result
  from grand g;

  return result;
end;
$$;

revoke all on function public.admin_request_log_summary(date, date, text, uuid, text, integer, integer) from public, anon;
grant execute on function public.admin_request_log_summary(date, date, text, uuid, text, integer, integer) to authenticated;

comment on function public.admin_request_log_summary(date, date, text, uuid, text, integer, integer) is
  'Топ путей admin-RPC за период: вызовы, доля, пик в минуту, минуты выше порога. Только owner.';
