create or replace function private.homework_solution_payload_is_current(p_solution jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_solution) = 'object'
    and case
      when coalesce(p_solution ->> 'engineVersion', '') ~ '^[0-9]+$'
        then (p_solution ->> 'engineVersion')::integer >= 2
      else false
    end
    and p_solution #>> '{quality,reviewPassed}' = 'true';
$$;

create or replace function private.homework_solution_payload_is_valid(
  p_solution jsonb,
  p_textbook_id text,
  p_task text,
  p_source text,
  p_edition text,
  p_source_url text,
  p_source_page integer,
  p_condition_normalized text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select private.homework_solution_payload_is_current(p_solution)
    and p_solution ->> 'textbookId' = p_textbook_id
    and p_solution ->> 'task' = p_task
    and p_solution ->> 'source' = p_source
    and p_solution ->> 'textbookEdition' = p_edition
    and p_solution ->> 'sourceUrl' = p_source_url
    and (p_source_page is null or p_solution ->> 'sourcePage' = p_source_page::text)
    and p_solution ->> 'conditionNormalized' = p_condition_normalized
    and p_solution ->> 'sourceVerified' = 'true'
    and p_solution ->> 'taskType' in ('construction', 'calculation', 'proof', 'mixed')
    and char_length(coalesce(p_solution ->> 'condition', '')) >= 8
    and jsonb_typeof(p_solution -> 'goal') = 'object'
    and jsonb_typeof(p_solution -> 'diagram') = 'object'
    and jsonb_typeof(p_solution -> 'steps') = 'array'
    and jsonb_array_length(p_solution -> 'steps') between 1 and 14;
$$;

revoke all on function private.homework_solution_payload_is_current(jsonb) from public, anon, authenticated;
revoke all on function private.homework_solution_payload_is_valid(jsonb, text, text, text, text, text, integer, text) from public, anon, authenticated;

create or replace function public.complete_homework_solution(
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
  canonical_task public.verified_homework_tasks%rowtype;
  personal_solution private.user_generated_homework_solutions%rowtype;
  stored_solution public.homework_solutions%rowtype;
  previous_solution_id uuid;
  solution_price integer;
  description text;
  has_access boolean := false;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  perform private.assert_account_not_banned(current_user_id);

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

  if p_source = 'number' then
    select * into canonical_task
    from public.verified_homework_tasks
    where textbook_id = p_textbook_id
      and textbook_edition = p_edition
      and source_url = p_source_url
      and task = p_task
      and condition_normalized = p_condition_normalized
      and source_page is not distinct from p_source_page;

    if not found or canonical_task.condition <> p_condition then
      raise exception 'numbered homework task is not verified' using errcode = '22023';
    end if;
  end if;

  if p_source = 'number' and canonical_task.solution_payload is null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        current_user_id::text || ':' || p_textbook_id || ':' || p_edition || ':' || p_source_url || ':' || p_task || ':' || p_condition_normalized,
        0
      )
    );

    select * into personal_solution
    from private.user_generated_homework_solutions
    where user_id = current_user_id
      and textbook_id = p_textbook_id
      and textbook_edition = p_edition
      and source_url = p_source_url
      and task = p_task
      and condition_normalized = p_condition_normalized;

    if found then
      if private.homework_solution_payload_is_current(personal_solution.solution) or p_solution is null then
        return jsonb_set(personal_solution.solution, '{ownerId}', to_jsonb(current_user_id::text));
      end if;

      if not private.homework_solution_payload_is_valid(
        p_solution, p_textbook_id, p_task, p_source, p_edition,
        p_source_url, p_source_page, p_condition_normalized
      ) then
        raise exception 'invalid private homework solution' using errcode = '22023';
      end if;

      update private.user_generated_homework_solutions
      set solution = p_solution - 'ownerId'
      where user_id = current_user_id
        and textbook_id = p_textbook_id
        and textbook_edition = p_edition
        and source_url = p_source_url
        and task = p_task
        and condition_normalized = p_condition_normalized
      returning * into personal_solution;

      return jsonb_set(personal_solution.solution, '{ownerId}', to_jsonb(current_user_id::text));
    end if;

    if p_solution is null then return null; end if;

    if not private.homework_solution_payload_is_valid(
      p_solution, p_textbook_id, p_task, p_source, p_edition,
      p_source_url, p_source_page, p_condition_normalized
    ) then
      raise exception 'invalid private homework solution' using errcode = '22023';
    end if;

    if exists (
      select 1 from public.wallet_entries
      where user_id = current_user_id and idempotency_key = p_idempotency_key
    ) then
      raise exception 'idempotency key already used' using errcode = '22023';
    end if;

    solution_price := private.solution_task_price(p_textbook_id, p_task::integer);
    description := 'Решение задачи № ' || p_task || ' · ' || solution_price || ' ₽';

    perform public.spend_solution_credit(
      p_idempotency_key, description, p_task::integer, p_textbook_id, 'number'
    );

    insert into private.user_generated_homework_solutions (
      user_id, textbook_id, textbook_edition, source_url, source_page,
      task, condition_normalized, solution, idempotency_key
    )
    values (
      current_user_id, p_textbook_id, p_edition, p_source_url, p_source_page,
      p_task, p_condition_normalized, p_solution - 'ownerId', p_idempotency_key
    )
    returning * into personal_solution;

    return jsonb_set(personal_solution.solution, '{ownerId}', to_jsonb(current_user_id::text));
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

  if stored_solution.id is not null then
    select exists (
      select 1 from public.homework_solution_access as access
      where access.user_id = current_user_id and access.solution_id = stored_solution.id
    ) into has_access;
  end if;

  if has_access then
    if private.homework_solution_payload_is_current(stored_solution.solution) or p_solution is null then
      return jsonb_set(stored_solution.solution, '{ownerId}', to_jsonb(current_user_id::text));
    end if;

    if not private.homework_solution_payload_is_valid(
      p_solution, p_textbook_id, p_task, p_source, p_edition,
      p_source_url, p_source_page, p_condition_normalized
    ) then
      raise exception 'invalid verified homework solution' using errcode = '22023';
    end if;

    update public.homework_solutions
    set solution = p_solution - 'ownerId',
        subject = left(coalesce(p_solution ->> 'subject', ''), 150),
        textbook_title = left(coalesce(p_solution ->> 'textbookTitle', ''), 300)
    where id = stored_solution.id
    returning * into stored_solution;

    return jsonb_set(stored_solution.solution, '{ownerId}', to_jsonb(current_user_id::text));
  end if;

  if stored_solution.id is null and p_solution is null then return null; end if;
  if stored_solution.id is not null
    and not private.homework_solution_payload_is_current(stored_solution.solution)
    and p_solution is null then
    return null;
  end if;

  if exists (
    select 1 from public.wallet_entries
    where user_id = current_user_id and idempotency_key = p_idempotency_key
  ) then
    raise exception 'idempotency key already used' using errcode = '22023';
  end if;

  if (stored_solution.id is null or not private.homework_solution_payload_is_current(stored_solution.solution))
    and not private.homework_solution_payload_is_valid(
      p_solution, p_textbook_id, p_task, p_source, p_edition,
      p_source_url, p_source_page, p_condition_normalized
    ) then
    raise exception 'invalid verified homework solution' using errcode = '22023';
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
      p_textbook_id, p_task, p_source, p_edition, p_source_url, p_source_page,
      p_condition_normalized,
      left(coalesce(p_solution ->> 'subject', ''), 150),
      left(coalesce(p_solution ->> 'textbookTitle', ''), 300),
      p_solution - 'ownerId', current_user_id
    )
    returning * into stored_solution;

    if p_source = 'number' then
      insert into public.homework_solution_catalog (
        solution_id, textbook_id, task, textbook_edition, source_url, source_page,
        condition_normalized, subject, textbook_title, created_at
      )
      values (
        stored_solution.id, stored_solution.textbook_id, stored_solution.task,
        stored_solution.textbook_edition, stored_solution.source_url,
        stored_solution.source_page, stored_solution.condition_normalized,
        stored_solution.subject, stored_solution.textbook_title, stored_solution.created_at
      );
    end if;
  elsif not private.homework_solution_payload_is_current(stored_solution.solution) then
    update public.homework_solutions
    set solution = p_solution - 'ownerId',
        subject = left(coalesce(p_solution ->> 'subject', ''), 150),
        textbook_title = left(coalesce(p_solution ->> 'textbookTitle', ''), 300)
    where id = stored_solution.id
    returning * into stored_solution;
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

with corrected(task, condition) as (
  values
    ('1', 'Проведите прямую, обозначьте её буквой a и отметьте точки A и B, лежащие на этой прямой, и точки P, Q и R, не лежащие на ней. Опишите взаимное расположение точек A, B, P, Q, R и прямой a, используя символы ∈ и ∉.'),
    ('2', 'Отметьте три точки A, B и C, не лежащие на одной прямой, и через каждую пару точек проведите прямую. Сколько прямых получилось?'),
    ('3', 'Проведите три прямые так, чтобы каждые две из них пересекались. Обозначьте все точки пересечения этих прямых. Сколько получилось точек? Рассмотрите все возможные случаи.'),
    ('4', 'Отметьте точки A, B, C, D так, чтобы точки A, B, C лежали на одной прямой, а точка D не лежала на ней. Через каждые две точки проведите прямую. Сколько получилось прямых?'),
    ('5', 'Проведите прямую a и отметьте на ней точки A и B. Отметьте: а) точки M и N, лежащие на отрезке AB; б) точки P и Q, лежащие на прямой a, но не лежащие на отрезке AB; в) точки R и S, не лежащие на прямой a.'),
    ('6', 'Проведите прямую и отметьте на ней три точки. Сколько отрезков получилось на прямой?'),
    ('7', 'На рисунке 14 изображена прямая, на ней отмечены точки A, B, C и D. Назовите все отрезки: а) на которых лежит точка C; б) на которых не лежит точка B.'),
    ('8', 'Начертите ломаную из трёх звеньев, которая: а) является замкнутой; б) не является замкнутой.'),
    ('9', 'Цифры почтового индекса записываются по определённым правилам (рис. 15) для удобства распознавания сортировочным автоматом. Укажите на рисунке цифры, в записи которых используются ломаные. Сколько звеньев в каждой ломаной? Укажите замкнутую ломаную. Как называется многоугольник, образованный на рисунке замкнутой ломаной?'),
    ('10', 'Начертите пятиугольник, как на рисунке 9. Разбейте его на треугольники так, чтобы у пятиугольника и каждого треугольника были общие стороны. Сколько треугольников может получиться на чертеже? Какие ещё многоугольники получились на чертеже?')
)
update public.verified_homework_tasks as task
set condition = corrected.condition,
    condition_normalized = lower(
      regexp_replace(
        regexp_replace(
          replace(corrected.condition, 'ё', 'е'),
          '\s*([,.;:!?])\s*', '\1', 'g'
        ),
        '\s+', ' ', 'g'
      )
    )
from corrected
where task.textbook_id = 'geometry'
  and task.textbook_edition = '14-е издание, Просвещение, 2023'
  and task.source_url = '/textbooks/geometry-7-9-atanasyan.pdf'
  and task.task = corrected.task;

update public.verified_homework_tasks
set solution_payload = jsonb_build_object(
  'engineVersion', 2,
  'textbookId', 'geometry',
  'task', '2',
  'source', 'number',
  'textbookEdition', '14-е издание, Просвещение, 2023',
  'sourceUrl', '/textbooks/geometry-7-9-atanasyan.pdf',
  'sourcePage', 9,
  'conditionNormalized', condition_normalized,
  'subject', 'Геометрия',
  'textbookTitle', 'Геометрия. 7-9 классы',
  'condition', condition,
  'given', jsonb_build_array('A, B, C — неколлинеарны'),
  'goal', jsonb_build_object('title', 'Найти', 'text', 'n(прямых)'),
  'steps', jsonb_build_array('AB, BC, CA; n = C₃² = 3.'),
  'answer', '3 прямые',
  'diagram', jsonb_build_object(
    'kind', 'three-point-extended-lines',
    'description', 'Три точки A, B и C, не лежащие на одной прямой, соединены прямыми AB, BC и CA.',
    'vertices', jsonb_build_array('A', 'B', 'C')
  ),
  'sourceVerified', true,
  'taskType', 'mixed',
  'quality', jsonb_build_object(
    'diagramRequired', true,
    'reviewPassed', true,
    'symbolicShare', 1
  )
)
where textbook_id = 'geometry'
  and textbook_edition = '14-е издание, Просвещение, 2023'
  and source_url = '/textbooks/geometry-7-9-atanasyan.pdf'
  and task = '2';

update private.user_generated_homework_solutions as personal
set condition_normalized = canonical.condition_normalized,
    solution = jsonb_set(
      personal.solution,
      '{conditionNormalized}',
      to_jsonb(canonical.condition_normalized)
    )
from public.verified_homework_tasks as canonical
where canonical.textbook_id = 'geometry'
  and canonical.textbook_edition = '14-е издание, Просвещение, 2023'
  and canonical.source_url = '/textbooks/geometry-7-9-atanasyan.pdf'
  and canonical.task in ('1', '2', '3', '4', '5', '6', '7', '8', '9', '10')
  and personal.textbook_id = canonical.textbook_id
  and personal.textbook_edition = canonical.textbook_edition
  and personal.source_url = canonical.source_url
  and personal.task = canonical.task;

update public.homework_solutions as solution
set condition_normalized = canonical.condition_normalized,
    subject = left(coalesce(canonical.solution_payload ->> 'subject', ''), 150),
    textbook_title = left(coalesce(canonical.solution_payload ->> 'textbookTitle', ''), 300),
    solution = canonical.solution_payload || case
      when solution.solution ? 'createdAt'
        then jsonb_build_object('createdAt', solution.solution -> 'createdAt')
      else '{}'::jsonb
    end
from public.verified_homework_tasks as canonical
where canonical.textbook_id = 'geometry'
  and canonical.textbook_edition = '14-е издание, Просвещение, 2023'
  and canonical.source_url = '/textbooks/geometry-7-9-atanasyan.pdf'
  and canonical.task in ('1', '2', '3', '4', '5', '6', '7', '8', '9', '10')
  and solution.textbook_id = canonical.textbook_id
  and solution.textbook_edition = canonical.textbook_edition
  and solution.source_url = canonical.source_url
  and solution.task = canonical.task
  and solution.source = 'number'
  and canonical.solution_payload is not null;

update public.homework_solution_catalog as catalog
set condition_normalized = solution.condition_normalized
from public.homework_solutions as solution
where catalog.solution_id = solution.id
  and solution.textbook_id = 'geometry'
  and solution.textbook_edition = '14-е издание, Просвещение, 2023'
  and solution.source_url = '/textbooks/geometry-7-9-atanasyan.pdf'
  and solution.task in ('1', '2', '3', '4', '5', '6', '7', '8', '9', '10')
  and solution.source = 'number';
