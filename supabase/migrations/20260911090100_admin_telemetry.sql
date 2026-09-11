-- Телеметрия для админки: устройства и адреса, журнал запросов к функциям,
-- ошибки с группировкой по отпечатку, полный лог запроса и ответа модели,
-- оценка «помогло / не помогло».
--
-- Всё лежит в private: ученику ничего из этого не видно. Пишут либо
-- функции на Vercel служебной ролью, либо сама база из request.headers.

-- ---------------------------------------------------------------------------
-- 1. Устройства и адреса
-- ---------------------------------------------------------------------------

create table if not exists private.user_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  guest_id uuid,
  device_id text,
  ip text,
  user_agent text,
  hits integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint user_devices_owner_present check (user_id is not null or guest_id is not null)
);

create unique index if not exists user_devices_identity_idx
  on private.user_devices (
    coalesce(user_id::text, ''), coalesce(guest_id::text, ''), coalesce(ip, ''), md5(coalesce(user_agent, '')), coalesce(device_id, '')
  );
create index if not exists user_devices_user_idx on private.user_devices (user_id, last_seen_at desc);
create index if not exists user_devices_ip_idx on private.user_devices (ip, last_seen_at desc);
create index if not exists user_devices_device_idx on private.user_devices (device_id) where device_id is not null;

alter table private.user_devices enable row level security;
revoke all on table private.user_devices from public, anon, authenticated;

create or replace function private.touch_device(
  p_user_id uuid,
  p_guest_id uuid,
  p_device_id text,
  p_ip text,
  p_user_agent text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null and p_guest_id is null then
    return;
  end if;
  insert into private.user_devices as d (user_id, guest_id, device_id, ip, user_agent)
  values (p_user_id, p_guest_id, nullif(left(p_device_id, 64), ''), nullif(left(p_ip, 64), ''), nullif(left(p_user_agent, 400), ''))
  on conflict (
    coalesce(user_id::text, ''), coalesce(guest_id::text, ''), coalesce(ip, ''), md5(coalesce(user_agent, '')), coalesce(device_id, '')
  ) do update
  set hits = d.hits + 1,
      last_seen_at = now();
end;
$$;

revoke all on function private.touch_device(uuid, uuid, text, text, text) from public, anon, authenticated;

-- Служебная роль: функции на Vercel знают настоящий адрес (x-client-ip).
create or replace function public.record_client_touch(
  p_user_id uuid default null,
  p_guest_id uuid default null,
  p_device_id text default null,
  p_ip text default null,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  perform private.touch_device(p_user_id, p_guest_id, p_device_id, p_ip, p_user_agent);
end;
$$;

revoke all on function public.record_client_touch(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.record_client_touch(uuid, uuid, text, text, text) to service_role;

-- Активность из браузера: адрес и агент берутся из заголовков запроса.
create or replace function public.track_my_activity(
  p_event text,
  p_path text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    return;
  end if;

  if p_event not in ('session_started', 'session_ended', 'page_view') then
    raise exception 'unsupported activity event' using errcode = '22023';
  end if;

  if p_path is not null and (
    char_length(p_path) not between 1 and 120
    or p_path !~ '^/[A-Za-z0-9/_-]*$'
  ) then
    raise exception 'invalid activity path' using errcode = '22023';
  end if;

  update public.profiles
  set last_seen_at = now()
  where id = current_user_id;

  if p_event = 'session_started' then
    perform private.touch_device(current_user_id, null, null, private.request_ip(), private.request_user_agent());
  end if;

  if p_event = 'page_view' and exists (
    select 1
    from private.user_activity_events
    where user_id = current_user_id
      and event_type = p_event
      and path is not distinct from p_path
      and created_at > now() - interval '30 seconds'
  ) then
    return;
  end if;

  insert into private.user_activity_events (user_id, event_type, path)
  values (current_user_id, p_event, p_path);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Журнал запросов к функциям
-- ---------------------------------------------------------------------------

create table if not exists private.request_logs (
  id bigint generated always as identity primary key,
  request_id text,
  route text not null,
  method text not null default 'POST',
  status integer not null,
  user_id uuid,
  guest_id uuid,
  ip text,
  user_agent text,
  duration_ms integer,
  bytes_in integer,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists request_logs_created_idx on private.request_logs (created_at desc);
create index if not exists request_logs_user_idx on private.request_logs (user_id, created_at desc) where user_id is not null;
create index if not exists request_logs_route_status_idx on private.request_logs (route, status, created_at desc);
create index if not exists request_logs_request_id_idx on private.request_logs (request_id) where request_id is not null;

alter table private.request_logs enable row level security;
revoke all on table private.request_logs from public, anon, authenticated;

create or replace function public.record_request_log(
  p_route text,
  p_status integer,
  p_request_id text default null,
  p_method text default 'POST',
  p_user_id uuid default null,
  p_guest_id uuid default null,
  p_ip text default null,
  p_user_agent text default null,
  p_duration_ms integer default null,
  p_bytes_in integer default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  insert into private.request_logs (
    request_id, route, method, status, user_id, guest_id, ip, user_agent, duration_ms, bytes_in, error
  )
  values (
    left(p_request_id, 120), left(coalesce(p_route, ''), 60), left(coalesce(p_method, 'POST'), 10), coalesce(p_status, 0),
    p_user_id, p_guest_id, left(p_ip, 64), left(p_user_agent, 400), p_duration_ms, p_bytes_in, left(p_error, 400)
  );
end;
$$;

revoke all on function public.record_request_log(text, integer, text, text, uuid, uuid, text, text, integer, integer, text) from public, anon, authenticated;
grant execute on function public.record_request_log(text, integer, text, text, uuid, uuid, text, text, integer, integer, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Ошибки: события и группы по отпечатку
-- ---------------------------------------------------------------------------

create table if not exists private.error_groups (
  fingerprint text primary key,
  kind text not null,
  severity text not null default 'error',
  route text,
  title text not null,
  status text not null default 'new',
  occurrences integer not null default 0,
  users_affected integer not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  alerted_at timestamptz,
  constraint error_groups_kind_known check (kind in ('frontend', 'api', 'llm', 'payments', 'db')),
  constraint error_groups_severity_known check (severity in ('info', 'warning', 'error', 'critical')),
  constraint error_groups_status_known check (status in ('new', 'in_progress', 'resolved', 'ignored'))
);

create index if not exists error_groups_last_seen_idx on private.error_groups (last_seen_at desc);
create index if not exists error_groups_status_idx on private.error_groups (status, last_seen_at desc);

create table if not exists private.error_events (
  id bigint generated always as identity primary key,
  fingerprint text not null references private.error_groups(fingerprint) on delete cascade,
  kind text not null,
  severity text not null,
  route text,
  message text not null,
  stack text,
  request_id text,
  user_id uuid,
  guest_id uuid,
  ip text,
  input jsonb,
  environment jsonb,
  created_at timestamptz not null default now()
);

create index if not exists error_events_fingerprint_idx on private.error_events (fingerprint, created_at desc);
create index if not exists error_events_created_idx on private.error_events (created_at desc);
create index if not exists error_events_user_idx on private.error_events (user_id, created_at desc) where user_id is not null;

alter table private.error_groups enable row level security;
alter table private.error_events enable row level security;
revoke all on table private.error_groups from public, anon, authenticated;
revoke all on table private.error_events from public, anon, authenticated;

-- Отпечаток: вид, маршрут и сообщение без чисел, идентификаторов и адресов.
create or replace function private.error_fingerprint(p_kind text, p_route text, p_message text)
returns text
language sql
immutable
set search_path = ''
as $$
  select md5(
    coalesce(p_kind, '') || '|' || coalesce(p_route, '') || '|' ||
    left(regexp_replace(
      regexp_replace(lower(coalesce(p_message, '')), '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '<id>', 'g'),
      '[0-9]+', '<n>', 'g'
    ), 200)
  );
$$;

revoke all on function private.error_fingerprint(text, text, text) from public, anon, authenticated;

create or replace function private.record_error(
  p_kind text,
  p_severity text,
  p_route text,
  p_message text,
  p_stack text,
  p_request_id text,
  p_user_id uuid,
  p_guest_id uuid,
  p_ip text,
  p_input jsonb,
  p_environment jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  kind text := case when p_kind in ('frontend', 'api', 'llm', 'payments', 'db') then p_kind else 'api' end;
  severity text := case when p_severity in ('info', 'warning', 'error', 'critical') then p_severity else 'error' end;
  message text := left(coalesce(nullif(trim(p_message), ''), 'unknown error'), 1000);
  fp text := private.error_fingerprint(kind, p_route, message);
begin
  insert into private.error_groups as g (fingerprint, kind, severity, route, title, occurrences, users_affected)
  values (fp, kind, severity, left(p_route, 120), left(message, 200), 0, 0)
  on conflict (fingerprint) do update
  set last_seen_at = now(),
      severity = case when g.severity = 'critical' then 'critical' else excluded.severity end,
      -- Решённая ошибка вернулась - это снова новая.
      status = case when g.status = 'resolved' then 'new' else g.status end,
      resolved_at = case when g.status = 'resolved' then null else g.resolved_at end;

  insert into private.error_events (
    fingerprint, kind, severity, route, message, stack, request_id, user_id, guest_id, ip, input, environment
  )
  values (
    fp, kind, severity, left(p_route, 120), message, left(p_stack, 8000), left(p_request_id, 120),
    p_user_id, p_guest_id, left(p_ip, 64), p_input, p_environment
  );

  update private.error_groups g
  set occurrences = g.occurrences + 1,
      users_affected = (
        select count(distinct coalesce(e.user_id::text, e.guest_id::text, e.ip))
        from private.error_events e
        where e.fingerprint = fp
      )
  where g.fingerprint = fp;

  return fp;
end;
$$;

revoke all on function private.record_error(text, text, text, text, text, text, uuid, uuid, text, jsonb, jsonb) from public, anon, authenticated;

create or replace function public.record_error_event(
  p_kind text,
  p_severity text,
  p_route text,
  p_message text,
  p_stack text default null,
  p_request_id text default null,
  p_user_id uuid default null,
  p_guest_id uuid default null,
  p_ip text default null,
  p_input jsonb default null,
  p_environment jsonb default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  return private.record_error(p_kind, p_severity, p_route, p_message, p_stack, p_request_id, p_user_id, p_guest_id, p_ip, p_input, p_environment);
end;
$$;

revoke all on function public.record_error_event(text, text, text, text, text, text, uuid, uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.record_error_event(text, text, text, text, text, text, uuid, uuid, text, jsonb, jsonb) to service_role;

-- Ошибка из браузера. Гость тоже может сообщить, поэтому предел на адрес:
-- тридцать сообщений в минуту, дальше молча выбрасываем.
create or replace function public.report_client_error(
  p_message text,
  p_stack text default null,
  p_route text default null,
  p_environment jsonb default null,
  p_guest_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_ip text := private.request_ip();
  recent integer;
begin
  select count(*) into recent
  from private.error_events e
  where e.kind = 'frontend'
    and e.ip is not distinct from caller_ip
    and e.created_at > now() - interval '1 minute';
  if recent >= 30 then
    return;
  end if;

  perform private.record_error(
    'frontend',
    'error',
    left(coalesce(p_route, ''), 120),
    p_message,
    p_stack,
    null,
    (select auth.uid()),
    case when (select auth.uid()) is null then p_guest_id end,
    caller_ip,
    null,
    coalesce(p_environment, '{}'::jsonb) || jsonb_build_object('userAgent', private.request_user_agent())
  );
end;
$$;

revoke all on function public.report_client_error(text, text, text, jsonb, uuid) from public;
grant execute on function public.report_client_error(text, text, text, jsonb, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Полный лог решения: запрос к модели и ответ
-- ---------------------------------------------------------------------------

create table if not exists private.solution_logs (
  id uuid primary key default gen_random_uuid(),
  request_id text,
  user_id uuid,
  guest_id uuid,
  idempotency_key text not null,
  subject text not null default '',
  grade text not null default '',
  source text not null default '',
  task text not null default '',
  condition text not null default '',
  note text not null default '',
  photo_bytes integer not null default 0,
  models text not null default '',
  calls jsonb not null default '[]'::jsonb,
  request jsonb,
  response jsonb,
  issues jsonb not null default '[]'::jsonb,
  outcome text not null,
  status integer,
  error text,
  truncated boolean not null default false,
  answer_chars integer not null default 0,
  steps_count integer not null default 0,
  has_diagram boolean not null default false,
  seconds numeric(8,2) not null default 0,
  credits numeric(10,4),
  cost_kopecks integer,
  price_kopecks integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists solution_logs_created_idx on private.solution_logs (created_at desc);
create index if not exists solution_logs_user_idx on private.solution_logs (user_id, created_at desc) where user_id is not null;
create index if not exists solution_logs_key_idx on private.solution_logs (idempotency_key);
create index if not exists solution_logs_request_idx on private.solution_logs (request_id) where request_id is not null;
create index if not exists solution_logs_subject_idx on private.solution_logs (subject, created_at desc);

alter table private.solution_logs enable row level security;
revoke all on table private.solution_logs from public, anon, authenticated;

create or replace function public.record_solution_log(
  p_idempotency_key text,
  p_outcome text,
  p_request_id text default null,
  p_user_id uuid default null,
  p_guest_id uuid default null,
  p_subject text default '',
  p_grade text default '',
  p_source text default '',
  p_task text default '',
  p_condition text default '',
  p_note text default '',
  p_photo_bytes integer default 0,
  p_models text default '',
  p_calls jsonb default '[]'::jsonb,
  p_request jsonb default null,
  p_response jsonb default null,
  p_issues jsonb default '[]'::jsonb,
  p_status integer default null,
  p_error text default null,
  p_truncated boolean default false,
  p_answer_chars integer default 0,
  p_steps_count integer default 0,
  p_has_diagram boolean default false,
  p_seconds numeric default 0,
  p_credits numeric default null,
  p_cost_kopecks integer default null,
  p_price_kopecks integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  log_id uuid;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_outcome not in ('solved', 'failed', 'rejected') then
    raise exception 'unknown solve outcome' using errcode = '22023';
  end if;

  insert into private.solution_logs (
    request_id, user_id, guest_id, idempotency_key, subject, grade, source, task, condition, note, photo_bytes,
    models, calls, request, response, issues, outcome, status, error, truncated, answer_chars, steps_count,
    has_diagram, seconds, credits, cost_kopecks, price_kopecks
  )
  values (
    left(p_request_id, 120), p_user_id, p_guest_id, left(coalesce(p_idempotency_key, ''), 160),
    left(coalesce(p_subject, ''), 150), left(coalesce(p_grade, ''), 40), left(coalesce(p_source, ''), 20),
    left(coalesce(p_task, ''), 120), left(coalesce(p_condition, ''), 12000), left(coalesce(p_note, ''), 400),
    coalesce(p_photo_bytes, 0), left(coalesce(p_models, ''), 200), coalesce(p_calls, '[]'::jsonb),
    p_request, p_response, coalesce(p_issues, '[]'::jsonb), p_outcome, p_status, left(p_error, 400),
    coalesce(p_truncated, false), coalesce(p_answer_chars, 0), coalesce(p_steps_count, 0),
    coalesce(p_has_diagram, false), coalesce(p_seconds, 0), p_credits, p_cost_kopecks, coalesce(p_price_kopecks, 0)
  )
  returning id into log_id;

  return log_id;
end;
$$;

revoke all on function public.record_solution_log(text, text, text, uuid, uuid, text, text, text, text, text, text, integer, text, jsonb, jsonb, jsonb, jsonb, integer, text, boolean, integer, integer, boolean, numeric, numeric, integer, integer)
  from public, anon, authenticated;
grant execute on function public.record_solution_log(text, text, text, uuid, uuid, text, text, text, text, text, text, integer, text, jsonb, jsonb, jsonb, jsonb, integer, text, boolean, integer, integer, boolean, numeric, numeric, integer, integer)
  to service_role;

-- Себестоимость: к строке добавляется, кому решали и как кончилось.
alter table private.solution_costs
  add column if not exists user_id uuid,
  add column if not exists guest_id uuid,
  add column if not exists idempotency_key text,
  add column if not exists truncated boolean not null default false,
  add column if not exists answer_chars integer not null default 0,
  add column if not exists has_diagram boolean not null default false,
  add column if not exists request_id text;

create index if not exists solution_costs_user_idx on private.solution_costs (user_id, created_at desc) where user_id is not null;
create index if not exists solution_costs_subject_idx on private.solution_costs (subject, created_at desc);

create or replace function public.record_solution_cost(
  p_subject text,
  p_source text,
  p_models text,
  p_calls integer,
  p_credits numeric,
  p_cost_kopecks integer,
  p_price_kopecks integer,
  p_seconds numeric,
  p_outcome text,
  p_user_id uuid default null,
  p_guest_id uuid default null,
  p_idempotency_key text default null,
  p_truncated boolean default false,
  p_answer_chars integer default 0,
  p_has_diagram boolean default false,
  p_request_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_outcome not in ('solved', 'failed') then
    raise exception 'unknown solve outcome' using errcode = '22023';
  end if;

  insert into private.solution_costs (
    subject, source, models, calls, credits, cost_kopecks, price_kopecks, seconds, outcome,
    user_id, guest_id, idempotency_key, truncated, answer_chars, has_diagram, request_id
  )
  values (
    left(coalesce(p_subject, ''), 150),
    left(coalesce(p_source, ''), 20),
    left(coalesce(p_models, ''), 200),
    greatest(coalesce(p_calls, 0), 0),
    p_credits,
    p_cost_kopecks,
    coalesce(p_price_kopecks, 0),
    coalesce(p_seconds, 0),
    p_outcome,
    p_user_id, p_guest_id, left(p_idempotency_key, 160), coalesce(p_truncated, false),
    coalesce(p_answer_chars, 0), coalesce(p_has_diagram, false), left(p_request_id, 120)
  );
end;
$function$;

drop function if exists public.record_solution_cost(text, text, text, integer, numeric, integer, integer, numeric, text);

revoke all on function public.record_solution_cost(text, text, text, integer, numeric, integer, integer, numeric, text, uuid, uuid, text, boolean, integer, boolean, text)
  from public, anon, authenticated;
grant execute on function public.record_solution_cost(text, text, text, integer, numeric, integer, integer, numeric, text, uuid, uuid, text, boolean, integer, boolean, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. Оценка решения учеником: «помогло / не помогло»
-- ---------------------------------------------------------------------------

create table if not exists private.solution_ratings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  guest_id uuid,
  solution_key text not null,
  subject text not null default '',
  helpful boolean not null,
  comment text,
  created_at timestamptz not null default now(),
  constraint solution_ratings_owner_present check (user_id is not null or guest_id is not null),
  constraint solution_ratings_comment_length check (comment is null or char_length(comment) <= 500)
);

create unique index if not exists solution_ratings_identity_idx
  on private.solution_ratings (coalesce(user_id::text, guest_id::text), solution_key);
create index if not exists solution_ratings_created_idx on private.solution_ratings (created_at desc);

alter table private.solution_ratings enable row level security;
revoke all on table private.solution_ratings from public, anon, authenticated;

create or replace function public.rate_homework_solution(
  p_solution_key text,
  p_subject text,
  p_helpful boolean,
  p_comment text default null,
  p_guest_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  key text := left(trim(coalesce(p_solution_key, '')), 200);
begin
  if key = '' or p_helpful is null then
    raise exception 'invalid rating' using errcode = '22023';
  end if;
  if current_user_id is null and p_guest_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  insert into private.solution_ratings (user_id, guest_id, solution_key, subject, helpful, comment)
  values (current_user_id, case when current_user_id is null then p_guest_id end, key, left(coalesce(p_subject, ''), 150), p_helpful, nullif(left(trim(coalesce(p_comment, '')), 500), ''))
  on conflict (coalesce(user_id::text, guest_id::text), solution_key) do update
  set helpful = excluded.helpful,
      comment = excluded.comment,
      created_at = now();

  return jsonb_build_object('helpful', p_helpful);
end;
$$;

revoke all on function public.rate_homework_solution(text, text, boolean, text, uuid) from public;
grant execute on function public.rate_homework_solution(text, text, boolean, text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Сроки хранения
-- ---------------------------------------------------------------------------
--
-- Журналы запросов и ошибки - 30 дней (ТЗ: не меньше 30). Логи решений и
-- себестоимость - 90 дней: по ним пересматривают цену. Устройства - 180.

create or replace function private.purge_expired_records()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed_events integer;
  removed_jobs integer;
  removed_guest_solutions integer;
  removed_guest_grants integer;
  removed_request_logs integer;
  removed_error_events integer;
  removed_solution_logs integer;
  removed_devices integer;
begin
  with purged as (
    delete from private.user_activity_events
    where created_at < now() - interval '90 days'
    returning 1
  )
  select count(*)::integer into removed_events from purged;

  with purged as (
    delete from public.homework_jobs
    where status in ('done', 'failed', 'canceled')
      and updated_at < now() - interval '30 days'
    returning 1
  )
  select count(*)::integer into removed_jobs from purged;

  with purged as (
    delete from private.guest_generated_solutions
    where created_at < now() - interval '7 days'
    returning 1
  )
  select count(*)::integer into removed_guest_solutions from purged;

  with purged as (
    delete from private.guest_solution_grants
    where created_at < now() - interval '180 days'
    returning 1
  )
  select count(*)::integer into removed_guest_grants from purged;

  with purged as (
    delete from private.request_logs
    where created_at < now() - interval '30 days'
    returning 1
  )
  select count(*)::integer into removed_request_logs from purged;

  with purged as (
    delete from private.error_events
    where created_at < now() - interval '30 days'
    returning 1
  )
  select count(*)::integer into removed_error_events from purged;

  delete from private.error_groups g
  where not exists (select 1 from private.error_events e where e.fingerprint = g.fingerprint)
    and g.last_seen_at < now() - interval '30 days';

  with purged as (
    delete from private.solution_logs
    where created_at < now() - interval '90 days'
    returning 1
  )
  select count(*)::integer into removed_solution_logs from purged;

  with purged as (
    delete from private.user_devices
    where last_seen_at < now() - interval '180 days'
    returning 1
  )
  select count(*)::integer into removed_devices from purged;

  delete from private.admin_request_log where created_at < now() - interval '90 days';

  return jsonb_build_object(
    'activityEvents', removed_events,
    'jobs', removed_jobs,
    'guestSolutions', removed_guest_solutions,
    'guestGrants', removed_guest_grants,
    'requestLogs', removed_request_logs,
    'errorEvents', removed_error_events,
    'solutionLogs', removed_solution_logs,
    'devices', removed_devices
  );
end;
$$;

revoke all on function private.purge_expired_records() from public, anon, authenticated;
