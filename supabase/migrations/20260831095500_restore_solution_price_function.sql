-- Цена решения как функция базы: она есть на проде, но её нет ни в одной миграции.
--
-- 31 августа ценовая лестница `private.solution_task_price(text, integer)` была
-- заменена одной ценой. Замена делалась прямо на проде, поэтому функция
-- `private.solution_price_kopecks()` в репозиторий не попала, а миграции
-- 20260831100000, 20260831110000 и 20260901130401 её уже вызывают. Итог: прод
-- работает, а `supabase db reset` и любая новая среда падают дважды —
-- на несуществующей функции и на проверке из 20260831100000, которая требует,
-- чтобы на снесённую лестницу больше никто не ссылался.
--
-- Номер версии намеренно меньше, чем у 20260831100000: чинить нужно до её
-- проверки. На проде миграция ничего не меняет — все три определения ниже
-- сняты с боевой базы 2 сентября 2026 и накладываются поверх самих себя.
-- Применять её к проду следует с `supabase db push --include-all`.

-- 1. Единственный источник цены. `select 500` — 5 ₽, как в
--    `src/lib/solutionPricing.ts`. Меняешь цену — меняй оба места.
create or replace function private.solution_price_kopecks()
returns integer
language sql
immutable
set search_path = ''
as $function$ select 500 $function$;

-- 2. Резерв оплаты перестаёт зависеть от номера задачи. Тело идентично тому,
--    что стоит на проде после 20260901130401: цена одна, источник `text`
--    разрешён, возвращённый резерв не считается оплатой.
create or replace function public.reserve_solution_credit(
  p_idempotency_key text,
  p_task_number integer default null::integer,
  p_textbook_id text default null::text,
  p_source text default 'number'::text,
  p_description text default 'Решение задачи'::text
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

-- 3. Сама лестница. На проде её нет с 31 августа; здесь она снимается и
--    в чистой базе, иначе проверка из 20260831100000 останется бессмысленной.
drop function if exists private.solution_task_price(text, integer);

-- Проверка ровно того, ради чего миграция и написана.
do $check$
declare
  broken text;
begin
  if private.solution_price_kopecks() <> 500 then
    raise exception 'цена решения должна быть 500 копеек';
  end if;

  select string_agg(n.nspname || '.' || p.proname, ', ')
  into broken
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
    and p.prokind = 'f'
    and p.prosrc like '%solution_task_price%';

  if broken is not null then
    raise exception 'на снесённую solution_task_price всё ещё ссылаются: %', broken;
  end if;
end;
$check$;
