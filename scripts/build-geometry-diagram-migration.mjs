import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const indexFile = path.resolve(process.argv[2] ?? 'tmp/pdfs/geometry-task-index-final.json')
const outputFile = path.resolve(process.argv[3] ?? 'supabase/migrations/20260826154500_refine_geometry_task_index_and_diagrams.sql')
const index = JSON.parse(await readFile(indexFile, 'utf8'))
const tasks = [...index.tasks].sort((left, right) => Number(left.task) - Number(right.task))

if (tasks.length !== 1431) throw new Error(`Expected 1431 tasks, received ${tasks.length}`)
for (const [offset, task] of tasks.entries()) {
  if (task.task !== String(offset + 1)) throw new Error(`Task sequence breaks at ${offset + 1}`)
  if (!task.condition || !task.condition_normalized) throw new Error(`Task ${task.task} has no condition`)
  if (!Array.isArray(task.diagram_regions)) throw new Error(`Task ${task.task} has invalid diagram regions`)
  if (task.has_diagram !== (task.diagram_regions.length > 0)) throw new Error(`Task ${task.task} has inconsistent diagram metadata`)
}

const taskJson = JSON.stringify(tasks)
const sql = `alter table public.verified_homework_tasks
  add column if not exists diagram_regions jsonb not null default '[]'::jsonb;

alter table public.verified_homework_tasks
  drop constraint if exists verified_homework_tasks_diagram_regions_array;

alter table public.verified_homework_tasks
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

analyze public.verified_homework_tasks;
`

await writeFile(outputFile, sql, 'utf8')
process.stdout.write(`tasks=${tasks.length}\tbytes=${Buffer.byteLength(sql, 'utf8')}\tdiagrams=${tasks.filter((task) => task.has_diagram).length}\n`)
