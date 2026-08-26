create table if not exists private.user_generated_homework_solutions (
  user_id uuid not null references auth.users(id) on delete cascade,
  textbook_id text not null,
  textbook_edition text not null,
  source_url text not null,
  source_page integer not null,
  task text not null,
  condition_normalized text not null,
  solution jsonb not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, textbook_id, textbook_edition, source_url, task, condition_normalized),
  unique (user_id, idempotency_key),
  constraint user_generated_homework_solution_object check (jsonb_typeof(solution) = 'object'),
  constraint user_generated_homework_task_number check (task ~ '^[0-9]{1,4}$')
);

revoke all on table private.user_generated_homework_solutions from public, anon, authenticated;

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
      return jsonb_set(personal_solution.solution, '{ownerId}', to_jsonb(current_user_id::text));
    end if;

    if p_solution is null then
      return null;
    end if;

    if jsonb_typeof(p_solution) <> 'object'
      or p_solution ->> 'textbookId' <> p_textbook_id
      or p_solution ->> 'task' <> p_task
      or p_solution ->> 'source' <> 'number'
      or p_solution ->> 'textbookEdition' <> p_edition
      or p_solution ->> 'sourceUrl' <> p_source_url
      or p_solution ->> 'sourcePage' <> p_source_page::text
      or p_solution ->> 'conditionNormalized' <> p_condition_normalized
      or p_solution ->> 'condition' <> canonical_task.condition
      or p_solution ->> 'sourceVerified' <> 'true'
      or jsonb_typeof(p_solution -> 'steps') <> 'array'
      or jsonb_array_length(p_solution -> 'steps') = 0 then
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
      p_idempotency_key,
      description,
      p_task::integer,
      p_textbook_id,
      'number'
    );

    insert into private.user_generated_homework_solutions (
      user_id,
      textbook_id,
      textbook_edition,
      source_url,
      source_page,
      task,
      condition_normalized,
      solution,
      idempotency_key
    )
    values (
      current_user_id,
      p_textbook_id,
      p_edition,
      p_source_url,
      p_source_page,
      p_task,
      p_condition_normalized,
      p_solution - 'ownerId',
      p_idempotency_key
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
