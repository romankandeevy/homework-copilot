-- Свой резерв — не «использованный ключ».
--
-- 30 августа появился резерв оплаты: reserve_solution_credit списывает деньги
-- ДО вызова модели, и запись в wallet_entries с ключом идемпотентности — это
-- и есть резерв. Но внутри complete_homework_solution осталась защита прежней
-- эпохи, когда списание делал сам complete: «запись с этим ключом уже есть —
-- значит ключ использован». С резервом она стала ловить собственную запись
-- и роняла каждое решение залогиненного ученика: резерв → генерация →
-- отказ 'idempotency key already used' → возврат денег. Снаружи это выглядело
-- как «Не получилось безопасно сохранить готовое решение».
--
-- Гостя это не касалось (у него нет кошелька), поэтому гостевая проверка
-- прошла, а залогиненный путь остался сломанным.
--
-- «Использованным» ключ считается по факту ВЫДАЧИ решения, а не по записи
-- в кошельке: в общей ветке это previous_solution_id из
-- homework_solution_access, в номерной — личная запись с тем же ключом.
-- Двойного списания нет: spend_solution_credit идемпотентен и при живом
-- резерве просто возвращает баланс без второй записи.

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
  p_solution jsonb default null::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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
    or (p_source = 'number' and char_length(coalesce(p_source_url, '')) not between 1 and 500)
    or char_length(coalesce(p_source_url, '')) > 500
    or p_source not in ('number', 'photo', 'text')
    or (p_source = 'number' and (
      p_task !~ '^[0-9]{1,4}(\.[0-9]{1,3}){0,2}$'
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

    -- Запись в кошельке с этим ключом — наш собственный резерв, а не чужое
    -- списание: reserve_solution_credit создаёт её до вызова модели.
    -- «Использованным» ключ считается, только когда по нему уже выдано
    -- другое решение.
    if exists (
      select 1 from private.user_generated_homework_solutions
      where user_id = current_user_id and idempotency_key = p_idempotency_key
    ) then
      raise exception 'idempotency key already used' using errcode = '22023';
    end if;

    solution_price := private.solution_price_kopecks();
    description := 'Решение задачи № ' || p_task || ' · ' || private.format_kopecks(solution_price);

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
    -- Личное решение по фото или по вписанному условию ищется в своём же
    -- источнике: раньше здесь всегда стоял 'photo', и текстовая задача
    -- никогда не находила собственную запись.
    select * into stored_solution
    from public.homework_solutions
    where textbook_id = p_textbook_id
      and textbook_edition = p_edition
      and source_url = p_source_url
      and task = p_task
      and source = p_source
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

  -- Проверки записи в кошельке здесь больше нет: она ловила наш же резерв
  -- и роняла каждое решение залогиненного ученика. Переиспользование ключа
  -- для другой задачи отсекает previous_solution_id выше, а от двойного
  -- списания защищает идемпотентность spend_solution_credit.
  if (stored_solution.id is null or not private.homework_solution_payload_is_current(stored_solution.solution))
    and not private.homework_solution_payload_is_valid(
      p_solution, p_textbook_id, p_task, p_source, p_edition,
      p_source_url, p_source_page, p_condition_normalized
    ) then
    raise exception 'invalid verified homework solution' using errcode = '22023';
  end if;

  solution_price := private.solution_price_kopecks();
  -- Номер попадает в описание только когда он есть. У задачи из текста
  -- в `task` лежит начало условия, и оно вылезало за предел в 160 символов.
  description := case
    when p_source = 'photo' then 'Решение задачи по фото · ' || private.format_kopecks(solution_price)
    when p_source = 'number' then 'Решение задачи № ' || p_task || ' · ' || private.format_kopecks(solution_price)
    else 'Решение задачи · ' || private.format_kopecks(solution_price)
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
$function$;
