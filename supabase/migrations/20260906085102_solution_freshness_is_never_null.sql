-- Признак свежести должен быть да или нет, а не «неизвестно».
--
-- У старой записи ключа `explanation` нет вовсе, поэтому
-- `jsonb_typeof(p_solution -> 'explanation')` даёт NULL, и вся цепочка
-- условий возвращала NULL вместо false. В `if` это ведёт себя как false,
-- но в complete_homework_solution есть ветка `not payload_is_current(...)
-- and not payload_is_valid(...)`, где NULL гасит проверку целиком.
-- Заворачиваем результат в coalesce: отсутствие объяснения - это «нет».

create or replace function private.homework_solution_payload_is_current(p_solution jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select coalesce(
    jsonb_typeof(p_solution) = 'object'
      and case
        when coalesce(p_solution ->> 'engineVersion', '') ~ '^[0-9]+$'
          then (p_solution ->> 'engineVersion')::integer >= 2
        else false
      end
      and coalesce(p_solution #>> '{quality,reviewPassed}', '') = 'true'
      and coalesce(jsonb_typeof(p_solution -> 'explanation'), '') = 'array'
      and coalesce(jsonb_array_length(p_solution -> 'explanation'), 0) >= 2
      and not exists (
        select 1
        from pg_catalog.jsonb_array_elements_text(p_solution -> 'explanation') as line
        where pg_catalog.length(line) < 24
      ),
    false
  );
$function$;
