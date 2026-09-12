-- Мониторинг v2: сводка с алертами и графиком ошибок, фильтр списка по
-- датам, хронология событий, автодополнение маршрутов, подробности события
-- и смена статуса сразу у нескольких групп.
--
-- Все функции открыты admin и owner, как admin_errors_* из 20260911090400:
-- private.require_admin('admin') первой строкой, security definer, пустой
-- search_path. Старые функции расширены совместимо: у admin_errors_list
-- добавлены два необязательных параметра, у admin_error_detail - ключи ответа.

-- ---------------------------------------------------------------------------
-- 1. Одно событие ошибки со всем, что о нём известно
-- ---------------------------------------------------------------------------

-- Браузер берём из окружения события (ошибки браузера кладут туда
-- userAgent), иначе из журнала запросов по request_id. Там же ищем лог
-- решения: request_id у решателя общий для запроса, ошибки и лога.
create or replace function private.error_event_json(p_event_id bigint)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', e.id,
    'fingerprint', e.fingerprint,
    'kind', e.kind,
    'severity', e.severity,
    'route', e.route,
    'message', e.message,
    'stack', e.stack,
    'requestId', e.request_id,
    'userId', e.user_id,
    'email', u.email,
    'guestId', e.guest_id,
    'ip', e.ip,
    'input', e.input,
    'environment', e.environment,
    'createdAt', e.created_at,
    'userAgent', coalesce(nullif(e.environment ->> 'userAgent', ''), r.user_agent),
    'request', case when r.id is not null then jsonb_build_object(
      'id', r.id, 'method', r.method, 'route', r.route, 'status', r.status,
      'durationMs', r.duration_ms, 'createdAt', r.created_at
    ) end,
    'solutionLog', case when s.id is not null then jsonb_build_object(
      'id', s.id, 'subject', s.subject, 'grade', s.grade, 'outcome', s.outcome,
      'status', s.status, 'createdAt', s.created_at
    ) end
  )
  from private.error_events e
  left join auth.users u on u.id = e.user_id
  left join lateral (
    select l.id, l.method, l.route, l.status, l.duration_ms, l.user_agent, l.created_at
    from private.request_logs l
    where e.request_id is not null and l.request_id = e.request_id
    order by l.created_at desc
    limit 1
  ) r on true
  left join lateral (
    select l.id, l.subject, l.grade, l.outcome, l.status, l.created_at
    from private.solution_logs l
    where e.request_id is not null and l.request_id = e.request_id
    order by l.created_at desc
    limit 1
  ) s on true
  where e.id = p_event_id;
$$;

revoke all on function private.error_event_json(bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Сводка: карточки, график по видам, алерты
-- ---------------------------------------------------------------------------

create or replace function public.admin_monitoring_overview(p_period text default 'day')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  period text := case when p_period in ('day', 'week', 'month') then p_period else 'day' end;
  -- 24 часа - по часу, 7 дней - по шесть часов, 30 дней - по суткам (МСК).
  bucket interval := case p_period when 'week' then interval '6 hours' when 'month' then interval '1 day' else interval '1 hour' end;
  bucket_count integer := case p_period when 'week' then 28 when 'month' then 30 else 24 end;
  local_now timestamp := now() at time zone 'Europe/Moscow';
  local_end timestamp;
  period_start timestamptz;
  period_end timestamptz;
  -- Порог «ошибок за час» - та же настройка, что у уведомления «Всплеск
  -- ошибок» (раздел «Настройки»), чтобы экран и Telegram не спорили.
  spike_threshold integer := private.setting_int('error_spike_hourly', 20);
  -- Сервис лежит, если не отвечает дольше двух проверок подряд (проверка
  -- раз в пять минут): одиночный сбой сети - ещё не тревога.
  down_minutes constant integer := 10;
  -- Проверки идут раз в пять минут. Тишина дольше 15 значит, что встал
  -- сам cron и светофор показывает прошлое.
  stale_minutes constant integer := 15;
  -- Долю ответов 5xx сравниваем с нормой только на выборке от 20 запросов
  -- за час: ночью два падения из трёх запросов - это не авария.
  min_requests constant integer := 20;
  errors_last_hour integer;
  errors_norm numeric;
  req_total integer;
  req_failed integer;
  norm_total bigint;
  norm_failed bigint;
  share_now numeric;
  share_norm numeric;
  last_check timestamptz;
  alerts jsonb := '[]'::jsonb;
  service_row record;
begin
  perform private.require_admin('admin');

  local_end := case period
    when 'day' then date_trunc('hour', local_now) + interval '1 hour'
    when 'week' then date_trunc('hour', local_now) - make_interval(hours => extract(hour from local_now)::integer % 6) + interval '6 hours'
    else date_trunc('day', local_now) + interval '1 day'
  end;
  period_end := local_end at time zone 'Europe/Moscow';
  period_start := (local_end - bucket * bucket_count) at time zone 'Europe/Moscow';

  select count(*) into errors_last_hour
  from private.error_events where created_at > now() - interval '1 hour';
  -- Норма - средний час за семь суток до последнего часа.
  select count(*)::numeric / (7 * 24) into errors_norm
  from private.error_events
  where created_at > now() - interval '7 days 1 hour' and created_at <= now() - interval '1 hour';

  if errors_last_hour > spike_threshold then
    alerts := alerts || jsonb_build_array(jsonb_build_object(
      'id', 'errors_threshold', 'level', 'danger', 'kind', 'errors_threshold',
      'value', errors_last_hour, 'threshold', spike_threshold, 'norm', round(errors_norm, 2)
    ));
  elsif errors_last_hour > greatest(3, errors_norm * 2) then
    -- Тот же признак всплеска, что у дашборда (admin_dashboard_period).
    alerts := alerts || jsonb_build_array(jsonb_build_object(
      'id', 'errors_spike', 'level', 'warning', 'kind', 'errors_spike',
      'value', errors_last_hour, 'norm', round(errors_norm, 2),
      'ratio', case when errors_norm > 0 then round(errors_last_hour / errors_norm, 1) end
    ));
  end if;

  for service_row in
    select h.service, h.status, h.detail, h.checked_at, h.down_since
    from private.health_checks h
    where not h.ok
      and h.status <> 'not_configured'
      and coalesce(h.down_since, h.checked_at) < now() - make_interval(mins => down_minutes)
    order by h.service
  loop
    alerts := alerts || jsonb_build_array(jsonb_build_object(
      'id', 'down:' || service_row.service, 'level', 'danger', 'kind', 'service_down',
      'service', service_row.service, 'status', service_row.status, 'detail', left(service_row.detail, 200),
      'since', coalesce(service_row.down_since, service_row.checked_at),
      'minutes', floor(extract(epoch from (now() - coalesce(service_row.down_since, service_row.checked_at))) / 60)::integer
    ));
  end loop;

  select max(checked_at) into last_check from private.health_checks;
  if last_check is not null and last_check < now() - make_interval(mins => stale_minutes) then
    alerts := alerts || jsonb_build_array(jsonb_build_object(
      'id', 'checks_stale', 'level', 'warning', 'kind', 'checks_stale', 'since', last_check,
      'minutes', floor(extract(epoch from (now() - last_check)) / 60)::integer
    ));
  end if;

  select count(*), count(*) filter (where status >= 500) into req_total, req_failed
  from private.request_logs where created_at > now() - interval '1 hour';
  select count(*), count(*) filter (where status >= 500) into norm_total, norm_failed
  from private.request_logs
  where created_at > now() - interval '7 days 1 hour' and created_at <= now() - interval '1 hour';
  share_now := case when req_total > 0 then 100.0 * req_failed / req_total end;
  share_norm := case when norm_total > 0 then 100.0 * norm_failed / norm_total end;

  if req_total >= min_requests and share_now >= greatest(5, coalesce(share_norm, 0) * 2) then
    alerts := alerts || jsonb_build_array(jsonb_build_object(
      'id', 'api_5xx', 'level', case when share_now >= 50 then 'danger' else 'warning' end, 'kind', 'api_5xx',
      'value', round(share_now, 1), 'norm', round(share_norm, 1), 'failed', req_failed, 'total', req_total
    ));
  end if;

  return jsonb_build_object(
    'now', now(),
    'period', period,
    'from', period_start,
    'to', period_end,
    'bucketMinutes', (extract(epoch from bucket) / 60)::integer,
    'cards', jsonb_build_object(
      'open', (select count(*) from private.error_groups where status in ('new', 'in_progress')),
      'critical', (select count(*) from private.error_groups where status in ('new', 'in_progress') and severity = 'critical'),
      'newLastHour', (select count(*) from private.error_groups where first_seen_at > now() - interval '1 hour'),
      'eventsLastHour', errors_last_hour,
      'resolvedLastDay', (select count(*) from private.error_groups where status = 'resolved' and resolved_at > now() - interval '24 hours')
    ),
    'series', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'start', period_start + bucket * g,
        'end', period_start + bucket * (g + 1),
        'total', coalesce(c.total, 0),
        'frontend', coalesce(c.frontend, 0),
        'api', coalesce(c.api, 0),
        'llm', coalesce(c.llm, 0),
        'payments', coalesce(c.payments, 0),
        'db', coalesce(c.db, 0)
      ) order by g), '[]'::jsonb)
      from generate_series(0, bucket_count - 1) g
      left join (
        select floor(extract(epoch from (e.created_at - period_start)) / extract(epoch from bucket))::integer as idx,
          count(*) as total,
          count(*) filter (where e.kind = 'frontend') as frontend,
          count(*) filter (where e.kind = 'api') as api,
          count(*) filter (where e.kind = 'llm') as llm,
          count(*) filter (where e.kind = 'payments') as payments,
          count(*) filter (where e.kind = 'db') as db
        from private.error_events e
        where e.created_at >= period_start and e.created_at < period_end
        group by 1
      ) c on c.idx = g
    ),
    'errors', jsonb_build_object('lastHour', errors_last_hour, 'hourlyNorm', round(errors_norm, 2), 'threshold', spike_threshold),
    'requests', jsonb_build_object(
      'lastHour', req_total, 'failedLastHour', req_failed,
      'share', round(share_now, 1), 'normShare', round(share_norm, 1)
    ),
    'services', jsonb_build_object(
      'total', (select count(*) from private.health_checks),
      'down', (select count(*) from private.health_checks where not ok and status <> 'not_configured'),
      'notConfigured', (select count(*) from private.health_checks where status = 'not_configured'),
      'lastCheckAt', last_check
    ),
    'thresholds', jsonb_build_object(
      'spikeHourly', spike_threshold, 'downMinutes', down_minutes,
      'staleMinutes', stale_minutes, 'minRequests', min_requests
    ),
    'alerts', alerts
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Список групп: фильтр по датам и маршруты из запросов
-- ---------------------------------------------------------------------------

-- Новые параметры с умолчаниями: старый вызов с семью именованными
-- аргументами работает как раньше. Перегрузку не оставляем - PostgREST
-- не выбрал бы между двумя подходящими функциями.
drop function if exists public.admin_errors_list(text, text, text, text, text, integer, integer);

create or replace function public.admin_errors_list(
  p_status text default null,
  p_kind text default null,
  p_severity text default null,
  p_route text default null,
  p_search text default '',
  p_page integer default 1,
  p_page_size integer default 50,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_size integer := greatest(1, least(coalesce(p_page_size, 50), 500));
  safe_page integer := greatest(1, coalesce(p_page, 1));
  search text := trim(coalesce(p_search, ''));
  ranged boolean := p_from is not null or p_to is not null;
  from_ts timestamptz := coalesce(p_from, '-infinity'::timestamptz);
  to_ts timestamptz := coalesce(p_to, 'infinity'::timestamptz);
begin
  perform private.require_admin('admin');
  if from_ts > to_ts then
    raise exception 'period start is after period end' using errcode = '22023';
  end if;
  return (
    with filtered as (
      select * from private.error_groups g
      where (p_status is null or p_status = 'all' or g.status = p_status or (p_status = 'open' and g.status in ('new', 'in_progress')))
        and (p_kind is null or g.kind = p_kind)
        and (p_severity is null or g.severity = p_severity)
        and (p_route is null or g.route = p_route)
        and (search = '' or g.title ilike '%' || search || '%' or g.fingerprint = search or coalesce(g.route, '') ilike '%' || search || '%')
        and (not ranged or exists (
          select 1 from private.error_events e
          where e.fingerprint = g.fingerprint and e.created_at >= from_ts and e.created_at < to_ts
        ))
    )
    select jsonb_build_object(
      'total', (select count(*) from filtered),
      'page', safe_page,
      'pageSize', safe_size,
      'routes', (select coalesce(jsonb_agg(distinct route), '[]'::jsonb) from private.error_groups where route is not null),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'fingerprint', g.fingerprint, 'kind', g.kind, 'severity', g.severity, 'route', g.route, 'title', g.title,
          'status', g.status, 'occurrences', g.occurrences, 'usersAffected', g.users_affected,
          'firstSeenAt', g.first_seen_at, 'lastSeenAt', g.last_seen_at,
          'trend', (
            select jsonb_agg((select count(*) from private.error_events e where e.fingerprint = g.fingerprint
              and e.created_at >= (private.msk_day(now()) - k)::timestamp at time zone 'Europe/Moscow'
              and e.created_at < (private.msk_day(now()) - k + 1)::timestamp at time zone 'Europe/Moscow') order by k desc)
            from generate_series(0, 6) k
          ),
          'lastHour', (select count(*) from private.error_events e where e.fingerprint = g.fingerprint and e.created_at > now() - interval '1 hour'),
          'periodCount', case when ranged then (
            select count(*) from private.error_events e
            where e.fingerprint = g.fingerprint and e.created_at >= from_ts and e.created_at < to_ts
          ) end
        ) order by g.last_seen_at desc)
        from (select * from filtered order by last_seen_at desc limit safe_size offset (safe_page - 1) * safe_size) g
      ), '[]'::jsonb)
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Хронология: события по времени, а не группы
-- ---------------------------------------------------------------------------

create or replace function public.admin_errors_timeline(
  p_status text default null,
  p_kind text default null,
  p_severity text default null,
  p_route text default null,
  p_search text default '',
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_before_id bigint default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
  search text := trim(coalesce(p_search, ''));
  -- Без начала периода - 30 дней: дольше события ошибок не хранятся.
  from_ts timestamptz := coalesce(p_from, now() - interval '30 days');
  to_ts timestamptz := coalesce(p_to, 'infinity'::timestamptz);
begin
  perform private.require_admin('admin');
  if from_ts > to_ts then
    raise exception 'period start is after period end' using errcode = '22023';
  end if;
  return (
    with picked as (
      select e.id, e.fingerprint, e.kind, e.severity, e.route, e.message, e.request_id,
        e.user_id, e.guest_id, e.ip, e.created_at, g.title, g.status
      from private.error_events e
      join private.error_groups g on g.fingerprint = e.fingerprint
      where (p_before_id is null or e.id < p_before_id)
        and e.created_at >= from_ts and e.created_at < to_ts
        and (p_status is null or p_status = 'all' or g.status = p_status or (p_status = 'open' and g.status in ('new', 'in_progress')))
        and (p_kind is null or e.kind = p_kind)
        and (p_severity is null or e.severity = p_severity)
        and (p_route is null or e.route = p_route)
        and (search = '' or e.message ilike '%' || search || '%' or g.title ilike '%' || search || '%' or e.fingerprint = search)
      order by e.id desc
      limit safe_limit + 1
    ),
    page as (
      select * from picked order by id desc limit safe_limit
    )
    select jsonb_build_object(
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', p.id, 'fingerprint', p.fingerprint, 'kind', p.kind, 'severity', p.severity, 'route', p.route,
          'message', p.message, 'title', p.title, 'status', p.status, 'requestId', p.request_id,
          'userId', p.user_id, 'email', u.email, 'guestId', p.guest_id, 'ip', p.ip, 'createdAt', p.created_at
        ) order by p.id desc)
        from page p
        left join auth.users u on u.id = p.user_id
      ), '[]'::jsonb),
      'hasMore', (select count(*) > safe_limit from picked),
      'nextBefore', (select min(id) from page)
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Маршруты для автодополнения фильтра
-- ---------------------------------------------------------------------------

-- Маршруты из групп ошибок и из журнала запросов за неделю: так в
-- подсказке есть и маршрут, где ошибок пока не было.
create or replace function public.admin_error_routes(p_query text default '', p_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  query text := trim(coalesce(p_query, ''));
  safe_limit integer := greatest(1, least(coalesce(p_limit, 20), 100));
begin
  perform private.require_admin('admin');
  return coalesce((
    select jsonb_agg(jsonb_build_object('route', r.route, 'errors', r.errors, 'requests', r.requests)
      order by r.errors desc, r.requests desc, r.route)
    from (
      select u.route, sum(u.errors)::integer as errors, sum(u.requests)::integer as requests
      from (
        select g.route, sum(g.occurrences) as errors, 0::bigint as requests
        from private.error_groups g
        where coalesce(g.route, '') <> ''
        group by g.route
        union all
        select l.route, 0, count(*)
        from private.request_logs l
        where l.created_at > now() - interval '7 days' and l.route <> ''
        group by l.route
      ) u
      where query = '' or u.route ilike '%' || query || '%'
      group by u.route
      order by sum(u.errors) desc, sum(u.requests) desc, u.route
      limit safe_limit
    ) r
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Подробности группы и одного события
-- ---------------------------------------------------------------------------

create or replace function public.admin_error_detail(p_fingerprint text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin('admin');
  return jsonb_build_object(
    'group', (select to_jsonb(g) from private.error_groups g where g.fingerprint = p_fingerprint),
    'stats', jsonb_build_object(
      'lastHour', (select count(*) from private.error_events where fingerprint = p_fingerprint and created_at > now() - interval '1 hour'),
      'last24h', (select count(*) from private.error_events where fingerprint = p_fingerprint and created_at > now() - interval '24 hours'),
      'stored', (select count(*) from private.error_events where fingerprint = p_fingerprint),
      'trend', (
        select jsonb_agg(jsonb_build_object(
          'date', private.msk_day(now()) - k,
          'count', (select count(*) from private.error_events e where e.fingerprint = p_fingerprint
            and e.created_at >= (private.msk_day(now()) - k)::timestamp at time zone 'Europe/Moscow'
            and e.created_at < (private.msk_day(now()) - k + 1)::timestamp at time zone 'Europe/Moscow')
        ) order by k desc)
        from generate_series(0, 6) k
      )
    ),
    'events', coalesce((
      select jsonb_agg(private.error_event_json(e.id) order by e.created_at desc, e.id desc)
      from (select id, created_at from private.error_events where fingerprint = p_fingerprint order by created_at desc, id desc limit 50) e
    ), '[]'::jsonb)
  );
end;
$$;

-- Событие из хронологии может быть старше пятидесяти последних в группе.
create or replace function public.admin_error_event(p_event_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin('admin');
  return private.error_event_json(p_event_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Статус сразу у нескольких групп
-- ---------------------------------------------------------------------------

create or replace function public.admin_errors_set_status_bulk(p_fingerprints text[], p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin('admin');
  wanted integer;
  updated integer := 0;
  unchanged integer := 0;
  row_record record;
begin
  if p_status is null or p_status not in ('new', 'in_progress', 'resolved', 'ignored') then
    raise exception 'invalid error status' using errcode = '22023';
  end if;
  select count(distinct f) into wanted from unnest(coalesce(p_fingerprints, '{}'::text[])) f where f is not null;
  if wanted not between 1 and 200 then
    raise exception 'select 1 to 200 error groups' using errcode = '22023';
  end if;

  for row_record in
    select g.fingerprint, g.status
    from private.error_groups g
    where g.fingerprint = any(p_fingerprints)
    order by g.fingerprint
    for update
  loop
    if row_record.status = p_status then
      unchanged := unchanged + 1;
      continue;
    end if;
    update private.error_groups
    set status = p_status,
        resolved_at = case when p_status = 'resolved' then now() else null end,
        resolved_by = case when p_status = 'resolved' then actor else null end
    where fingerprint = row_record.fingerprint;
    -- Та же запись аудита, что у смены по одной: журнал не делится на два вида.
    perform private.audit('error_status_changed', null,
      jsonb_build_object('fingerprint', row_record.fingerprint, 'bulk', true),
      jsonb_build_object('status', row_record.status), jsonb_build_object('status', p_status));
    updated := updated + 1;
  end loop;

  return jsonb_build_object(
    'status', p_status,
    'updated', updated,
    'unchanged', unchanged,
    'missing', wanted - updated - unchanged
  );
end;
$$;

revoke all on function public.admin_monitoring_overview(text) from public, anon;
grant execute on function public.admin_monitoring_overview(text) to authenticated;
revoke all on function public.admin_errors_list(text, text, text, text, text, integer, integer, timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_errors_list(text, text, text, text, text, integer, integer, timestamptz, timestamptz) to authenticated;
revoke all on function public.admin_errors_timeline(text, text, text, text, text, timestamptz, timestamptz, bigint, integer) from public, anon;
grant execute on function public.admin_errors_timeline(text, text, text, text, text, timestamptz, timestamptz, bigint, integer) to authenticated;
revoke all on function public.admin_error_routes(text, integer) from public, anon;
grant execute on function public.admin_error_routes(text, integer) to authenticated;
revoke all on function public.admin_error_detail(text) from public, anon;
grant execute on function public.admin_error_detail(text) to authenticated;
revoke all on function public.admin_error_event(bigint) from public, anon;
grant execute on function public.admin_error_event(bigint) to authenticated;
revoke all on function public.admin_errors_set_status_bulk(text[], text) from public, anon;
grant execute on function public.admin_errors_set_status_bulk(text[], text) to authenticated;
