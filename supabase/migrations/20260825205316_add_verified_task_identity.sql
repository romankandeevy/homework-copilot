alter table public.homework_solutions
  add column if not exists textbook_edition text not null default '',
  add column if not exists source_url text not null default '',
  add column if not exists source_page integer,
  add column if not exists condition_normalized text not null default '';

alter table public.homework_solution_catalog
  add column if not exists textbook_edition text not null default '',
  add column if not exists source_url text not null default '',
  add column if not exists source_page integer,
  add column if not exists condition_normalized text not null default '';

drop index if exists public.homework_solutions_number_unique;
alter table public.homework_solution_catalog
  drop constraint if exists homework_solution_catalog_textbook_id_task_key;

create unique index if not exists homework_solutions_verified_number_unique
  on public.homework_solutions (
    textbook_id,
    textbook_edition,
    source_url,
    task,
    condition_normalized
  )
  where source = 'number';

create unique index if not exists homework_solution_catalog_verified_number_unique
  on public.homework_solution_catalog (
    textbook_id,
    textbook_edition,
    source_url,
    task,
    condition_normalized
  );

delete from public.homework_solutions
where textbook_id = 'geometry'
  and task = '123'
  and source = 'number'
  and source_url = '';

delete from public.homework_solutions
where textbook_id = 'geometry'
  and task = '126'
  and source = 'number'
  and source_url = '';

update public.homework_solutions
set
  textbook_edition = '14-е издание, Просвещение, 2023',
  source_url = '/textbooks/geometry-7-9-atanasyan.pdf',
  source_page = 8,
  condition_normalized = 'отметьте три точки а, в и с, не лежащие на одной прямой, и через каждую пару точек проведите прямую. сколько прямых получилось?',
  subject = 'Геометрия',
  textbook_title = 'Геометрия. 7-9 классы',
  solution = jsonb_build_object(
    'textbookId', 'geometry',
    'task', '2',
    'source', 'number',
    'textbookEdition', '14-е издание, Просвещение, 2023',
    'sourceUrl', '/textbooks/geometry-7-9-atanasyan.pdf',
    'sourcePage', 8,
    'conditionNormalized', 'отметьте три точки а, в и с, не лежащие на одной прямой, и через каждую пару точек проведите прямую. сколько прямых получилось?',
    'subject', 'Геометрия',
    'textbookTitle', 'Геометрия. 7-9 классы',
    'condition', 'Отметьте три точки А, В и С, не лежащие на одной прямой, и через каждую пару точек проведите прямую. Сколько прямых получилось?',
    'given', jsonb_build_array('A, B, C — точки.', 'Не лежат на', 'одной прямой.'),
    'goal', jsonb_build_object('title', 'Найти', 'text', 'число прямых.'),
    'steps', jsonb_build_array(
      'Проведём AB, BC и CA.',
      'Всего 3 прямые.'
    ),
    'answer', '3 прямые.',
    'diagram', jsonb_build_object(
      'kind', 'three-point-lines',
      'description', 'Три точки A, B и C, не лежащие на одной прямой, соединены прямыми AB, BC и CA.',
      'vertices', jsonb_build_array('A', 'B', 'C')
    ),
    'sourceVerified', true,
    'createdAt', now()
  )
where textbook_id = 'geometry'
  and task = '2'
  and source = 'number';

update public.homework_solution_catalog as catalog
set
  textbook_edition = solution.textbook_edition,
  source_url = solution.source_url,
  source_page = solution.source_page,
  condition_normalized = solution.condition_normalized,
  subject = solution.subject,
  textbook_title = solution.textbook_title
from public.homework_solutions as solution
where catalog.solution_id = solution.id
  and solution.textbook_id = 'geometry'
  and solution.task = '2'
  and solution.source = 'number';

alter table public.homework_solutions
  add constraint homework_solutions_identity_fields_length check (
    char_length(textbook_edition) between 1 and 200
    and char_length(source_url) between 1 and 500
    and char_length(condition_normalized) between 1 and 5000
  );

alter table public.homework_solution_catalog
  add constraint homework_solution_catalog_identity_fields_length check (
    char_length(textbook_edition) between 1 and 200
    and char_length(source_url) between 1 and 500
    and char_length(condition_normalized) between 1 and 5000
  );

drop function if exists public.complete_homework_solution(text, text, text, text, jsonb);

create function public.complete_homework_solution(
  p_textbook_id text,
  p_task text,
  p_source text,
  p_idempotency_key text,
  p_edition text,
  p_source_url text,
  p_source_page integer,
  p_condition text,
  p_condition_normalized text,
  p_solution jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  stored_solution public.homework_solutions%rowtype;
  previous_solution_id uuid;
  solution_price integer;
  description text;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if char_length(coalesce(p_textbook_id, '')) not between 1 and 150
    or char_length(coalesce(p_task, '')) not between 1 and 120
    or char_length(coalesce(p_idempotency_key, '')) not between 8 and 160
    or char_length(coalesce(p_edition, '')) not between 1 and 200
    or char_length(coalesce(p_source_url, '')) not between 1 and 500
    or p_source not in ('number', 'photo')
    or (p_source = 'number' and (
      p_task !~ '^[0-9]{1,4}$'
      or char_length(coalesce(p_condition, '')) = 0
      or char_length(coalesce(p_condition_normalized, '')) = 0
    )) then
    raise exception 'invalid homework solution request' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_source || ':' || p_textbook_id || ':' || p_edition || ':' || p_source_url || ':' || p_task || ':' || p_condition_normalized
      || case when p_source = 'photo' then ':' || current_user_id::text else '' end,
      0
    )
  );

  select access.solution_id into previous_solution_id
  from public.homework_solution_access as access
  where access.user_id = current_user_id
    and access.idempotency_key = p_idempotency_key;

  if p_source = 'number' then
    select * into stored_solution
    from public.homework_solutions
    where textbook_id = p_textbook_id
      and textbook_edition = p_edition
      and source_url = p_source_url
      and task = p_task
      and condition_normalized = p_condition_normalized
      and source = 'number';
  else
    select * into stored_solution
    from public.homework_solutions
    where textbook_id = p_textbook_id
      and textbook_edition = p_edition
      and source_url = p_source_url
      and task = p_task
      and source = 'photo'
      and created_by = current_user_id;
  end if;

  if previous_solution_id is not null
    and (stored_solution.id is null or previous_solution_id <> stored_solution.id) then
    raise exception 'idempotency key already used' using errcode = '22023';
  end if;

  if stored_solution.id is not null and exists (
    select 1
    from public.homework_solution_access as access
    where access.user_id = current_user_id and access.solution_id = stored_solution.id
  ) then
    return jsonb_set(stored_solution.solution, '{ownerId}', to_jsonb(current_user_id::text));
  end if;

  if stored_solution.id is null and p_solution is null then
    return null;
  end if;

  if exists (
    select 1 from public.wallet_entries
    where user_id = current_user_id and idempotency_key = p_idempotency_key
  ) then
    raise exception 'idempotency key already used' using errcode = '22023';
  end if;

  if stored_solution.id is null then
    if jsonb_typeof(p_solution) <> 'object'
      or p_solution ->> 'textbookId' <> p_textbook_id
      or p_solution ->> 'task' <> p_task
      or p_solution ->> 'source' <> p_source
      or p_solution ->> 'textbookEdition' <> p_edition
      or p_solution ->> 'sourceUrl' <> p_source_url
      or p_solution ->> 'conditionNormalized' <> p_condition_normalized
      or p_solution ->> 'sourceVerified' <> 'true'
      or char_length(coalesce(p_solution ->> 'condition', '')) = 0
      or jsonb_typeof(p_solution -> 'steps') <> 'array'
      or jsonb_array_length(p_solution -> 'steps') = 0 then
      raise exception 'invalid verified homework solution' using errcode = '22023';
    end if;
  end if;

  solution_price := case
    when p_source = 'photo' then 15
    else private.solution_task_price(p_textbook_id, p_task::integer)
  end;
  description := case
    when p_source = 'photo' then 'Решение задачи по фото · ' || solution_price || ' ₽'
    else 'Решение задачи № ' || p_task || ' · ' || solution_price || ' ₽'
  end;

  perform public.spend_solution_credit(
    p_idempotency_key,
    description,
    case when p_source = 'number' then p_task::integer else null end,
    p_textbook_id,
    p_source
  );

  if stored_solution.id is null then
    insert into public.homework_solutions (
      textbook_id, task, source, textbook_edition, source_url, source_page,
      condition_normalized, subject, textbook_title, solution, created_by
    )
    values (
      p_textbook_id,
      p_task,
      p_source,
      p_edition,
      p_source_url,
      p_source_page,
      p_condition_normalized,
      left(coalesce(p_solution ->> 'subject', ''), 150),
      left(coalesce(p_solution ->> 'textbookTitle', ''), 300),
      p_solution - 'ownerId',
      current_user_id
    )
    returning * into stored_solution;

    if p_source = 'number' then
      insert into public.homework_solution_catalog (
        solution_id, textbook_id, task, textbook_edition, source_url, source_page,
        condition_normalized, subject, textbook_title, created_at
      )
      values (
        stored_solution.id,
        stored_solution.textbook_id,
        stored_solution.task,
        stored_solution.textbook_edition,
        stored_solution.source_url,
        stored_solution.source_page,
        stored_solution.condition_normalized,
        stored_solution.subject,
        stored_solution.textbook_title,
        stored_solution.created_at
      );
    end if;
  end if;

  insert into public.homework_solution_access (user_id, solution_id, idempotency_key)
  values (current_user_id, stored_solution.id, p_idempotency_key);

  return jsonb_set(stored_solution.solution, '{ownerId}', to_jsonb(current_user_id::text));
end;
$$;

revoke all on function public.complete_homework_solution(text, text, text, text, text, text, integer, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.complete_homework_solution(text, text, text, text, text, text, integer, text, text, jsonb)
  to authenticated;
