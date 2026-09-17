-- Решение оплачивается только подписанной ценой и только подписанным решением.
--
-- Аудит 16 сентября, пункты А1, Б1 и В7.
--
-- А1. Два пути списывали плоские 500 копеек вместо цены, показанной на кнопке:
--   1) сервер без подписи цены звал reserve_solution_credit, а она берёт
--      private.solution_price_kopecks(). Сервер теперь отвечает 503 и не
--      резервирует ничего, а функция закрыта для браузера и для ролей
--      вообще: путь исчезает физически;
--   2) стадия восстановления зовёт complete_homework_solution без решения,
--      и на найденном чужом решении без доступа функция шла в
--      spend_solution_credit с плоской ценой. Теперь без решения и без доступа
--      она возвращает null: сервер пройдёт резерв с подписанной ценой и
--      вернётся уже с решением. Списание внутри complete больше не заводит
--      новую запись в кошельке: без резерва по этому ключу - отказ
--      'reservation required'. Так плоская цена недостижима ни одним путём.
--
-- Б1. Личное решение по вписанному условию искалось по подписи задачи, а
--   подпись была первыми 60 знаками условия. «Решите неравенство ...: 2x > 4»
--   и «... 3x < 9» считались одной задачей: вторая получала решение первой,
--   а новое решение затирало оплаченное. Теперь текстовое решение ищется ещё
--   и по condition_normalized. Подпись новых задач клиент делает уникальной
--   (`text-<ключ>`, как `photo-<ключ>`), а сравнение условия защищает старые
--   записи с подписью-срезом. Фото сравнивать по условию нельзя: при
--   восстановлении условие ещё не прочитано моделью, а подпись фото и так
--   уникальна.
--
-- В7. Проверка payload требовала подпись сервера (_serverProof) только у
--   задач по номеру. Кто угодно мог позвать complete_homework_solution с
--   source = 'photo' и своим jsonb и записать в библиотеку свой текст с
--   quality.reviewPassed = true. Теперь подпись обязательна для всех
--   источников. Сервер подписывает каждое решение перед сохранением
--   (withServerProof), так что его путь не меняется.

-- ---------------------------------------------------------------------------
-- 1. Подпись обязательна для любого сохраняемого решения
-- ---------------------------------------------------------------------------

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
stable
set search_path = ''
as $$
  -- coalesce: пропавший ключ в payload даёт NULL, а `if not NULL` в
  -- complete_homework_solution не срабатывает и пропускает решение.
  select coalesce(
    private.homework_solution_payload_is_current(p_solution)
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
    and jsonb_array_length(p_solution -> 'steps') between 1 and 24
    and private.homework_solution_payload_has_valid_proof(p_solution),
    false
  );
$$;

revoke all on function private.homework_solution_payload_is_valid(jsonb, text, text, text, text, text, integer, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Выдача решения: без решения и без доступа - null, списание только по резерву
-- ---------------------------------------------------------------------------

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
      -- Сохранённое решение отдаётся только когда нового нет (9 сентября).
      if p_solution is null then
        if private.homework_solution_payload_is_current(personal_solution.solution) then
          return jsonb_set(personal_solution.solution, '{ownerId}', to_jsonb(current_user_id::text));
        end if;
        return null;
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

    if exists (
      select 1 from private.user_generated_homework_solutions
      where user_id = current_user_id and idempotency_key = p_idempotency_key
    ) then
      raise exception 'idempotency key already used' using errcode = '22023';
    end if;

    -- Деньги берёт только резерв решателя с подписанной ценой. Без него
    -- spend_solution_credit списала бы плоскую цену - этого пути больше нет.
    if not exists (
      select 1 from public.wallet_entries
      where user_id = current_user_id
        and idempotency_key = p_idempotency_key
        and kind = 'debit'
    ) then
      raise exception 'reservation required' using errcode = 'P0001';
    end if;

    solution_price := private.solution_price_kopecks();
    description := 'Решение задачи № ' || p_task || ' · ' || private.format_kopecks(solution_price);

    -- Резерв на месте: функция проверит, что он не возвращён, и ничего не спишет.
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
    -- источнике. У текста сравнивается и само условие: подпись старых задач -
    -- первые 60 знаков, и две разные задачи с общим началом были одной.
    select * into stored_solution
    from public.homework_solutions
    where textbook_id = p_textbook_id
      and textbook_edition = p_edition
      and source_url = p_source_url
      and task = p_task
      and source = p_source
      and created_by = current_user_id
      and (p_source = 'photo' or condition_normalized = p_condition_normalized)
    order by created_at desc
    limit 1;
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
    -- Новое решение перезаписывает уже оплаченную запись, второй раз денег не берём.
    if p_solution is null then
      if private.homework_solution_payload_is_current(stored_solution.solution) then
        return jsonb_set(stored_solution.solution, '{ownerId}', to_jsonb(current_user_id::text));
      end if;
      return null;
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

  /* А1, путь 2. Без присланного решения и без доступа не отдаём ничего,
     даже если готовое решение лежит в библиотеке. Раньше здесь списывалась
     плоская цена и выдавалось найденное - мимо подписанной цены и до
     дневных пределов. Сервер получит null, пройдёт резерв с подписанной
     ценой и вернётся сюда с решением. */
  if p_solution is null then return null; end if;

  if (stored_solution.id is null or not private.homework_solution_payload_is_current(stored_solution.solution))
    and not private.homework_solution_payload_is_valid(
      p_solution, p_textbook_id, p_task, p_source, p_edition,
      p_source_url, p_source_page, p_condition_normalized
    ) then
    raise exception 'invalid verified homework solution' using errcode = '22023';
  end if;

  -- Присланное решение поверх актуальной записи тоже обязано быть подписано:
  -- иначе чужой текст лёг бы в библиотеку через ветку перезаписи ниже.
  if not coalesce(private.homework_solution_payload_has_valid_proof(p_solution), false) then
    raise exception 'invalid verified homework solution' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.wallet_entries
    where user_id = current_user_id
      and idempotency_key = p_idempotency_key
      and kind = 'debit'
  ) then
    raise exception 'reservation required' using errcode = 'P0001';
  end if;

  solution_price := private.solution_price_kopecks();
  description := case
    when p_source = 'photo' then 'Решение задачи по фото · ' || private.format_kopecks(solution_price)
    when p_source = 'number' then 'Решение задачи № ' || p_task || ' · ' || private.format_kopecks(solution_price)
    else 'Решение задачи · ' || private.format_kopecks(solution_price)
  end;

  -- Резерв на месте: функция проверит, что он не возвращён, и ничего не спишет.
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
  else
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

revoke all on function public.complete_homework_solution(text, text, text, text, text, text, integer, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.complete_homework_solution(text, text, text, text, text, text, integer, text, text, jsonb)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Плоская цена закрыта физически
-- ---------------------------------------------------------------------------
--
-- reserve_solution_credit (без подписи) и spend_solution_credit не зовёт ни
-- клиент, ни сервер: сервер резервирует через reserve_solution_credit_v2, а
-- spend вызывается только изнутри complete_homework_solution, то есть с
-- правами владельца функции. Прямой вызов из браузера списывал 500 копеек
-- мимо показанной цены.

revoke all on function public.reserve_solution_credit(text, integer, text, text, text)
  from public, anon, authenticated;
revoke all on function public.spend_solution_credit(text, text, integer, text, text)
  from public, anon, authenticated;
