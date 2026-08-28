create or replace function private.publish_reviewed_number_solution()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  canonical_task public.verified_homework_tasks%rowtype;
  stored_solution public.homework_solutions%rowtype;
begin
  if not private.homework_solution_payload_is_current(new.solution) then
    return new;
  end if;

  select * into canonical_task
  from public.verified_homework_tasks
  where textbook_id = new.textbook_id
    and textbook_edition = new.textbook_edition
    and source_url = new.source_url
    and source_page is not distinct from new.source_page
    and task = new.task
    and condition_normalized = new.condition_normalized;

  if not found
    or new.solution ->> 'condition' <> canonical_task.condition
    or not private.homework_solution_payload_is_valid(
      new.solution,
      new.textbook_id,
      new.task,
      'number',
      new.textbook_edition,
      new.source_url,
      new.source_page,
      new.condition_normalized
    ) then
    raise exception 'current reviewed numbered solution cannot be published'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'publish:' || new.textbook_id || ':' || new.textbook_edition || ':'
      || new.source_url || ':' || new.task || ':' || new.condition_normalized,
      0
    )
  );

  update public.verified_homework_tasks
  set solution_payload = case
    when solution_payload is null
      or not private.homework_solution_payload_is_current(solution_payload)
      then new.solution - 'ownerId' - 'createdAt' - '_serverProof'
    else solution_payload
  end
  where textbook_id = new.textbook_id
    and textbook_edition = new.textbook_edition
    and source_url = new.source_url
    and source_page is not distinct from new.source_page
    and task = new.task
    and condition_normalized = new.condition_normalized
  returning * into canonical_task;

  insert into public.homework_solutions as existing (
    textbook_id,
    task,
    source,
    textbook_edition,
    source_url,
    source_page,
    condition_normalized,
    subject,
    textbook_title,
    solution,
    created_by,
    created_at
  )
  values (
    canonical_task.textbook_id,
    canonical_task.task,
    'number',
    canonical_task.textbook_edition,
    canonical_task.source_url,
    canonical_task.source_page,
    canonical_task.condition_normalized,
    left(coalesce(canonical_task.solution_payload ->> 'subject', ''), 150),
    left(coalesce(canonical_task.solution_payload ->> 'textbookTitle', ''), 300),
    canonical_task.solution_payload || jsonb_build_object(
      'createdAt', coalesce(new.solution -> 'createdAt', to_jsonb(new.created_at))
    ),
    new.user_id,
    new.created_at
  )
  on conflict (
    textbook_id,
    textbook_edition,
    source_url,
    task,
    condition_normalized
  ) where source = 'number'
  do update set
    solution = case
      when not private.homework_solution_payload_is_current(existing.solution)
        then excluded.solution
      else existing.solution
    end,
    subject = case
      when not private.homework_solution_payload_is_current(existing.solution)
        then excluded.subject
      else existing.subject
    end,
    textbook_title = case
      when not private.homework_solution_payload_is_current(existing.solution)
        then excluded.textbook_title
      else existing.textbook_title
    end
  returning * into stored_solution;

  insert into public.homework_solution_catalog (
    solution_id,
    textbook_id,
    task,
    textbook_edition,
    source_url,
    source_page,
    condition_normalized,
    subject,
    textbook_title,
    created_at
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
  )
  on conflict (
    textbook_id,
    textbook_edition,
    source_url,
    task,
    condition_normalized
  )
  do update set
    solution_id = excluded.solution_id,
    source_page = excluded.source_page,
    subject = excluded.subject,
    textbook_title = excluded.textbook_title;

  insert into public.homework_solution_access (
    user_id,
    solution_id,
    idempotency_key,
    purchased_at
  )
  values (
    new.user_id,
    stored_solution.id,
    new.idempotency_key,
    new.created_at
  )
  on conflict do nothing;

  return new;
end;
$$;

revoke all on function private.publish_reviewed_number_solution()
  from public, anon, authenticated;

drop trigger if exists publish_reviewed_number_solution
  on private.user_generated_homework_solutions;

create trigger publish_reviewed_number_solution
after insert or update of solution
on private.user_generated_homework_solutions
for each row
execute function private.publish_reviewed_number_solution();

update private.user_generated_homework_solutions as generated
set solution = generated.solution
from public.verified_homework_tasks as canonical
where canonical.textbook_id = generated.textbook_id
  and canonical.textbook_edition = generated.textbook_edition
  and canonical.source_url = generated.source_url
  and canonical.source_page is not distinct from generated.source_page
  and canonical.task = generated.task
  and canonical.condition_normalized = generated.condition_normalized
  and generated.solution ->> 'condition' = canonical.condition
  and private.homework_solution_payload_is_valid(
    generated.solution,
    generated.textbook_id,
    generated.task,
    'number',
    generated.textbook_edition,
    generated.source_url,
    generated.source_page,
    generated.condition_normalized
  );

update public.verified_homework_tasks
set solution_payload = jsonb_build_object(
  'engineVersion', 2,
  'textbookId', textbook_id,
  'task', task,
  'source', 'number',
  'textbookEdition', textbook_edition,
  'sourceUrl', source_url,
  'sourcePage', source_page,
  'conditionNormalized', condition_normalized,
  'subject', 'Геометрия',
  'textbookTitle', 'Геометрия. 7-9 классы',
  'condition', condition,
  'given', jsonb_build_array('Рис. 15: цифры 0-9 записаны отрезками'),
  'goal', jsonb_build_object('title', 'Найти', 'text', 'ломаные и число их звеньев'),
  'steps', jsonb_build_array(
    '1 - 2; 2 - 3; 3 - 5; 5 - 5 звеньев.',
    '6 - 5; 7 - 3; 9 - 5; 0 - 4 звена.',
    '0 - замкнутая ломаная ⇒ прямоугольник.'
  ),
  'answer', '1, 2, 3, 5, 6, 7, 9, 0; цифра 0 образует прямоугольник',
  'diagram', jsonb_build_object(
    'kind', 'construction',
    'description', 'Цифры почтового индекса на рисунке 15; замкнутая ломаная цифры 0 образует прямоугольник.',
    'vertices', jsonb_build_array('A', 'B', 'C', 'D'),
    'scene', jsonb_build_object(
      'points', jsonb_build_array(
        jsonb_build_object('id', 'A', 'label', '', 'x', 24, 'y', 20, 'visible', false),
        jsonb_build_object('id', 'B', 'label', '', 'x', 76, 'y', 20, 'visible', false),
        jsonb_build_object('id', 'C', 'label', '', 'x', 76, 'y', 80, 'visible', false),
        jsonb_build_object('id', 'D', 'label', '', 'x', 24, 'y', 80, 'visible', false)
      ),
      'objects', jsonb_build_array(
        jsonb_build_object(
          'kind', 'polygon',
          'points', jsonb_build_array('A', 'B', 'C', 'D'),
          'label', '0',
          'auxiliary', false
        )
      ),
      'marks', '[]'::jsonb,
      'constraints', '[]'::jsonb
    )
  ),
  'sourceVerified', true,
  'taskType', 'mixed',
  'quality', jsonb_build_object(
    'diagramRequired', true,
    'reviewPassed', true,
    'symbolicShare', 0.7
  )
)
where textbook_id = 'geometry'
  and textbook_edition = '14-е издание, Просвещение, 2023'
  and source_url = '/textbooks/geometry-7-9-atanasyan.pdf'
  and task = '9'
  and (
    solution_payload is null
    or not private.homework_solution_payload_is_current(solution_payload)
  );

insert into public.homework_solutions (
  textbook_id,
  task,
  source,
  textbook_edition,
  source_url,
  source_page,
  condition_normalized,
  subject,
  textbook_title,
  solution,
  created_by
)
select
  textbook_id,
  task,
  'number',
  textbook_edition,
  source_url,
  source_page,
  condition_normalized,
  left(coalesce(solution_payload ->> 'subject', ''), 150),
  left(coalesce(solution_payload ->> 'textbookTitle', ''), 300),
  solution_payload || jsonb_build_object('createdAt', now()),
  null
from public.verified_homework_tasks
where textbook_id = 'geometry'
  and textbook_edition = '14-е издание, Просвещение, 2023'
  and source_url = '/textbooks/geometry-7-9-atanasyan.pdf'
  and task = '9'
on conflict (
  textbook_id,
  textbook_edition,
  source_url,
  task,
  condition_normalized
) where source = 'number'
do update set
  solution = excluded.solution,
  subject = excluded.subject,
  textbook_title = excluded.textbook_title;

insert into public.homework_solution_catalog (
  solution_id,
  textbook_id,
  task,
  textbook_edition,
  source_url,
  source_page,
  condition_normalized,
  subject,
  textbook_title,
  created_at
)
select
  solution.id,
  solution.textbook_id,
  solution.task,
  solution.textbook_edition,
  solution.source_url,
  solution.source_page,
  solution.condition_normalized,
  solution.subject,
  solution.textbook_title,
  solution.created_at
from public.homework_solutions as solution
where solution.textbook_id = 'geometry'
  and solution.textbook_edition = '14-е издание, Просвещение, 2023'
  and solution.source_url = '/textbooks/geometry-7-9-atanasyan.pdf'
  and solution.task = '9'
  and solution.source = 'number'
on conflict (
  textbook_id,
  textbook_edition,
  source_url,
  task,
  condition_normalized
)
do update set
  solution_id = excluded.solution_id,
  source_page = excluded.source_page,
  subject = excluded.subject,
  textbook_title = excluded.textbook_title;

with repaired_user as (
  select generated.user_id
  from private.user_generated_homework_solutions as generated
  where generated.textbook_id = 'geometry'
    and generated.task = '4'
    and generated.created_at >= '2026-08-28 17:00:00+00'::timestamptz
    and private.homework_solution_payload_is_current(generated.solution)
  order by generated.created_at desc
  limit 1
), repaired_solution as (
  select solution.id
  from public.homework_solutions as solution
  where solution.textbook_id = 'geometry'
    and solution.textbook_edition = '14-е издание, Просвещение, 2023'
    and solution.source_url = '/textbooks/geometry-7-9-atanasyan.pdf'
    and solution.task = '9'
    and solution.source = 'number'
)
insert into public.homework_solution_access (
  user_id,
  solution_id,
  idempotency_key,
  purchased_at
)
select
  repaired_user.user_id,
  repaired_solution.id,
  'solution-library-repair-geometry-9-20260828',
  now()
from repaired_user
cross join repaired_solution
on conflict do nothing;

do $$
begin
  if exists (
    select 1
    from private.user_generated_homework_solutions as generated
    join public.verified_homework_tasks as canonical
      on canonical.textbook_id = generated.textbook_id
      and canonical.textbook_edition = generated.textbook_edition
      and canonical.source_url = generated.source_url
      and canonical.source_page is not distinct from generated.source_page
      and canonical.task = generated.task
      and canonical.condition_normalized = generated.condition_normalized
    where private.homework_solution_payload_is_current(generated.solution)
      and generated.solution ->> 'condition' = canonical.condition
      and not exists (
        select 1
        from public.homework_solution_catalog as catalog
        where catalog.textbook_id = generated.textbook_id
          and catalog.textbook_edition = generated.textbook_edition
          and catalog.source_url = generated.source_url
          and catalog.source_page is not distinct from generated.source_page
          and catalog.task = generated.task
          and catalog.condition_normalized = generated.condition_normalized
      )
  ) then
    raise exception 'reviewed numbered solution is missing from the public catalog';
  end if;

  if not exists (
    select 1
    from public.homework_solution_catalog
    where textbook_id = 'geometry'
      and textbook_edition = '14-е издание, Просвещение, 2023'
      and source_url = '/textbooks/geometry-7-9-atanasyan.pdf'
      and task = '9'
  ) then
    raise exception 'geometry task 9 was not restored to the solution catalog';
  end if;
end;
$$;
