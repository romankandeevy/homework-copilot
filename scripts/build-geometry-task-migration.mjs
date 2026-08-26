import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const scanFile = path.resolve(process.argv[2] ?? 'tmp/pdfs/geometry-task-index-final.json')
const outputFile = path.resolve(process.argv[3] ?? 'supabase/migrations/20260826143000_index_geometry_textbook_tasks.sql')
const scan = JSON.parse(await readFile(scanFile, 'utf8'))
const tasks = [...scan.tasks].sort((left, right) => Number(left.task) - Number(right.task))

if (tasks.length !== 1431) throw new Error(`Expected 1431 tasks, received ${tasks.length}`)
for (const [index, task] of tasks.entries()) {
  if (task.task !== String(index + 1)) throw new Error(`Task sequence breaks at ${index + 1}`)
  if (task.condition.length < 8) throw new Error(`Task ${task.task} has no condition`)
  if (task.source_page < 9 || task.source_page > 365) throw new Error(`Task ${task.task} has an invalid page`)
  if (!Array.isArray(task.diagram_regions)) throw new Error(`Task ${task.task} has invalid diagram regions`)
}

const taskJson = JSON.stringify(tasks)
const sql = `alter table public.verified_homework_tasks
  alter column solution_payload drop not null,
  add column if not exists condition text,
  add column if not exists source_region jsonb,
  add column if not exists ocr_confidence smallint,
  add column if not exists has_diagram boolean not null default false,
  add column if not exists diagram_regions jsonb not null default '[]'::jsonb;

alter table public.verified_homework_tasks
  drop constraint if exists verified_homework_tasks_payload_object;

alter table public.verified_homework_tasks
  add constraint verified_homework_tasks_payload_object
    check (solution_payload is null or jsonb_typeof(solution_payload) = 'object'),
  add constraint verified_homework_tasks_condition_length
    check (char_length(condition) between 1 and 5000),
  add constraint verified_homework_tasks_ocr_confidence
    check (ocr_confidence between 0 and 100),
  add constraint verified_homework_tasks_source_region_object
    check (jsonb_typeof(source_region) = 'object'),
  add constraint verified_homework_tasks_diagram_regions_array
    check (jsonb_typeof(diagram_regions) = 'array');

with source_tasks as (
  select *
  from pg_catalog.jsonb_to_recordset($geometry_tasks$${taskJson}$geometry_tasks$::jsonb) as source_task(
    task text,
    source_page integer,
    condition text,
    condition_normalized text,
    ocr_confidence smallint,
    has_diagram boolean,
    source_region jsonb,
    diagram_regions jsonb
  )
)
insert into public.verified_homework_tasks (
  textbook_id,
  textbook_edition,
  source_url,
  task,
  source_page,
  condition,
  condition_normalized,
  source_region,
  ocr_confidence,
  has_diagram,
  diagram_regions
)
select
  'geometry',
  '14-е издание, Просвещение, 2023',
  '/textbooks/geometry-7-9-atanasyan.pdf',
  source_task.task,
  source_task.source_page,
  source_task.condition,
  source_task.condition_normalized,
  source_task.source_region,
  source_task.ocr_confidence,
  source_task.has_diagram,
  source_task.diagram_regions
from source_tasks as source_task
on conflict (textbook_id, textbook_edition, source_url, task)
do update set
  source_page = excluded.source_page,
  condition = excluded.condition,
  condition_normalized = excluded.condition_normalized,
  source_region = excluded.source_region,
  ocr_confidence = excluded.ocr_confidence,
  has_diagram = excluded.has_diagram,
  diagram_regions = excluded.diagram_regions;

alter table public.verified_homework_tasks
  alter column condition set not null,
  alter column source_region set not null,
  alter column ocr_confidence set not null;

drop function if exists public.get_verified_homework_task(text, text, text, text);

create function public.get_verified_homework_task(
  p_textbook_id text,
  p_edition text,
  p_source_url text,
  p_task text
)
returns table (
  condition text,
  condition_normalized text,
  source_url text,
  source_page integer,
  source_region jsonb,
  diagram_regions jsonb,
  ocr_confidence smallint,
  has_diagram boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    verified.condition,
    verified.condition_normalized,
    verified.source_url,
    verified.source_page,
    verified.source_region,
    verified.diagram_regions,
    verified.ocr_confidence,
    verified.has_diagram
  from public.verified_homework_tasks as verified
  where char_length(coalesce(p_textbook_id, '')) between 1 and 150
    and char_length(coalesce(p_edition, '')) between 1 and 200
    and char_length(coalesce(p_source_url, '')) between 1 and 500
    and p_task ~ '^[0-9]{1,4}$'
    and verified.textbook_id = p_textbook_id
    and verified.textbook_edition = p_edition
    and verified.source_url = p_source_url
    and verified.task = p_task
  limit 1
$$;

revoke all on function public.get_verified_homework_task(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.get_verified_homework_task(text, text, text, text)
  to anon, authenticated;

create extension if not exists pgcrypto with schema extensions;

create table if not exists private.solver_signing_secrets (
  id text primary key,
  secret text not null,
  created_at timestamptz not null default now(),
  constraint solver_signing_secrets_id_length check (char_length(id) between 1 and 80),
  constraint solver_signing_secrets_secret_length check (char_length(secret) >= 64)
);

revoke all on table private.solver_signing_secrets from public, anon, authenticated;

insert into private.solver_signing_secrets (id, secret)
values ('primary', pg_catalog.encode(extensions.gen_random_bytes(48), 'hex'))
on conflict (id) do nothing;

create or replace function private.homework_solution_proof_payload(p_solution jsonb)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select pg_catalog.concat_ws(
    pg_catalog.chr(30),
    coalesce(p_solution ->> 'textbookId', ''),
    coalesce(p_solution ->> 'task', ''),
    coalesce(p_solution ->> 'source', ''),
    coalesce(p_solution ->> 'textbookEdition', ''),
    coalesce(p_solution ->> 'sourceUrl', ''),
    coalesce(p_solution ->> 'sourcePage', ''),
    coalesce(p_solution ->> 'conditionNormalized', ''),
    coalesce(p_solution ->> 'subject', ''),
    coalesce(p_solution ->> 'textbookTitle', ''),
    coalesce(p_solution ->> 'condition', ''),
    coalesce((
      select pg_catalog.string_agg(item.value, pg_catalog.chr(31) order by item.ordinality)
      from pg_catalog.jsonb_array_elements_text(coalesce(p_solution -> 'given', '[]'::jsonb))
        with ordinality as item(value, ordinality)
    ), ''),
    coalesce(p_solution #>> '{goal,title}', ''),
    coalesce(p_solution #>> '{goal,text}', ''),
    coalesce((
      select pg_catalog.string_agg(item.value, pg_catalog.chr(31) order by item.ordinality)
      from pg_catalog.jsonb_array_elements_text(coalesce(p_solution -> 'steps', '[]'::jsonb))
        with ordinality as item(value, ordinality)
    ), ''),
    coalesce(p_solution ->> 'answer', ''),
    coalesce(p_solution #>> '{diagram,kind}', ''),
    coalesce(p_solution #>> '{diagram,description}', ''),
    coalesce((
      select pg_catalog.string_agg(item.value, pg_catalog.chr(31) order by item.ordinality)
      from pg_catalog.jsonb_array_elements_text(coalesce(p_solution #> '{diagram,vertices}', '[]'::jsonb))
        with ordinality as item(value, ordinality)
    ), ''),
    coalesce(p_solution #>> '{diagram,apexAngle}', ''),
    coalesce(p_solution #>> '{diagram,auxiliaryKind}', ''),
    coalesce(p_solution #>> '{diagram,auxiliaryLabel}', ''),
    coalesce(p_solution #>> '{diagram,rightAngleAt}', ''),
    coalesce(p_solution #>> '{diagram,parallelTo}', ''),
    coalesce(p_solution #>> '{diagram,exteriorAngle}', ''),
    coalesce(p_solution ->> 'sourceVerified', '')
  )
$$;

revoke all on function private.homework_solution_proof_payload(jsonb)
  from public, anon, authenticated;

create or replace function private.enforce_verified_number_solution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  canonical_payload jsonb;
  signing_secret text;
  supplied_proof text;
  expected_proof text;
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

  if not found then
    raise exception 'numbered homework task is not verified'
      using errcode = '22023';
  end if;

  if canonical_payload is not null
    and (new.solution - 'createdAt' - '_serverProof') = canonical_payload then
    new.solution := new.solution - '_serverProof';
    return new;
  end if;

  supplied_proof := coalesce(new.solution ->> '_serverProof', '');
  select secret into signing_secret
  from private.solver_signing_secrets
  where id = 'primary';

  if signing_secret is null then
    raise exception 'solver signing secret is not configured'
      using errcode = '55000';
  end if;

  expected_proof := pg_catalog.encode(
    extensions.hmac(
      pg_catalog.convert_to(private.homework_solution_proof_payload(new.solution), 'UTF8'),
      pg_catalog.convert_to(signing_secret, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  if supplied_proof !~ '^[0-9a-f]{64}$' or supplied_proof <> expected_proof then
    raise exception 'numbered homework solution is not signed by the solver'
      using errcode = '22023';
  end if;

  new.solution := new.solution - '_serverProof';
  return new;
end;
$$;

revoke all on function private.enforce_verified_number_solution()
  from public, anon, authenticated;

drop trigger if exists homework_solutions_require_verified_number on public.homework_solutions;
create trigger homework_solutions_require_verified_number
  before insert or update on public.homework_solutions
  for each row execute function private.enforce_verified_number_solution();

analyze public.verified_homework_tasks;
`

await writeFile(outputFile, sql, 'utf8')
process.stdout.write(`tasks=${tasks.length}\tbytes=${Buffer.byteLength(sql, 'utf8')}\tdiagrams=${tasks.filter((task) => task.has_diagram).length}\n`)
