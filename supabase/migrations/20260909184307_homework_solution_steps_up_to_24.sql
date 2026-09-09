-- Предел строк решения в базе поднят с 14 до 24.
--
-- 9 сентября неравенства 862 не сохранялись: «Не получилось сохранить готовое
-- решение». Четыре пункта столбиком - шестнадцать строк, а база принимала
-- четырнадцать. Сервер к этому времени считал иначе: у расчётной задачи
-- двадцать строк, у развёрнутого ответа двадцать четыре
-- (roomyNotebookLimits и essayNotebookLimits в server/geometrySolutionEngine.ts).
-- Длину меряет сервер по предмету, база держит только верхний потолок.
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
    and jsonb_array_length(p_solution -> 'steps') between 1 and 24;
$$;

revoke all on function private.homework_solution_payload_is_valid(jsonb, text, text, text, text, text, integer, text) from public, anon, authenticated;
