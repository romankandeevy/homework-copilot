-- Резервирование оплаты решения ДО вызова модели.
--
-- Проблема: ensureAccountBalance в server/homeworkSolver.ts делал только
-- `select balance` и сравнение, а фактическое списание происходило в
-- complete_homework_solution уже ПОСЛЕ ответа модели. Ключ идемпотентности
-- задаёт клиент, поэтому несколько параллельных запросов с разными ключами
-- проходили проверку одновременно, запускали платную модель несколько раз,
-- а списывалось за один.
--
-- Решение: списываем вперёд. Запись в wallet_entries с ключом идемпотентности
-- служит одновременно резервом и защитой от повторного списания —
-- complete_homework_solution и spend_solution_credit оба пропускают списание,
-- если запись с таким ключом уже есть. Если решение получить не удалось,
-- резерв возвращается компенсирующей записью.

-- ---------------------------------------------------------------------------
-- 1. Резерв: атомарное списание до вызова модели
-- ---------------------------------------------------------------------------

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
as $$
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

  if p_source not in ('number', 'photo') then
    raise exception 'invalid solution source' using errcode = '22023';
  end if;

  -- Резерв под этим ключом уже есть: повторный вызов ничего не списывает.
  if exists (
    select 1 from public.wallet_entries
    where user_id = current_user_id
      and idempotency_key = p_idempotency_key
  ) then
    select balance into resulting_balance
    from public.wallet_accounts
    where user_id = current_user_id;

    return jsonb_build_object('balance', resulting_balance, 'reserved', false, 'alreadyReserved', true);
  end if;

  solution_price := case
    when p_source = 'photo' then 15
    else private.solution_task_price(p_textbook_id, p_task_number)
  end;

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
  -- Гонка двух одновременных резервов под одним ключом: побеждает первый,
  -- второй возвращает текущий баланс без повторного списания.
  when unique_violation then
    select balance into resulting_balance
    from public.wallet_accounts
    where user_id = current_user_id;

    return jsonb_build_object('balance', resulting_balance, 'reserved', false, 'alreadyReserved', true);
end;
$$;

revoke all on function public.reserve_solution_credit(text, integer, text, text, text)
  from public, anon, authenticated;
grant execute on function public.reserve_solution_credit(text, integer, text, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Возврат резерва, если решение так и не выдано
-- ---------------------------------------------------------------------------
--
-- Безопасно для вызова самим пользователем: возврат проходит только когда
-- решение фактически не доставлено — то есть по этому ключу нет строки
-- в homework_solution_access. Вернуть деньги за полученное решение нельзя.

create or replace function public.refund_solution_credit(
  p_idempotency_key text,
  p_reason text default 'Решение не получено'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  reserved_entry public.wallet_entries%rowtype;
  refund_key text;
  resulting_balance integer;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if char_length(coalesce(p_idempotency_key, '')) not between 8 and 160 then
    raise exception 'invalid idempotency key' using errcode = '22023';
  end if;

  if char_length(coalesce(p_reason, '')) not between 1 and 160 then
    raise exception 'invalid refund reason' using errcode = '22023';
  end if;

  refund_key := left(p_idempotency_key || ':refund', 160);

  select * into reserved_entry
  from public.wallet_entries
  where user_id = current_user_id
    and idempotency_key = p_idempotency_key
    and kind = 'debit'
  for update;

  if reserved_entry.id is null then
    return jsonb_build_object('refunded', false, 'reason', 'no reservation');
  end if;

  if exists (
    select 1 from public.wallet_entries
    where user_id = current_user_id
      and idempotency_key = refund_key
  ) then
    select balance into resulting_balance
    from public.wallet_accounts
    where user_id = current_user_id;
    return jsonb_build_object('refunded', false, 'reason', 'already refunded', 'balance', resulting_balance);
  end if;

  if exists (
    select 1 from public.homework_solution_access
    where user_id = current_user_id
      and idempotency_key = p_idempotency_key
  ) then
    return jsonb_build_object('refunded', false, 'reason', 'solution delivered');
  end if;

  update public.wallet_accounts
  set balance = balance - reserved_entry.amount
  where user_id = current_user_id
  returning balance into resulting_balance;

  insert into public.wallet_entries (user_id, amount, kind, description, idempotency_key)
  values (current_user_id, -reserved_entry.amount, 'credit', p_reason, refund_key);

  return jsonb_build_object('refunded', true, 'balance', resulting_balance);
exception
  when unique_violation then
    select balance into resulting_balance
    from public.wallet_accounts
    where user_id = current_user_id;
    return jsonb_build_object('refunded', false, 'reason', 'already refunded', 'balance', resulting_balance);
end;
$$;

revoke all on function public.refund_solution_credit(text, text)
  from public, anon, authenticated;
grant execute on function public.refund_solution_credit(text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Индексы под проверки резерва и возврата
-- ---------------------------------------------------------------------------

create index if not exists wallet_entries_user_key_idx
  on public.wallet_entries (user_id, idempotency_key);

create index if not exists homework_solution_access_user_key_idx
  on public.homework_solution_access (user_id, idempotency_key);
