-- Возвращённый резерв — не оплата.
--
-- 1 сентября телефон потерял связь на 25-й секунде решения. Вкладка сочла это
-- отказом сервера, закрыла задачу и попросила возврат: 11:14:03 списание,
-- 11:14:27 возврат. Решатель об обрыве не знал и через две минуты довёл
-- задачу до конца — 11:16:29 решение сохранено и выдано ученику. Деньги
-- вернулись, решение выдано: задача досталась бесплатно.
--
-- Обрыв связи чинится в клиенте, но дыра не в нём. И reserve_solution_credit,
-- и spend_solution_credit считают резерв живым по одному признаку: есть запись
-- списания с этим ключом идемпотентности. Возврат эту запись не гасит — он
-- добавляет встречную запись с ключом `<ключ>:refund`, потому что кошелёк
-- ведётся книгой, а не отменой строк. Поэтому после возврата обе функции
-- видят старое списание и отвечают «уже оплачено», не взяв ни копейки.
--
-- Теперь возвращённый резерв — стоп. Не «оплачено» и не молчаливое повторное
-- списание: повторное списание завело бы обратную дыру, где ученик платит за
-- решение, которого не ждал, и уже никакой возврат за ним не следит.
-- Решение просто не выдаётся, деньги остаются у ученика, задача ставится
-- заново с новым ключом — так делает кнопка «Решить ещё раз».
--
-- Обычного пути это не касается: проверка срабатывает, только когда рядом со
-- списанием лежит возврат по тому же ключу.

create or replace function public.reserve_solution_credit(
  p_idempotency_key text,
  p_task_number integer default null,
  p_textbook_id text default null,
  p_source text default 'number',
  p_description text default 'Решение задачи'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_user_id uuid := (select auth.uid());
  solution_price integer;
  resulting_balance integer;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  perform private.assert_account_not_banned(current_user_id);

  if char_length(coalesce(p_idempotency_key, '')) not between 8 and 160 then
    raise exception 'invalid idempotency key' using errcode = '22023';
  end if;

  if char_length(coalesce(p_description, '')) not between 1 and 160 then
    raise exception 'invalid description' using errcode = '22023';
  end if;

  if p_source not in ('number', 'photo', 'text') then
    raise exception 'invalid solution source' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.wallet_entries
    where user_id = current_user_id
      and idempotency_key = p_idempotency_key
  ) then
    -- Деньги по этому ключу уже вернулись ученику: резерва нет.
    if exists (
      select 1 from public.wallet_entries
      where user_id = current_user_id
        and idempotency_key = left(p_idempotency_key || ':refund', 160)
    ) then
      raise exception 'reservation refunded' using errcode = 'P0001';
    end if;

    select balance into resulting_balance
    from public.wallet_accounts
    where user_id = current_user_id;

    return jsonb_build_object('balance', resulting_balance, 'reserved', false, 'alreadyReserved', true);
  end if;

  -- Цена одна для любого источника и любого предмета. Номер задачи —
  -- необязательная подпись решения, на оплату он больше не влияет.
  solution_price := private.solution_price_kopecks();

  update public.wallet_accounts
  set balance = balance - solution_price
  where user_id = current_user_id
    and balance >= solution_price
  returning balance into resulting_balance;

  if resulting_balance is null then
    raise exception 'insufficient balance' using errcode = 'P0001';
  end if;

  insert into public.wallet_entries (user_id, amount, kind, description, idempotency_key)
  values (current_user_id, -solution_price, 'debit', p_description, p_idempotency_key);

  return jsonb_build_object('balance', resulting_balance, 'reserved', true, 'price', solution_price);
exception
  when unique_violation then
    select balance into resulting_balance
    from public.wallet_accounts
    where user_id = current_user_id;

    return jsonb_build_object('balance', resulting_balance, 'reserved', false, 'alreadyReserved', true);
end;
$function$;

create or replace function public.spend_solution_credit(
  p_idempotency_key text,
  p_description text default 'Решение задачи',
  p_task_number integer default null,
  p_textbook_id text default null,
  p_source text default 'number'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_user_id uuid;
  solution_price integer;
  resulting_balance integer;
begin
  current_user_id := (select auth.uid());

  if current_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  perform private.assert_account_not_banned(current_user_id);

  if char_length(coalesce(p_idempotency_key, '')) not between 8 and 160 then
    raise exception 'invalid idempotency key' using errcode = '22023';
  end if;

  if char_length(coalesce(p_description, '')) not between 1 and 160 then
    raise exception 'invalid description' using errcode = '22023';
  end if;

  if p_source not in ('number', 'photo', 'text') then
    raise exception 'invalid solution source' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.wallet_entries
    where user_id = current_user_id and idempotency_key = p_idempotency_key
  ) then
    -- Ровно тот случай, из-за которого решение уходило бесплатно: списание
    -- на месте, но деньги по нему уже вернулись. Выдавать решение нельзя.
    if exists (
      select 1 from public.wallet_entries
      where user_id = current_user_id
        and idempotency_key = left(p_idempotency_key || ':refund', 160)
    ) then
      raise exception 'reservation refunded' using errcode = 'P0001';
    end if;

    select balance into resulting_balance
    from public.wallet_accounts where user_id = current_user_id;
    return resulting_balance;
  end if;

  solution_price := private.solution_price_kopecks();

  update public.wallet_accounts
  set balance = balance - solution_price
  where user_id = current_user_id and balance >= solution_price
  returning balance into resulting_balance;

  if resulting_balance is null then
    raise exception 'insufficient balance' using errcode = 'P0001';
  end if;

  insert into public.wallet_entries (user_id, amount, kind, description, idempotency_key)
  values (current_user_id, -solution_price, 'debit', p_description, p_idempotency_key);

  return resulting_balance;
exception
  when unique_violation then
    select balance into resulting_balance
    from public.wallet_accounts where user_id = current_user_id;
    return resulting_balance;
end;
$function$;
