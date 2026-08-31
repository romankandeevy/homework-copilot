-- Очередь решений: одна строка на запрос, видимая со всех устройств.
--
-- Раньше состояние «решаем» жило только в React-состоянии вкладки. Отсюда три
-- поломки, которые видел ученик:
--
-- 1. Перезаход терял задачу. Функция на Vercel продолжала считать и сохраняла
--    решение, но вкладка об этом уже не знала: главная показывала пустоту, а
--    восстановленное из памяти состояние — вечное «Решаем задачу».
-- 2. Вторую задачу отправить было некуда: одно состояние — одна задача.
-- 3. На телефоне не было видно, что задача запущена с ноутбука.
--
-- Строка задачи — общий источник правды. Клиент её заводит, сервер двигает по
-- стадиям, любое устройство читает. Стадии не выдуманы: их проставляет решатель
-- там, где действительно переходит к следующей работе.

create table if not exists public.homework_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  -- Гость решает без аккаунта, но очередь и стадии ему нужны те же.
  guest_id uuid,
  idempotency_key text not null,
  -- Метка вкладки-владельца. Задачу выполняет то устройство, которое её
  -- завело: только у него есть фотография и сессия. Остальные показывают.
  device_id text not null default '',
  textbook_id text not null,
  task text not null,
  source text not null,
  subject text not null default '',
  grade text not null default '',
  condition_preview text not null default '',
  status text not null default 'queued',
  stage text not null default 'queued',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  constraint homework_jobs_owner_present check (user_id is not null or guest_id is not null),
  constraint homework_jobs_source_known check (source in ('number', 'photo', 'text')),
  constraint homework_jobs_status_known check (status in ('queued', 'running', 'done', 'failed', 'canceled')),
  constraint homework_jobs_stage_known check (stage in ('queued', 'reading', 'solving', 'checking', 'writing', 'done', 'failed')),
  constraint homework_jobs_key_length check (char_length(idempotency_key) between 8 and 160),
  constraint homework_jobs_text_length check (
    char_length(textbook_id) <= 150
    and char_length(task) <= 120
    and char_length(subject) <= 150
    and char_length(grade) <= 40
    and char_length(condition_preview) <= 400
    and char_length(coalesce(error, '')) <= 400
    and char_length(device_id) <= 64
  )
);

comment on table public.homework_jobs is
  'Очередь запросов решения. Заводит клиент, стадии проставляет решатель, читают все устройства ученика.';

create unique index if not exists homework_jobs_user_key_idx
  on public.homework_jobs (user_id, idempotency_key)
  where user_id is not null;

create unique index if not exists homework_jobs_guest_key_idx
  on public.homework_jobs (guest_id, idempotency_key)
  where user_id is null;

create index if not exists homework_jobs_user_created_idx
  on public.homework_jobs (user_id, created_at desc)
  where user_id is not null;

create index if not exists homework_jobs_unfinished_idx
  on public.homework_jobs (status, updated_at)
  where status in ('queued', 'running');

alter table public.homework_jobs enable row level security;

-- Прямой доступ есть только у владельца-аккаунта и только на чтение: заводят
-- и двигают строки RPC, чтобы клиент не мог выставить себе чужую стадию.
drop policy if exists "homework_jobs_owner_reads" on public.homework_jobs;
create policy "homework_jobs_owner_reads"
  on public.homework_jobs
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Брошенные задачи не висят вечно
-- ---------------------------------------------------------------------------
--
-- Функция решателя живёт максимум 300 секунд и на каждой стадии обновляет
-- строку. Если строка не двигалась пять минут — процесс умер, и «Решаем» надо
-- честно закрыть, а не показывать вечно. Очередь ждёт дольше: пока впереди
-- идут длинные задачи, её строка законно не меняется.

create or replace function private.expire_stale_homework_jobs()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.homework_jobs
  set status = 'failed',
      stage = 'failed',
      error = coalesce(error, 'Решение прервалось: страница закрылась или пропала связь. Деньги вернутся на баланс'),
      finished_at = now(),
      updated_at = now()
  where (status = 'running' and updated_at < now() - interval '5 minutes')
     or (status = 'queued' and created_at < now() - interval '20 minutes');
$$;

revoke all on function private.expire_stale_homework_jobs() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Клиент: завести задачу, прочитать очередь, закрыть свою неудачу
-- ---------------------------------------------------------------------------

create or replace function public.start_homework_job(
  p_idempotency_key text,
  p_device_id text,
  p_textbook_id text,
  p_task text,
  p_source text,
  p_subject text default '',
  p_grade text default '',
  p_condition_preview text default '',
  p_guest_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  owner_guest_id uuid := case when current_user_id is null then p_guest_id end;
  job public.homework_jobs%rowtype;
begin
  if current_user_id is null and owner_guest_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if current_user_id is not null then
    perform private.assert_account_not_banned(current_user_id);
  end if;

  insert into public.homework_jobs (
    user_id, guest_id, idempotency_key, device_id, textbook_id, task, source,
    subject, grade, condition_preview
  )
  values (
    current_user_id,
    owner_guest_id,
    p_idempotency_key,
    left(coalesce(p_device_id, ''), 64),
    left(coalesce(p_textbook_id, ''), 150),
    left(coalesce(p_task, ''), 120),
    p_source,
    left(coalesce(p_subject, ''), 150),
    left(coalesce(p_grade, ''), 40),
    left(coalesce(p_condition_preview, ''), 400)
  )
  on conflict do nothing
  returning * into job;

  -- Повторная отправка того же ключа — не новая задача, а та же самая.
  if job.id is null then
    select * into job
    from public.homework_jobs
    where idempotency_key = p_idempotency_key
      and (
        (current_user_id is not null and user_id = current_user_id)
        or (current_user_id is null and user_id is null and guest_id = owner_guest_id)
      );
  end if;

  if job.id is null then
    raise exception 'job not created' using errcode = 'P0001';
  end if;

  return to_jsonb(job);
end;
$$;

revoke all on function public.start_homework_job(text, text, text, text, text, text, text, text, uuid)
  from public;
grant execute on function public.start_homework_job(text, text, text, text, text, text, text, text, uuid)
  to anon, authenticated;

create or replace function public.list_homework_jobs(p_guest_id uuid default null)
returns setof jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  perform private.expire_stale_homework_jobs();

  if current_user_id is not null then
    return query
      select to_jsonb(job)
      from public.homework_jobs as job
      where job.user_id = current_user_id
        and job.created_at > now() - interval '2 days'
      order by job.created_at desc
      limit 40;
    return;
  end if;

  if p_guest_id is null then
    return;
  end if;

  return query
    select to_jsonb(job)
    from public.homework_jobs as job
    where job.user_id is null
      and job.guest_id = p_guest_id
      and job.created_at > now() - interval '2 days'
    order by job.created_at desc
    limit 40;
end;
$$;

revoke all on function public.list_homework_jobs(uuid) from public;
grant execute on function public.list_homework_jobs(uuid) to anon, authenticated;

-- Клиент закрывает только свою задачу и только в терминальное состояние: его
-- запрос упал, связь оборвалась, ученик снял задачу с очереди. Двигать строку
-- по рабочим стадиям может лишь решатель.
create or replace function public.close_homework_job(
  p_idempotency_key text,
  p_status text,
  p_error text default null,
  p_guest_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  job public.homework_jobs%rowtype;
begin
  if p_status not in ('failed', 'canceled') then
    raise exception 'invalid job status' using errcode = '22023';
  end if;

  update public.homework_jobs
  set status = p_status,
      stage = case when p_status = 'failed' then 'failed' else stage end,
      error = left(coalesce(p_error, error), 400),
      finished_at = now(),
      updated_at = now()
  where idempotency_key = p_idempotency_key
    and status in ('queued', 'running')
    and (
      (current_user_id is not null and user_id = current_user_id)
      or (current_user_id is null and user_id is null and guest_id = p_guest_id)
    )
  returning * into job;

  return case when job.id is null then null else to_jsonb(job) end;
end;
$$;

revoke all on function public.close_homework_job(text, text, text, uuid) from public;
grant execute on function public.close_homework_job(text, text, text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Решатель: стадии
-- ---------------------------------------------------------------------------
--
-- Право есть только у service_role: стадия — свидетельство сервера о том, что
-- работа дошла до следующего шага, и подделывать его клиенту нельзя.

create or replace function public.report_homework_job(
  p_idempotency_key text,
  p_stage text,
  p_user_id uuid default null,
  p_guest_id uuid default null,
  p_error text default null,
  p_task text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.homework_jobs%rowtype;
  next_status text := case
    when p_stage = 'done' then 'done'
    when p_stage = 'failed' then 'failed'
    else 'running'
  end;
begin
  if p_stage not in ('reading', 'solving', 'checking', 'writing', 'done', 'failed') then
    raise exception 'invalid job stage' using errcode = '22023';
  end if;

  update public.homework_jobs
  set stage = p_stage,
      status = next_status,
      error = case when p_stage = 'failed' then left(coalesce(p_error, error), 400) else null end,
      task = coalesce(left(p_task, 120), task),
      started_at = coalesce(started_at, now()),
      finished_at = case when next_status = 'running' then null else now() end,
      updated_at = now()
  where idempotency_key = p_idempotency_key
    and (
      (p_user_id is not null and user_id = p_user_id)
      or (p_user_id is null and p_guest_id is not null and user_id is null and guest_id = p_guest_id)
    )
    and status in ('queued', 'running')
  returning * into job;

  return case when job.id is null then null else to_jsonb(job) end;
end;
$$;

revoke all on function public.report_homework_job(text, text, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.report_homework_job(text, text, uuid, uuid, text, text)
  to service_role;
