-- Настройки, вторая версия.
--
-- 1. История изменений прямо в подвкладке настроек: последние записи
--    журнала действий по одной сущности (тарифы, промокоды, промпты,
--    предметы, флаги, сайт, администраторы).
-- 2. Массовое включение, выключение и раскатка фиче-флагов одной
--    транзакцией, по записи в журнале на каждый изменённый флаг.
-- 3. Проверка промпта решателя без сохранения. Сам прогон делает функция
--    на Vercel (`prompt_preview` в server/admin.ts): она зовёт модель тем же
--    движком, что и решатель, но мимо кошелька, мимо очереди ученика и мимо
--    каталога решений. База здесь отвечает за три вещи, которые нельзя
--    доверить интерфейсу: роль и второй фактор, предел частоты (прогон стоит
--    денег) и журнал - кто, что и во сколько обошлось.
--
-- Цена решения здесь не участвует: проверка ничего не списывает и ничего
-- не продаёт.

-- ---------------------------------------------------------------------------
-- 1. История изменений по разделу настроек
-- ---------------------------------------------------------------------------

create or replace function public.admin_settings_history(
  p_scope text,
  p_key text default null,
  p_limit integer default 8
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  events text[];
  key_field text;
  safe_limit integer := greatest(1, least(coalesce(p_limit, 8), 50));
  total integer;
begin
  perform private.require_admin('admin');

  events := case p_scope
    when 'plans' then array['plan_saved', 'plan_deleted', 'plan_disabled']
    when 'promo' then array['promo_saved']
    when 'prompts' then array['prompt_saved', 'prompt_rolled_back', 'prompt_disabled', 'prompt_previewed']
    when 'subjects' then array['subjects_saved']
    when 'flags' then array['flag_saved']
    when 'site' then array['setting_saved']
    when 'admins' then array['admin_role_changed']
  end;
  if events is null then
    raise exception 'Неизвестный раздел истории.' using errcode = '22023';
  end if;

  -- По какому полю payload отбирать одну сущность: предмет у промптов,
  -- ключ у флагов и настроек, код у промокодов, идентификатор у тарифов.
  key_field := case p_scope
    when 'plans' then 'planId'
    when 'promo' then 'code'
    when 'prompts' then 'subjectId'
    when 'flags' then 'key'
    when 'site' then 'key'
  end;

  select count(*) into total
  from private.admin_audit_log l
  where l.event_type = any(events)
    and (p_key is null or key_field is null or l.payload ->> key_field = p_key);

  return jsonb_build_object(
    'total', total,
    'events', to_jsonb(events),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'event', l.event_type,
        'actorEmail', au.email,
        'actorRole', l.actor_role,
        'targetEmail', tu.email,
        'payload', l.payload,
        -- Текст промпта до 8000 знаков дважды на запись - истории он не
        -- нужен: вместо него длина, а сам текст лежит в версиях.
        'before', case
          when p_scope = 'prompts' and jsonb_typeof(l.before_value) = 'object'
            then (l.before_value - 'body') || jsonb_build_object('chars', char_length(l.before_value ->> 'body'))
          else l.before_value
        end,
        'after', case
          when p_scope = 'prompts' and jsonb_typeof(l.after_value) = 'object'
            then (l.after_value - 'body') || jsonb_build_object('chars', char_length(l.after_value ->> 'body'))
          else l.after_value
        end,
        'createdAt', l.created_at
      ) order by l.created_at desc)
      from (
        select *
        from private.admin_audit_log l
        where l.event_type = any(events)
          and (p_key is null or key_field is null or l.payload ->> key_field = p_key)
        order by l.created_at desc
        limit safe_limit
      ) l
      left join auth.users au on au.id = l.actor_id
      left join auth.users tu on tu.id = l.target_user_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_settings_history(text, text, integer) from public, anon;
grant execute on function public.admin_settings_history(text, text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Массовые действия с фиче-флагами
-- ---------------------------------------------------------------------------
--
-- enable  - включить для всех (раскатка 100 %);
-- disable - выключить, процент раскатки сохраняется;
-- rollout - включить для p_rollout процентов людей.
-- Всё или ничего: неизвестный ключ отменяет всю пачку.

create or replace function public.admin_flags_bulk(
  p_keys text[],
  p_action text,
  p_rollout integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin('admin');
  keys text[];
  flag_key text;
  previous private.feature_flags%rowtype;
  saved private.feature_flags%rowtype;
  next_enabled boolean;
  next_rollout integer;
  changed integer := 0;
begin
  if p_action is null or p_action not in ('enable', 'disable', 'rollout') then
    raise exception 'Неизвестное массовое действие с флагами.' using errcode = '22023';
  end if;

  select array_agg(distinct lower(trim(k)) order by lower(trim(k))) into keys
  from unnest(coalesce(p_keys, array[]::text[])) k
  where trim(coalesce(k, '')) <> '';

  if keys is null or cardinality(keys) = 0 or cardinality(keys) > 100 then
    raise exception 'Выбери от 1 до 100 флагов.' using errcode = '22023';
  end if;
  if p_action = 'rollout' and (p_rollout is null or p_rollout < 0 or p_rollout > 100) then
    raise exception 'Раскатка - целое число от 0 до 100.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(keys) k where not exists (select 1 from private.feature_flags f where f.key = k)) then
    raise exception 'flag not found' using errcode = 'P0002';
  end if;

  foreach flag_key in array keys loop
    select * into previous from private.feature_flags where key = flag_key for update;
    next_enabled := p_action <> 'disable';
    next_rollout := case p_action
      when 'enable' then 100
      when 'rollout' then p_rollout
      else previous.rollout_percent
    end;
    -- Флаг уже в нужном состоянии: не трогаем ни отметку времени, ни журнал.
    continue when previous.enabled = next_enabled and previous.rollout_percent = next_rollout;

    update private.feature_flags
    set enabled = next_enabled, rollout_percent = next_rollout, updated_by = actor, updated_at = now()
    where key = flag_key
    returning * into saved;

    changed := changed + 1;
    perform private.audit('flag_saved', null, jsonb_build_object('key', flag_key, 'bulk', p_action),
      to_jsonb(previous), to_jsonb(saved));
  end loop;

  return jsonb_build_object('selected', cardinality(keys), 'changed', changed);
end;
$$;

revoke all on function public.admin_flags_bulk(text[], text, integer) from public, anon;
grant execute on function public.admin_flags_bulk(text[], text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Проверка промпта решателя без сохранения
-- ---------------------------------------------------------------------------
--
-- Строка на каждую проверку: кто запустил, на какой задаче, с каким текстом
-- промпта, чем кончилось и во сколько кредитов шлюза обошлось. По этой же
-- таблице считается предел: 6 прогонов в час на администратора и 30 за
-- сутки на всех. Сравнение «было/стало» - два прогона и считается за два.
-- Проверка, которая висит дольше шести минут, - потерянная (функцию на
-- Vercel убили по сроку), но в предел она всё равно входит: за вызов модели
-- уже заплачено.

create table if not exists private.admin_prompt_previews (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete cascade,
  subject_id text not null,
  grade text not null,
  prompt_body text not null,
  condition text not null,
  compare boolean not null default false,
  runs integer not null,
  status text not null default 'running',
  current_version integer,
  result jsonb,
  credits numeric(10,4),
  seconds numeric(8,2),
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint admin_prompt_previews_status_known check (status in ('running', 'done', 'failed')),
  constraint admin_prompt_previews_runs_range check (runs between 1 and 2),
  constraint admin_prompt_previews_prompt_length check (char_length(prompt_body) between 1 and 8000),
  constraint admin_prompt_previews_condition_length check (char_length(condition) between 15 and 1500)
);

create index if not exists admin_prompt_previews_actor_idx on private.admin_prompt_previews (actor_id, created_at desc);
create index if not exists admin_prompt_previews_subject_idx on private.admin_prompt_previews (subject_id, created_at desc);
create index if not exists admin_prompt_previews_created_idx on private.admin_prompt_previews (created_at desc);

alter table private.admin_prompt_previews enable row level security;
revoke all on table private.admin_prompt_previews from public, anon, authenticated;

-- Сколько стоит прогон и сколько осталось в пределе. Стоимость - по живым
-- решениям предмета за 30 дней (private.solution_costs), а не по памяти.
create or replace function public.admin_prompt_preview_quota(p_subject_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin('admin');
begin
  return jsonb_build_object(
    'hourLimit', 6,
    'dayLimit', 30,
    'hourUsed', (
      select coalesce(sum(runs), 0) from private.admin_prompt_previews
      where actor_id = actor and created_at > now() - interval '1 hour'
    ),
    'dayUsed', (
      select coalesce(sum(runs), 0) from private.admin_prompt_previews
      where created_at > now() - interval '24 hours'
    ),
    'running', exists (
      select 1 from private.admin_prompt_previews
      where actor_id = actor and status = 'running' and created_at > now() - interval '6 minutes'
    ),
    'subjectAvgCredits', (
      select round(avg(credits), 2) from private.solution_costs
      where outcome = 'solved' and credits is not null and subject = p_subject_name
        and created_at > now() - interval '30 days'
    ),
    'subjectMaxCredits', (
      select max(credits) from private.solution_costs
      where outcome = 'solved' and credits is not null and subject = p_subject_name
        and created_at > now() - interval '30 days'
    ),
    'subjectSamples', (
      select count(*) from private.solution_costs
      where outcome = 'solved' and credits is not null and subject = p_subject_name
        and created_at > now() - interval '30 days'
    ),
    'overallAvgCredits', (
      select round(avg(credits), 2) from private.solution_costs
      where outcome = 'solved' and credits is not null and created_at > now() - interval '30 days'
    ),
    'spent30d', (
      select coalesce(sum(credits), 0) from private.admin_prompt_previews
      where created_at > now() - interval '30 days'
    )
  );
end;
$$;

create or replace function public.admin_prompt_preview_start(
  p_subject_id text,
  p_grade text,
  p_prompt text,
  p_condition text,
  p_compare boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin('admin');
  body text := trim(coalesce(p_prompt, ''));
  task text := trim(coalesce(p_condition, ''));
  grade_name text := trim(coalesce(p_grade, ''));
  run_count integer := case when coalesce(p_compare, false) then 2 else 1 end;
  active_prompt private.solver_prompts%rowtype;
  hour_used integer;
  day_used integer;
  preview_id uuid;
begin
  if p_subject_id is null or not exists (select 1 from private.subject_settings where subject_id = p_subject_id) then
    raise exception 'Неизвестный предмет.' using errcode = '22023';
  end if;
  if char_length(body) < 1 or char_length(body) > 8000 then
    raise exception 'Промпт - от 1 до 8000 символов.' using errcode = '22023';
  end if;
  if char_length(task) < 15 or char_length(task) > 1500 then
    raise exception 'Пример задачи - от 15 до 1500 символов.' using errcode = '22023';
  end if;
  if grade_name not in ('5 класс', '6 класс', '7 класс', '8 класс', '9 класс', '10 класс', '11 класс', 'Университет') then
    raise exception 'Выбери класс из списка.' using errcode = '22023';
  end if;

  -- Проверки предела и вставка идут по очереди: два одновременных запуска
  -- не должны оба пройти под последний свободный прогон.
  perform pg_advisory_xact_lock(hashtext('admin_prompt_preview_start'));

  if exists (
    select 1 from private.admin_prompt_previews
    where actor_id = actor and status = 'running' and created_at > now() - interval '6 minutes'
  ) then
    raise exception 'Предыдущая проверка ещё идёт. Дождись её результата.' using errcode = '55000';
  end if;

  select coalesce(sum(runs), 0) into hour_used from private.admin_prompt_previews
  where actor_id = actor and created_at > now() - interval '1 hour';
  if hour_used + run_count > 6 then
    raise exception 'Предел проверок: 6 прогонов в час на администратора. Сравнение считается за два.' using errcode = '53400';
  end if;

  select coalesce(sum(runs), 0) into day_used from private.admin_prompt_previews
  where created_at > now() - interval '24 hours';
  if day_used + run_count > 30 then
    raise exception 'Предел проверок: 30 прогонов в сутки на всех администраторов.' using errcode = '53400';
  end if;

  select * into active_prompt from private.solver_prompts where subject_id = p_subject_id and active;

  -- Проверки старше 90 дней не нужны ни пределу, ни разбору.
  delete from private.admin_prompt_previews where created_at < now() - interval '90 days';

  insert into private.admin_prompt_previews (actor_id, subject_id, grade, prompt_body, condition, compare, runs, current_version)
  values (actor, p_subject_id, grade_name, body, task, run_count = 2, run_count, active_prompt.version)
  returning id into preview_id;

  perform private.audit('prompt_previewed', null, jsonb_build_object(
    'subjectId', p_subject_id,
    'previewId', preview_id,
    'grade', grade_name,
    'runs', run_count,
    'promptChars', char_length(body),
    'conditionChars', char_length(task),
    'activeVersion', active_prompt.version
  ));

  return jsonb_build_object(
    'id', preview_id,
    'runs', run_count,
    'currentPrompt', active_prompt.body,
    'currentVersion', active_prompt.version
  );
end;
$$;

create or replace function public.admin_prompt_preview_finish(
  p_id uuid,
  p_status text,
  p_result jsonb default null,
  p_credits numeric default null,
  p_seconds numeric default null,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin('admin');
  updated integer;
begin
  if p_status is null or p_status not in ('done', 'failed') then
    raise exception 'Неизвестный итог проверки.' using errcode = '22023';
  end if;
  if p_result is not null and pg_column_size(p_result) > 524288 then
    raise exception 'Результат проверки слишком большой.' using errcode = '22023';
  end if;

  -- Закрыть можно только свою и только незакрытую проверку.
  update private.admin_prompt_previews
  set status = p_status,
      result = p_result,
      credits = p_credits,
      seconds = p_seconds,
      error = left(p_error, 500),
      finished_at = now()
  where id = p_id and actor_id = actor and status = 'running';
  get diagnostics updated = row_count;

  return jsonb_build_object('updated', updated > 0);
end;
$$;

-- Последние проверки: по ним вкладка забирает результат, если ответ
-- функции не дошёл (прокси на Supabase живёт 150 секунд, прогон бывает
-- дольше), и показывает прошлые прогоны, за которые уже заплачено.
create or replace function public.admin_prompt_previews(p_subject_id text default null, p_limit integer default 5)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin('admin');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id,
      'subjectId', p.subject_id,
      'grade', p.grade,
      'prompt', p.prompt_body,
      'condition', p.condition,
      'compare', p.compare,
      'runs', p.runs,
      'status', case when p.status = 'running' and p.created_at < now() - interval '6 minutes' then 'lost' else p.status end,
      'currentVersion', p.current_version,
      'result', p.result,
      'credits', p.credits,
      'seconds', p.seconds,
      'error', p.error,
      'actorEmail', u.email,
      'createdAt', p.created_at,
      'finishedAt', p.finished_at
    ) order by p.created_at desc)
    from (
      select * from private.admin_prompt_previews
      where p_subject_id is null or subject_id = p_subject_id
      order by created_at desc
      limit greatest(1, least(coalesce(p_limit, 5), 20))
    ) p
    left join auth.users u on u.id = p.actor_id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_prompt_preview_quota(text) from public, anon;
grant execute on function public.admin_prompt_preview_quota(text) to authenticated;
revoke all on function public.admin_prompt_preview_start(text, text, text, text, boolean) from public, anon;
grant execute on function public.admin_prompt_preview_start(text, text, text, text, boolean) to authenticated;
revoke all on function public.admin_prompt_preview_finish(uuid, text, jsonb, numeric, numeric, text) from public, anon;
grant execute on function public.admin_prompt_preview_finish(uuid, text, jsonb, numeric, numeric, text) to authenticated;
revoke all on function public.admin_prompt_previews(text, integer) from public, anon;
grant execute on function public.admin_prompt_previews(text, integer) to authenticated;
