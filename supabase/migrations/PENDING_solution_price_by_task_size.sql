-- Цена по размеру задачи.
--
-- ЭТА МИГРАЦИЯ ЕЩЁ НЕ ПРИМЕНЕНА. Применишь - переименуй файл в ту версию,
-- которую запишет база, как и все остальные миграции.
--
-- Плоские 5 ₽ были честны, пока задачи были одного размера. Замер
-- 6 сентября показал разброс себестоимости почти в десять раз: короткая
-- задача по истории - 0,24 кредита, трудная комбинаторика с починкой - 2,07.
-- При плоской цене лёгкие задачи оплачивают трудные.
--
-- Считать цену в браузере нельзя: число, присланное клиентом, ничем не
-- подтверждается, и решение за рубль стало бы делом одной правки в консоли.
-- Поэтому цену считает сервер и подписывает её тем же секретом, которым
-- подписываются решения, а база подпись проверяет.
--
-- Миграция добавочная: reserve_solution_credit, spend_solution_credit,
-- refund_solution_credit и complete_homework_solution не меняются. Прод
-- продолжает работать по прежней плоской цене, пока его код не переведён
-- на _v2. Возврат верен и для новой цены: refund возвращает сумму
-- фактической записи в кошельке, а не константу.

-- Зеркало формулы из src/lib/solutionPricing.ts. Меняешь там - меняй здесь.
create or replace function private.solution_price_kopecks_for(
  p_condition_length integer,
  p_image_bytes integer,
  p_subject text
)
returns integer
language sql
immutable
set search_path = ''
as $function$
  select least(
    1200,
    greatest(
      400,
      round((
        400
        -- Условие сверх четырёхсот знаков: длиннее задача - длиннее разбор.
        + floor(greatest(0, coalesce(p_condition_length, 0) - 400) / 600.0) * 100
        -- Снимок: свои токены плюс расшифровка условия перед решением.
        + case when coalesce(p_image_bytes, 0) > 0 then 100 else 0 end
        -- Крупный снимок - обычно страница целиком, а не одна задача.
        + case when coalesce(p_image_bytes, 0) > 700000 then 100 else 0 end
        -- Счётные предметы: починка вторым вызовом там скорее правило.
        + case
            when lower(coalesce(p_subject, '')) ~ '(математик|алгебр|геометри|физик|хими|информатик|астроном)'
            then 100 else 0
          end
      ) / 50.0) * 50
    )
  )::integer;
$function$;

-- Подпись цены. Тот же секрет, что у решений: цену считает сервер, база
-- лишь удостоверяет, что это её собственный расчёт, а не число из браузера.
create or replace function private.solution_price_proof(
  p_idempotency_key text,
  p_price_kopecks integer
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  signing_secret text;
begin
  select secret into signing_secret
  from private.solver_signing_secrets
  where id = 'primary';

  if signing_secret is null then
    raise exception 'solver signing secret is not configured' using errcode = '55000';
  end if;

  return pg_catalog.encode(
    extensions.hmac(
      pg_catalog.convert_to(
        'price:' || coalesce(p_idempotency_key, '') || ':' || coalesce(p_price_kopecks, 0)::text,
        'UTF8'
      ),
      pg_catalog.convert_to(signing_secret, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
end;
$function$;

create or replace function public.sign_solution_price(
  p_idempotency_key text,
  p_price_kopecks integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_price_kopecks < 400 or p_price_kopecks > 1200 then
    raise exception 'price out of range' using errcode = '22023';
  end if;

  return private.solution_price_proof(p_idempotency_key, p_price_kopecks);
end;
$function$;

revoke all on function public.sign_solution_price(text, integer) from public, anon, authenticated;
grant execute on function public.sign_solution_price(text, integer) to service_role;

-- Резерв с ценой. От reserve_solution_credit отличается ровно двумя вещами:
-- цена приходит снаружи и обязана быть подписана.
create or replace function public.reserve_solution_credit_v2(
  p_idempotency_key text,
  p_price_kopecks integer,
  p_price_proof text,
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

  if p_price_kopecks is null or p_price_kopecks < 400 or p_price_kopecks > 1200 then
    raise exception 'price out of range' using errcode = '22023';
  end if;

  -- Подпись доказывает, что цену посчитал наш сервер по своей формуле.
  -- Без неё цену задавал бы тот, кто платит.
  if coalesce(p_price_proof, '') <> private.solution_price_proof(p_idempotency_key, p_price_kopecks) then
    raise exception 'price proof mismatch' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.wallet_entries
    where user_id = current_user_id
      and idempotency_key = p_idempotency_key
  ) then
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

  update public.wallet_accounts
  set balance = balance - p_price_kopecks
  where user_id = current_user_id
    and balance >= p_price_kopecks
  returning balance into resulting_balance;

  if resulting_balance is null then
    raise exception 'insufficient balance' using errcode = 'P0001';
  end if;

  insert into public.wallet_entries (user_id, amount, kind, description, idempotency_key)
  values (current_user_id, -p_price_kopecks, 'debit', p_description, p_idempotency_key);

  return jsonb_build_object('balance', resulting_balance, 'reserved', true, 'price', p_price_kopecks);
exception
  when unique_violation then
    select balance into resulting_balance
    from public.wallet_accounts
    where user_id = current_user_id;

    return jsonb_build_object('balance', resulting_balance, 'reserved', false, 'alreadyReserved', true);
end;
$function$;

revoke all on function public.reserve_solution_credit_v2(text, integer, text, integer, text, text, text)
  from public, anon;
grant execute on function public.reserve_solution_credit_v2(text, integer, text, integer, text, text, text)
  to authenticated, service_role;
