-- Анонимные RPC очереди и оценок с пределами (аудит 16 сентября, В5).
--
-- `start_homework_job`, `list_homework_jobs`, `close_homework_job` и
-- `rate_homework_solution` выданы anon: гостю нужны очередь и оценка. Ключ
-- anon лежит в бандле, и скрипт с ним вставлял бы строки в очередь и оценки
-- без предела: дашборд считал бы их гостями, а `expire_stale_homework_jobs()`
-- - полный проход по очереди - шёл на каждом опросе каждой вкладки.
--
-- 1. `start_homework_job` для гостя: не больше 10 незакрытых строк на метку
--    и не больше `guest_jobs_hourly` (по умолчанию 600) новых гостевых строк
--    в час на весь сервис. Бесплатное решение у гостя одно, форма держит
--    одну задачу, так что живой гость в пределы не упирается. Отказ клиент
--    переживает: `startSolutionJob` вернёт null, и задача решится во вкладке
--    без строки в базе (src/lib/solutionJobs.ts).
-- 2. `list_homework_jobs` закрывает сроком только строки того, кто
--    спрашивает. Общий проход - задача cron раз в минуту
--    (`expire-stale-homework-jobs`): сроки там пять и двадцать минут, минута
--    опоздания ничего не меняет.
-- 3. `rate_homework_solution` принимает оценку только решения, которое у
--    этого ученика есть: доступ к решению из библиотеки, личное решение или
--    строка очереди с тем же учебником и задачей. Гость оценивает, только
--    если ему выдавали бесплатное решение, и не больше пяти разных решений.
--
-- Тела функций - из 20260831180000 и 20260911090100, изменены только пределы.

insert into private.app_settings (key, value)
values ('guest_jobs_hourly', '600'::jsonb)
on conflict (key) do nothing;

create index if not exists homework_jobs_guest_created_idx
  on public.homework_jobs (created_at desc)
  where user_id is null;

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
  guest_open integer;
  guest_jobs_last_hour integer;
  guest_jobs_limit integer;
begin
  if current_user_id is null and owner_guest_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if current_user_id is not null then
    perform private.assert_account_not_banned(current_user_id);
  end if;

  if current_user_id is null then
    -- Повтор того же ключа - та же задача, предел её не касается.
    select * into job
    from public.homework_jobs
    where user_id is null
      and guest_id = owner_guest_id
      and idempotency_key = p_idempotency_key;
    if job.id is not null then
      return to_jsonb(job);
    end if;

    select count(*) into guest_open
    from public.homework_jobs
    where user_id is null
      and guest_id = owner_guest_id
      and status in ('queued', 'running');
    if guest_open >= 10 then
      raise exception 'too many unfinished guest jobs' using errcode = 'P0001';
    end if;

    guest_jobs_limit := coalesce(
      (
        select case when jsonb_typeof(s.value) = 'number' then greatest(0, least((s.value #>> '{}')::numeric, 1000000))::integer end
        from private.app_settings s
        where s.key = 'guest_jobs_hourly'
      ),
      600
    );
    select count(*) into guest_jobs_last_hour
    from public.homework_jobs
    where user_id is null
      and created_at > now() - interval '1 hour';
    if guest_jobs_last_hour >= guest_jobs_limit then
      raise exception 'guest job limit reached' using errcode = 'P0001';
    end if;
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

  -- Повторная отправка того же ключа - не новая задача, а та же самая.
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

-- Срок для строк одного владельца. Тот же, что у общего прохода
-- private.expire_stale_homework_jobs, но по индексу владельца, а не по всей очереди.
create or replace function private.expire_own_stale_homework_jobs(p_user_id uuid, p_guest_id uuid)
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
  where (
      (p_user_id is not null and user_id = p_user_id)
      or (p_user_id is null and p_guest_id is not null and user_id is null and guest_id = p_guest_id)
    )
    and (
      (status = 'running' and updated_at < now() - interval '5 minutes')
      or (status = 'queued' and created_at < now() - interval '20 minutes')
    );
$$;

revoke all on function private.expire_own_stale_homework_jobs(uuid, uuid) from public, anon, authenticated;

create or replace function public.list_homework_jobs(p_guest_id uuid default null)
returns setof jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is not null then
    perform private.expire_own_stale_homework_jobs(current_user_id, null);
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

  perform private.expire_own_stale_homework_jobs(null, p_guest_id);
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

select cron.unschedule('expire-stale-homework-jobs')
where exists (select 1 from cron.job where jobname = 'expire-stale-homework-jobs');

select cron.schedule(
  'expire-stale-homework-jobs',
  '* * * * *',
  $job$ select private.expire_stale_homework_jobs(); $job$
);

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
  owner_guest_id uuid := case when current_user_id is null then p_guest_id end;
  guest_rated integer;
begin
  if key = '' or p_helpful is null then
    raise exception 'invalid rating' using errcode = '22023';
  end if;
  if current_user_id is null and owner_guest_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  -- Ключ оценки - «учебник:задача» (SolutionRating в src/App.tsx).
  if current_user_id is not null then
    if not (
      exists (
        select 1
        from public.homework_solution_access access
        join public.homework_solutions hs on hs.id = access.solution_id
        where access.user_id = current_user_id
          and hs.textbook_id || ':' || hs.task = key
      )
      or exists (
        select 1 from private.user_generated_homework_solutions ug
        where ug.user_id = current_user_id
          and ug.textbook_id || ':' || ug.task = key
      )
      or exists (
        select 1 from public.homework_jobs job
        where job.user_id = current_user_id
          and job.textbook_id || ':' || job.task = key
      )
    ) then
      raise exception 'solution not found' using errcode = 'P0002';
    end if;
  else
    if not (
      exists (select 1 from private.guest_solution_grants g where g.guest_id = owner_guest_id)
      or exists (select 1 from private.guest_generated_solutions gs where gs.guest_id = owner_guest_id)
    ) then
      raise exception 'solution not found' using errcode = 'P0002';
    end if;

    select count(*) into guest_rated
    from private.solution_ratings r
    where r.user_id is null
      and r.guest_id = owner_guest_id
      and r.solution_key <> key;
    if guest_rated >= 5 then
      raise exception 'too many ratings' using errcode = 'P0001';
    end if;
  end if;

  insert into private.solution_ratings (user_id, guest_id, solution_key, subject, helpful, comment)
  values (current_user_id, owner_guest_id, key, left(coalesce(p_subject, ''), 150), p_helpful, nullif(left(trim(coalesce(p_comment, '')), 500), ''))
  on conflict (coalesce(user_id::text, guest_id::text), solution_key) do update
  set helpful = excluded.helpful,
      comment = excluded.comment,
      created_at = now();

  return jsonb_build_object('helpful', p_helpful);
end;
$$;

revoke all on function public.rate_homework_solution(text, text, boolean, text, uuid) from public;
grant execute on function public.rate_homework_solution(text, text, boolean, text, uuid) to anon, authenticated;
