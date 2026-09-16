-- ===========================================================================
-- Дымовая проверка денежных функций базы. Перед каждым `supabase db push`.
--
-- Запуск (к привязанной базе, ничего не сохраняет):
--   supabase db query --linked -f scripts/db-smoke.sql
-- или
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/db-smoke.sql
--
-- Весь файл - одна транзакция, в конце `rollback`. Каждая проверка - свой
-- блок `do`, и при расхождении он поднимает исключение с номером проверки:
-- транзакция обрывается, дальше ничего не выполняется. Прошло всё -
-- последней строкой будет NOTICE «db-smoke: все проверки пройдены».
--
-- Проверки заводят временного ученика (auth.users, кошелёк, заказ оплаты,
-- резерв и возврат) и откатывают его вместе со всем остальным. Единственный
-- след в базе - пропущенный номер заказа в последовательности
-- private.payment_orders.inv_id: identity не откатывается. Робокассе пропуски
-- номеров не мешают.
--
-- Что проверяется:
--   1. функции, без которых не идут деньги, существуют с нужной подписью;
--   2. кошелёк хранит копейки;
--   3. цена решения в базе совпадает с формулой src/lib/solutionPricing.ts;
--   4. права: гость не зовёт ничего денежного, ученик - серверного;
--   5. без входа резерв, возврат, сохранение решения и промокод отказывают;
--   6. оплата: заказ, неверная сумма, зачисление, повтор без второго зачисления;
--   7. резерв с подписанной ценой, неверная подпись, повтор, возврат, повтор
--      возврата, резерв по уже возвращённому ключу;
--   8. промокод-пустышка и require_admin для обычного ученика;
--   9. у временного ученика баланс сходится с историей операций.
-- Расхождения баланса у настоящих аккаунтов не валят проверку (админка знает
-- о старых тестовых аккаунтах), а выводятся NOTICE для сведения.
-- ===========================================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create temp table db_smoke_context (
  user_id uuid not null,
  reserve_key text not null
) on commit drop;

-- 1. Функции на месте.
do $$
declare
  signature text;
begin
  foreach signature in array array[
    'private.solution_price_kopecks_for(integer, integer, text)',
    'private.solution_price_proof(text, integer)',
    'public.sign_solution_price(text, integer)',
    'public.reserve_solution_credit_v2(text, integer, text, integer, text, text, text)',
    'public.refund_solution_credit(text, text)',
    'public.complete_homework_solution(text, text, text, text, text, text, integer, text, text, jsonb)',
    'public.create_payment_order(uuid, integer, boolean)',
    'public.confirm_payment_order(integer, integer, boolean, text, jsonb)',
    'private.credit_provider_top_up(uuid, integer, text)',
    'public.redeem_promo_code(text)',
    'private.require_admin(text)',
    'private.require_admin()'
  ] loop
    if to_regprocedure(signature) is null then
      raise exception 'db-smoke 1: нет функции %', signature;
    end if;
  end loop;
  -- Ценовую лестницу снесли 30 августа; её возвращение ломает сохранение решений.
  if to_regprocedure('private.solution_task_price(text, integer)') is not null then
    raise exception 'db-smoke 1: вернулась private.solution_task_price(text, integer) - см. AGENTS.md';
  end if;
  raise notice 'db-smoke 1: функции на месте';
end $$;

-- 2. Кошелёк в копейках.
do $$
begin
  if (select unit from private.wallet_currency_state) is distinct from 'kopeck' then
    raise exception 'db-smoke 2: private.wallet_currency_state.unit не kopeck';
  end if;
  raise notice 'db-smoke 2: кошелёк в копейках';
end $$;

-- 3. Цена - зеркало src/lib/solutionPricing.ts.
do $$
declare
  actual integer;
  expected integer;
  sample record;
begin
  for sample in
    select * from (values
      (0, 0, 'история', 400),
      (0, 0, 'математика', 500),
      (1000, 100, 'геометрия', 700),
      (400, 800000, 'литература', 600),
      (5000, 800000, 'физика', 1200)
    ) as samples(condition_length, image_bytes, subject, price)
  loop
    actual := private.solution_price_kopecks_for(sample.condition_length, sample.image_bytes, sample.subject);
    expected := sample.price;
    if actual is distinct from expected then
      raise exception 'db-smoke 3: цена (%, %, %) = %, ждали %',
        sample.condition_length, sample.image_bytes, sample.subject, actual, expected;
    end if;
  end loop;
  raise notice 'db-smoke 3: цена совпадает с формулой клиента';
end $$;

-- 4. Права на выполнение.
do $$
declare
  item record;
begin
  for item in
    select * from (values
      ('anon', 'public.reserve_solution_credit_v2(text, integer, text, integer, text, text, text)', false),
      ('anon', 'public.refund_solution_credit(text, text)', false),
      ('anon', 'public.redeem_promo_code(text)', false),
      ('anon', 'public.create_payment_order(uuid, integer, boolean)', false),
      ('anon', 'public.confirm_payment_order(integer, integer, boolean, text, jsonb)', false),
      ('anon', 'public.sign_solution_price(text, integer)', false),
      ('anon', 'private.require_admin(text)', false),
      ('authenticated', 'public.reserve_solution_credit_v2(text, integer, text, integer, text, text, text)', true),
      ('authenticated', 'public.refund_solution_credit(text, text)', true),
      ('authenticated', 'public.redeem_promo_code(text)', true),
      ('authenticated', 'public.create_payment_order(uuid, integer, boolean)', false),
      ('authenticated', 'public.confirm_payment_order(integer, integer, boolean, text, jsonb)', false),
      ('authenticated', 'public.sign_solution_price(text, integer)', false),
      ('authenticated', 'private.credit_provider_top_up(uuid, integer, text)', false),
      ('authenticated', 'private.require_admin(text)', false),
      ('service_role', 'public.confirm_payment_order(integer, integer, boolean, text, jsonb)', true),
      ('service_role', 'public.sign_solution_price(text, integer)', true)
    ) as grants(role_name, signature, allowed)
  loop
    if has_function_privilege(item.role_name, item.signature, 'execute') <> item.allowed then
      raise exception 'db-smoke 4: у % право на % = %, ждали %',
        item.role_name, item.signature, not item.allowed, item.allowed;
    end if;
  end loop;
  raise notice 'db-smoke 4: права на выполнение верны';
end $$;

-- 5. Без входа денежные функции отказывают.
do $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);

  begin
    perform public.reserve_solution_credit_v2('db-smoke-anonymous', 500, 'x');
    raise exception 'db-smoke 5: reserve_solution_credit_v2 пустил без входа';
  exception when sqlstate '28000' then null;
  end;

  begin
    perform public.refund_solution_credit('db-smoke-anonymous');
    raise exception 'db-smoke 5: refund_solution_credit пустил без входа';
  exception when sqlstate '28000' then null;
  end;

  begin
    perform public.complete_homework_solution('db-smoke', '1', 'text', 'db-smoke-anonymous', 'db-smoke', '', null, 'x', 'x', null);
    raise exception 'db-smoke 5: complete_homework_solution пустил без входа';
  exception when sqlstate '28000' then null;
  end;

  begin
    perform public.redeem_promo_code('DB-SMOKE');
    raise exception 'db-smoke 5: redeem_promo_code пустил без входа';
  exception when sqlstate '28000' then null;
  end;

  begin
    perform private.require_admin();
    raise exception 'db-smoke 5: require_admin пустил без входа';
  exception when sqlstate '42501' then null;
  end;

  raise notice 'db-smoke 5: без входа отказ';
end $$;

-- Временный ученик. Триггеры auth.users заводят профиль, кошелёк и контроль.
do $$
declare
  new_user_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', new_user_id, 'authenticated', 'authenticated',
    'db-smoke-' || new_user_id || '@example.invalid', '',
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  );

  if not exists (select 1 from public.wallet_accounts where user_id = new_user_id) then
    raise exception 'db-smoke 6: у нового аккаунта нет кошелька';
  end if;
  if not exists (select 1 from public.profiles where id = new_user_id) then
    raise exception 'db-smoke 6: у нового аккаунта нет профиля';
  end if;

  insert into db_smoke_context (user_id, reserve_key) values (new_user_id, 'db-smoke-' || new_user_id);
  perform set_config('request.jwt.claims',
    json_build_object('sub', new_user_id, 'role', 'authenticated', 'aal', 'aal1')::text, true);
end $$;

-- 6. Оплата: заказ, неверная сумма, зачисление, повтор.
do $$
declare
  ctx db_smoke_context%rowtype;
  order_result jsonb;
  confirm_result jsonb;
  inv integer;
  before_balance integer;
  after_balance integer;
begin
  select * into ctx from db_smoke_context;
  select balance into before_balance from public.wallet_accounts where user_id = ctx.user_id;

  begin
    perform public.create_payment_order(ctx.user_id, 4900, false);
    raise exception 'db-smoke 6: заказ на 49 ₽ принят';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.create_payment_order(ctx.user_id, 5000, true);
    raise exception 'db-smoke 6: тестовый заказ у ученика принят';
  exception when sqlstate '42501' then null;
  end;

  order_result := public.create_payment_order(ctx.user_id, 5000, false);
  inv := (order_result ->> 'invId')::integer;
  if inv is null then
    raise exception 'db-smoke 6: create_payment_order не вернул invId: %', order_result;
  end if;

  begin
    perform public.confirm_payment_order(inv, 4000, false, 'result', '{}'::jsonb);
    raise exception 'db-smoke 6: подтверждена неверная сумма';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.confirm_payment_order(inv, 5000, true, 'result', '{}'::jsonb);
    raise exception 'db-smoke 6: подтверждён чужой режим';
  exception when sqlstate '22023' then null;
  end;

  confirm_result := public.confirm_payment_order(inv, 5000, false, 'result', '{}'::jsonb);
  if (confirm_result ->> 'applied')::boolean is not true then
    raise exception 'db-smoke 6: оплата не зачислена: %', confirm_result;
  end if;
  select balance into after_balance from public.wallet_accounts where user_id = ctx.user_id;
  if after_balance <> before_balance + 5000 then
    raise exception 'db-smoke 6: баланс % после оплаты 5000 при исходном %', after_balance, before_balance;
  end if;

  confirm_result := public.confirm_payment_order(inv, 5000, false, 'reconcile', '{}'::jsonb);
  if (confirm_result ->> 'applied')::boolean is not false then
    raise exception 'db-smoke 6: повторное подтверждение зачислило ещё раз: %', confirm_result;
  end if;
  select balance into after_balance from public.wallet_accounts where user_id = ctx.user_id;
  if after_balance <> before_balance + 5000 then
    raise exception 'db-smoke 6: баланс изменился на повторе: %', after_balance;
  end if;

  raise notice 'db-smoke 6: оплата зачисляется ровно один раз';
end $$;

-- 7. Резерв, возврат, повторы.
do $$
declare
  ctx db_smoke_context%rowtype;
  proof text;
  result jsonb;
  start_balance integer;
  current_balance integer;
begin
  select * into ctx from db_smoke_context;
  select balance into start_balance from public.wallet_accounts where user_id = ctx.user_id;
  proof := private.solution_price_proof(ctx.reserve_key, 500);

  begin
    perform public.reserve_solution_credit_v2(ctx.reserve_key, 500, 'forged', null, null, 'text', 'db-smoke');
    raise exception 'db-smoke 7: резерв с чужой подписью принят';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.reserve_solution_credit_v2(ctx.reserve_key, 300, private.solution_price_proof(ctx.reserve_key, 300), null, null, 'text', 'db-smoke');
    raise exception 'db-smoke 7: резерв на 3 ₽ принят';
  exception when sqlstate '22023' then null;
  end;

  result := public.reserve_solution_credit_v2(ctx.reserve_key, 500, proof, null, null, 'text', 'db-smoke');
  if (result ->> 'reserved')::boolean is not true then
    raise exception 'db-smoke 7: резерв не прошёл: %', result;
  end if;
  select balance into current_balance from public.wallet_accounts where user_id = ctx.user_id;
  if current_balance <> start_balance - 500 then
    raise exception 'db-smoke 7: после резерва баланс %, ждали %', current_balance, start_balance - 500;
  end if;

  result := public.reserve_solution_credit_v2(ctx.reserve_key, 500, proof, null, null, 'text', 'db-smoke');
  if (result ->> 'alreadyReserved')::boolean is not true then
    raise exception 'db-smoke 7: повтор резерва не распознан: %', result;
  end if;
  select balance into current_balance from public.wallet_accounts where user_id = ctx.user_id;
  if current_balance <> start_balance - 500 then
    raise exception 'db-smoke 7: повтор резерва списал ещё раз: %', current_balance;
  end if;

  result := public.refund_solution_credit(ctx.reserve_key, 'db-smoke');
  if (result ->> 'refunded')::boolean is not true then
    raise exception 'db-smoke 7: возврат не прошёл: %', result;
  end if;

  result := public.refund_solution_credit(ctx.reserve_key, 'db-smoke');
  if (result ->> 'refunded')::boolean is not false then
    raise exception 'db-smoke 7: повторный возврат вернул деньги ещё раз: %', result;
  end if;
  select balance into current_balance from public.wallet_accounts where user_id = ctx.user_id;
  if current_balance <> start_balance then
    raise exception 'db-smoke 7: после возврата баланс %, ждали %', current_balance, start_balance;
  end if;

  begin
    perform public.reserve_solution_credit_v2(ctx.reserve_key, 500, proof, null, null, 'text', 'db-smoke');
    raise exception 'db-smoke 7: резерв по возвращённому ключу принят';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'reservation refunded' then
      raise;
    end if;
  end;

  raise notice 'db-smoke 7: резерв и возврат идемпотентны';
end $$;

-- 8. Промокод-пустышка и админ-доступ обычного ученика.
do $$
declare
  result jsonb;
begin
  result := public.redeem_promo_code('DB-SMOKE-NO-SUCH-CODE');
  if (result ->> 'ok')::boolean is not false then
    raise exception 'db-smoke 8: несуществующий промокод принят: %', result;
  end if;

  begin
    perform private.require_admin('support');
    raise exception 'db-smoke 8: require_admin пустил обычного ученика';
  exception when sqlstate '42501' then null;
  end;

  raise notice 'db-smoke 8: промокод и админ-доступ отказывают';
end $$;

-- 9. Баланс временного ученика сходится с историей.
do $$
declare
  ctx db_smoke_context%rowtype;
  wallet_balance integer;
  entries_total bigint;
  mismatched integer;
begin
  select * into ctx from db_smoke_context;
  select balance into wallet_balance from public.wallet_accounts where user_id = ctx.user_id;
  select coalesce(sum(amount), 0) into entries_total from public.wallet_entries where user_id = ctx.user_id;
  if wallet_balance <> entries_total then
    raise exception 'db-smoke 9: баланс % не сходится с операциями %', wallet_balance, entries_total;
  end if;

  select count(*) into mismatched
  from public.wallet_accounts w
  where w.balance <> (select coalesce(sum(e.amount), 0) from public.wallet_entries e where e.user_id = w.user_id);
  if mismatched > 0 then
    raise notice 'db-smoke 9: у % настоящих аккаунтов баланс не сходится с операциями - см. админку, «Финансы»', mismatched;
  end if;

  raise notice 'db-smoke: все проверки пройдены';
end $$;

rollback;
