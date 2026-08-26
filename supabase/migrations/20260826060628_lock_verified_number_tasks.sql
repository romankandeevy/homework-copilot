create table if not exists public.verified_homework_tasks (
  textbook_id text not null,
  textbook_edition text not null,
  source_url text not null,
  task text not null,
  source_page integer,
  condition_normalized text not null,
  solution_payload jsonb not null,
  primary key (textbook_id, textbook_edition, source_url, task),
  unique (textbook_id, textbook_edition, source_url, task, condition_normalized),
  constraint verified_homework_tasks_payload_object
    check (jsonb_typeof(solution_payload) = 'object')
);

alter table public.verified_homework_tasks enable row level security;
revoke all on public.verified_homework_tasks from public, anon, authenticated;

insert into public.verified_homework_tasks (
  textbook_id,
  textbook_edition,
  source_url,
  task,
  source_page,
  condition_normalized,
  solution_payload
)
values (
  'geometry',
  '14-е издание, Просвещение, 2023',
  '/textbooks/geometry-7-9-atanasyan.pdf',
  '2',
  9,
  'отметьте три точки а, в и с, не лежащие на одной прямой, и через каждую пару точек проведите прямую. сколько прямых получилось?',
  jsonb_build_object(
    'textbookId', 'geometry',
    'task', '2',
    'source', 'number',
    'textbookEdition', '14-е издание, Просвещение, 2023',
    'sourceUrl', '/textbooks/geometry-7-9-atanasyan.pdf',
    'sourcePage', 9,
    'conditionNormalized', 'отметьте три точки а, в и с, не лежащие на одной прямой, и через каждую пару точек проведите прямую. сколько прямых получилось?',
    'subject', 'Геометрия',
    'textbookTitle', 'Геометрия. 7-9 классы',
    'condition', 'Отметьте три точки А, В и С, не лежащие на одной прямой, и через каждую пару точек проведите прямую. Сколько прямых получилось?',
    'given', jsonb_build_array('A, B, C — точки.', 'Не лежат на', 'одной прямой.'),
    'goal', jsonb_build_object('title', 'Найти', 'text', 'число прямых.'),
    'steps', jsonb_build_array('Проведём AB, BC и CA.', 'Всего 3 прямые.'),
    'answer', '3 прямые.',
    'diagram', jsonb_build_object(
      'kind', 'three-point-lines',
      'description', 'Три точки A, B и C, не лежащие на одной прямой, соединены прямыми AB, BC и CA.',
      'vertices', jsonb_build_array('A', 'B', 'C')
    ),
    'sourceVerified', true
  )
)
on conflict (textbook_id, textbook_edition, source_url, task)
do update set
  source_page = excluded.source_page,
  condition_normalized = excluded.condition_normalized,
  solution_payload = excluded.solution_payload;

update public.homework_solutions
set
  source_page = 9,
  solution = jsonb_set(solution, '{sourcePage}', '9'::jsonb)
where textbook_id = 'geometry'
  and textbook_edition = '14-е издание, Просвещение, 2023'
  and source_url = '/textbooks/geometry-7-9-atanasyan.pdf'
  and task = '2'
  and source = 'number'
  and source_page = 8;

update public.homework_solution_catalog as catalog
set source_page = solution.source_page
from public.homework_solutions as solution
where catalog.solution_id = solution.id
  and solution.textbook_id = 'geometry'
  and solution.task = '2'
  and solution.source = 'number';

create or replace function private.enforce_verified_number_solution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  canonical_payload jsonb;
begin
  if new.source <> 'number' then
    return new;
  end if;

  select verified.solution_payload into canonical_payload
  from public.verified_homework_tasks as verified
  where verified.textbook_id = new.textbook_id
    and verified.textbook_edition = new.textbook_edition
    and verified.source_url = new.source_url
    and verified.task = new.task
    and verified.condition_normalized = new.condition_normalized
    and verified.source_page is not distinct from new.source_page;

  if canonical_payload is null
    or (new.solution - 'createdAt') <> canonical_payload then
    raise exception 'numbered homework solutions must match a verified textbook task'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists homework_solutions_require_verified_number on public.homework_solutions;
create trigger homework_solutions_require_verified_number
  before insert or update on public.homework_solutions
  for each row execute function private.enforce_verified_number_solution();
