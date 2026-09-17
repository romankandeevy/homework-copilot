-- Возврат резерва: выданным считается и личное решение, браузер возвращает
-- только закрытую задачу, срок решения согласован с потолком функции.
--
-- Аудит 16 сентября, пункты Б12 и Б9.
--
-- Б12. refund_solution_credit считала решение выданным только по
--   homework_solution_access. Ветка source = 'number' без эталона пишет в
--   private.user_generated_homework_solutions и доступа не заводит - деньги
--   можно было вернуть после выдачи. Сверка в админке (solution_reservation_reason,
--   20260912096000) это уже учитывает, возврат - нет.
--   Кроме того, функция выдана authenticated и отвечала в любой момент
--   генерации: скрипт ставил задачу и через три секунды просил возврат -
--   каждая такая попытка стоила нам три-четыре вызова модели.
--
--   Теперь:
--   - private.refund_solution_reservation - общее тело возврата, выданным
--     считается и доступ, и личное решение с тем же ключом;
--   - public.refund_solution_credit_for_user - для решателя, только service_role;
--   - public.refund_solution_credit (браузер) возвращает, только когда строка
--     очереди закрыта (failed или canceled) - в том числе сроком, - либо
--     строки нет, а резерву больше шести минут: функция с потолком в 300
--     секунд к этому времени мертва. Старый решатель, который зовёт её
--     токеном ученика на ещё идущей задаче, получит отказ - деньги вернёт
--     вкладка, когда строка закроется (эффект возврата в App.tsx).
--
-- Б9. Срок решателя поднят с 230 до 270 секунд (потолок функции - 300).
--   Между отметками стадий теперь может пройти до 270 секунд, поэтому
--   брошенной считается строка без движения шесть минут, а не пять.

-- ---------------------------------------------------------------------------
-- 1. Брошенные задачи: шесть минут без движения
-- ---------------------------------------------------------------------------

create or replace function private.expire_stale_homework_jobs()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.homework_jobs
  set status = 'failed',
      stage = 'failed',
      error = coalesce(error, 'Решение прервалось: страница закрылась или пропала связь. Деньги вернутся на баланс'),
      finished_at = now(),
      updated_at = now()
  where (status = 'running' and updated_at < now() - interval '6 minutes')
     or (status = 'queued' and created_at < now() - interval '20 minutes');
$$;

revoke all on function private.expire_stale_homework_jobs() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Общее тело возврата
-- ---------------------------------------------------------------------------

create or replace function private.refund_solution_reservation(
  p_user_id uuid,
  p_idempotency_key text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  reserved_entry public.wallet_entries%rowtype;
  refund_key text;
  resulting_balance integer;
begin
  if p_user_id is null then
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
  where user_id = p_user_id
    and idempotency_key = p_idempotency_key
    and kind = 'debit'
  for update;

  if reserved_entry.id is null then
    return jsonb_build_object('refunded', false, 'reason', 'no reservation');
  end if;

  if exists (
    select 1 from public.wallet_entries
    where user_id = p_user_id
      and idempotency_key = refund_key
  ) then
    select balance into resulting_balance
    from public.wallet_accounts
    where user_id = p_user_id;
    return jsonb_build_object('refunded', false, 'reason', 'already refunded', 'balance', resulting_balance);
  end if;

  -- Выдано - значит и доступ к решению из библиотеки, и личное решение по
  -- номеру: вторая ветка доступа не заводит.
  if exists (
    select 1 from public.homework_solution_access
    where user_id = p_user_id
      and idempotency_key = p_idempotency_key
  ) or exists (
    select 1 from private.user_generated_homework_solutions
    where user_id = p_user_id
      and idempotency_key = p_idempotency_key
  ) then
    return jsonb_build_object('refunded', false, 'reason', 'solution delivered');
  end if;

  update public.wallet_accounts
  set balance = balance - reserved_entry.amount
  where user_id = p_user_id
  returning balance into resulting_balance;

  insert into public.wallet_entries (user_id, amount, kind, description, idempotency_key)
  values (p_user_id, -reserved_entry.amount, 'credit', p_reason, refund_key);

  return jsonb_build_object('refunded', true, 'balance', resulting_balance);
exception
  when unique_violation then
    select balance into resulting_balance
    from public.wallet_accounts
    where user_id = p_user_id;
    return jsonb_build_object('refunded', false, 'reason', 'already refunded', 'balance', resulting_balance);
end;
$function$;

revoke all on function private.refund_solution_reservation(uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Решатель: возврат своей неудачи
-- ---------------------------------------------------------------------------

create or replace function public.refund_solution_credit_for_user(
  p_user_id uuid,
  p_idempotency_key text,
  p_reason text default 'Решение не получено'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  return private.refund_solution_reservation(p_user_id, p_idempotency_key, p_reason);
end;
$function$;

revoke all on function public.refund_solution_credit_for_user(uuid, text, text) from public, anon, authenticated;
grant execute on function public.refund_solution_credit_for_user(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Браузер: возврат только закрытой задачи
-- ---------------------------------------------------------------------------

create or replace function public.refund_solution_credit(
  p_idempotency_key text,
  p_reason text default 'Решение не получено'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_user_id uuid := (select auth.uid());
  job_status text;
  reserved_at timestamptz;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  -- Строка, которую уже пора закрыть сроком, закрывается здесь же: иначе
  -- возврат за умершую функцию ждал бы следующего опроса очереди.
  perform private.expire_stale_homework_jobs();

  select job.status into job_status
  from public.homework_jobs as job
  where job.user_id = current_user_id
    and job.idempotency_key = p_idempotency_key;

  if job_status is not null then
    if job_status not in ('failed', 'canceled') then
      return jsonb_build_object('refunded', false, 'reason', 'job still running');
    end if;
  else
    -- Строки очереди нет (не завелась у клиента): решатель заведомо мёртв,
    -- только когда резерву больше шести минут.
    select entry.created_at into reserved_at
    from public.wallet_entries as entry
    where entry.user_id = current_user_id
      and entry.idempotency_key = p_idempotency_key
      and entry.kind = 'debit';

    if reserved_at is not null and reserved_at > now() - interval '6 minutes' then
      return jsonb_build_object('refunded', false, 'reason', 'job still running');
    end if;
  end if;

  return private.refund_solution_reservation(current_user_id, p_idempotency_key, p_reason);
end;
$function$;

revoke all on function public.refund_solution_credit(text, text) from public, anon, authenticated;
grant execute on function public.refund_solution_credit(text, text) to authenticated;
