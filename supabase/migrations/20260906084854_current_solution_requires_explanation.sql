-- «Свежее решение» в базе - то же самое, что свежее решение на сервере.
--
-- 6 сентября задача по комбинаторике не сохранялась ни с какой попытки.
-- Причина: 4 сентября для неё уже легла запись без раздела «Объяснение».
-- База считала её свежей (engineVersion >= 2 и reviewPassed = true) и на
-- каждый повтор возвращала её вместо только что сгенерированного решения,
-- а сервер бракует решение без объяснения (isCurrentReviewedSolution).
-- Получался замкнутый круг: генерация проходит, ответ отвергается, деньги
-- возвращаются, «Решить ещё раз» ничего не меняет.
--
-- Признак свежести теперь включает объяснение - ровно как в
-- validateSolutionQuality: не меньше двух строк, каждая длиной от 24
-- символов. Устаревшая запись перестаёт считаться свежей, и
-- complete_homework_solution перезаписывает её новым решением.

create or replace function private.homework_solution_payload_is_current(p_solution jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select jsonb_typeof(p_solution) = 'object'
    and case
      when coalesce(p_solution ->> 'engineVersion', '') ~ '^[0-9]+$'
        then (p_solution ->> 'engineVersion')::integer >= 2
      else false
    end
    and p_solution #>> '{quality,reviewPassed}' = 'true'
    and jsonb_typeof(p_solution -> 'explanation') = 'array'
    and jsonb_array_length(p_solution -> 'explanation') >= 2
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements_text(p_solution -> 'explanation') as line
      where pg_catalog.length(line) < 24
    );
$function$;
