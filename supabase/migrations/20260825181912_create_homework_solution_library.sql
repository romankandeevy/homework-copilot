create table public.homework_solutions (
  id uuid primary key default gen_random_uuid(),
  textbook_id text not null,
  task text not null,
  source text not null check (source in ('number', 'photo')),
  subject text not null,
  textbook_title text not null,
  solution jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint homework_solutions_task_length check (char_length(task) between 1 and 120),
  constraint homework_solutions_textbook_length check (char_length(textbook_id) between 1 and 150),
  constraint homework_solutions_solution_object check (jsonb_typeof(solution) = 'object')
);

create unique index homework_solutions_number_unique
  on public.homework_solutions (textbook_id, task)
  where source = 'number';

create index homework_solutions_creator_created_idx
  on public.homework_solutions (created_by, created_at desc);

create table public.homework_solution_access (
  user_id uuid not null references auth.users(id) on delete cascade,
  solution_id uuid not null references public.homework_solutions(id) on delete cascade,
  idempotency_key text not null,
  purchased_at timestamptz not null default now(),
  primary key (user_id, solution_id),
  constraint homework_solution_access_idempotency_length
    check (char_length(idempotency_key) between 8 and 160),
  unique (user_id, idempotency_key)
);

create index homework_solution_access_solution_idx
  on public.homework_solution_access (solution_id);

create table public.homework_solution_catalog (
  solution_id uuid primary key references public.homework_solutions(id) on delete cascade,
  textbook_id text not null,
  task text not null,
  subject text not null,
  textbook_title text not null,
  created_at timestamptz not null default now(),
  unique (textbook_id, task)
);

create index homework_solution_catalog_created_idx
  on public.homework_solution_catalog (created_at desc);

alter table public.homework_solutions enable row level security;
alter table public.homework_solution_access enable row level security;
alter table public.homework_solution_catalog enable row level security;

revoke all on public.homework_solutions from anon, authenticated;
revoke all on public.homework_solution_access from anon, authenticated;
revoke all on public.homework_solution_catalog from anon, authenticated;

grant select on public.homework_solutions to authenticated;
grant select on public.homework_solution_access to authenticated;
grant select on public.homework_solution_catalog to anon, authenticated;

create policy "homework_solution_access_select_own"
  on public.homework_solution_access for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "homework_solutions_select_purchased"
  on public.homework_solutions for select
  to authenticated
  using (
    exists (
      select 1
      from public.homework_solution_access as access
      where access.solution_id = homework_solutions.id
        and access.user_id = (select auth.uid())
    )
  );

create policy "homework_solution_catalog_select_public"
  on public.homework_solution_catalog for select
  to anon, authenticated
  using (true);

create function public.complete_homework_solution(
  p_textbook_id text,
  p_task text,
  p_source text,
  p_idempotency_key text,
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
    or p_source not in ('number', 'photo')
    or (p_source = 'number' and p_task !~ '^[0-9]{1,4}$') then
    raise exception 'invalid homework solution request' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_source || ':' || p_textbook_id || ':' || p_task
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
    where textbook_id = p_textbook_id and task = p_task and source = 'number';
  else
    select * into stored_solution
    from public.homework_solutions
    where textbook_id = p_textbook_id and task = p_task and source = 'photo'
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
      textbook_id, task, source, subject, textbook_title, solution, created_by
    )
    values (
      p_textbook_id,
      p_task,
      p_source,
      left(coalesce(p_solution ->> 'subject', ''), 150),
      left(coalesce(p_solution ->> 'textbookTitle', ''), 300),
      p_solution - 'ownerId',
      current_user_id
    )
    returning * into stored_solution;

    if p_source = 'number' then
      insert into public.homework_solution_catalog (
        solution_id, textbook_id, task, subject, textbook_title, created_at
      )
      values (
        stored_solution.id,
        stored_solution.textbook_id,
        stored_solution.task,
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

revoke all on function public.complete_homework_solution(text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.complete_homework_solution(text, text, text, text, jsonb)
  to authenticated;

with approved_fixture as (
  insert into public.homework_solutions (
    textbook_id, task, source, subject, textbook_title, solution
  )
  values (
    'geometry',
    '123',
    'number',
    'Геометрия',
    'Геометрия. 7-9 классы',
    jsonb_build_object(
      'textbookId', 'geometry',
      'task', '123',
      'source', 'number',
      'subject', 'Геометрия',
      'textbookTitle', 'Геометрия. 7-9 классы',
      'condition', 'В равнобедренном треугольнике ABC AB = BC, ∠B = 40°. Найдите углы при основании.',
      'given', jsonb_build_array('△ABC', 'AB = BC', '∠B = 40°'),
      'goal', jsonb_build_object('title', 'Найти', 'text', '∠A и ∠C.'),
      'steps', jsonb_build_array(
        'Т.к AB = BC, то △ABC р/б => ∠A = ∠C.',
        '∠A + ∠B + ∠C = 180°.',
        '2∠A + 40° = 180°.',
        '∠A = (180° − 40°):2',
        '∠A = ∠C = 70°.'
      ),
      'answer', '∠A = 70°, ∠C = 70°.',
      'diagram', jsonb_build_object(
        'kind', 'isosceles-triangle',
        'description', 'Равнобедренный треугольник ABC с равными сторонами AB и BC и углом B, равным 40 градусам.',
        'vertices', jsonb_build_array('A', 'B', 'C'),
        'apexAngle', '40°',
        'equalSides', jsonb_build_array('AB', 'BC')
      ),
      'sourceVerified', true,
      'createdAt', now()
    )
  )
  returning id, textbook_id, task, subject, textbook_title, created_at
)
insert into public.homework_solution_catalog (
  solution_id, textbook_id, task, subject, textbook_title, created_at
)
select id, textbook_id, task, subject, textbook_title, created_at
from approved_fixture;

