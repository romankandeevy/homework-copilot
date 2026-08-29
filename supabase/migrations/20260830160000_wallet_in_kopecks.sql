-- ===========================================================================
-- Перевод всего денежного учёта из целых рублей в целые копейки.
--
-- Зачем: планируемый ИИ-чат списывает фактическую стоимость вызова API с
-- наценкой 30%. В рублях такую сумму нельзя выразить без потери точности,
-- поэтому единицей хранения становится копейка. Внешние сигнатуры RPC и
-- формат возвращаемого JSON НЕ меняются — их вызывает работающий фронтенд.
--
-- ЭТО ЖИВЫЕ ДЕНЬГИ. Файл рассчитан на применение ОДНОЙ транзакцией.
-- Рекомендуемый способ:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f <файл>
-- либо один прогон в SQL-редакторе Supabase.
-- Явные begin/commit ниже гарантируют «либо всё, либо ничего» даже при
-- ручном применении. Если файл прогоняется через `supabase db push`, который
-- уже открывает собственную транзакцию, Postgres выдаст безвредный
-- WARNING «there is already a transaction in progress»; commit в конце файла
-- закроет ту же самую транзакцию.
--
-- Что переводится в копейки:
--   * public.wallet_accounts.balance              (данные + default)
--   * public.wallet_entries.amount                (данные)
--   * public.referral_invites.referrer_reward_amount / invitee_reward_amount
--     (данные + default + CHECK, который жёстко фиксировал 10 и 5)
--   * private.verified_balance_top_ups.amount     (данные + CHECK)
--   * private.support_feature_credits.amount      (данные)
--   * все функции, оперирующие суммами (см. блоки 5–15)
--
-- Что НЕ переводится и почему — блок 16.
-- Обратная миграция: supabase/migrations/ROLLBACK_wallet_in_kopecks.sql
-- Проверочные запросы:   docs/kopecks-verification.sql
--
-- ПРИЗНАК ИДЕМПОТЕНТНОСТИ: таблица-одиночка private.wallet_currency_state
-- с полем unit ('ruble' | 'kopeck'). Умножение данных на 100 выполняется
-- ТОЛЬКО когда unit = 'ruble', и в той же транзакции переводит unit в
-- 'kopeck'. Эвристики («все суммы кратны 100») сознательно не используются:
-- до конвертации все суммы кратны 1, после первого же списания за ИИ-чат
-- появятся некратные 100 значения, и эвристика начнёт врать в обе стороны.
-- Переопределения функций (create or replace) идемпотентны по своей природе
-- и выполняются при каждом прогоне.
-- ===========================================================================

begin;

-- Не держим сайт: если денежные таблицы заняты, лучше упасть и откатиться,
-- чем встать в очередь и заблокировать покупки пользователей.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- Блок 1. Признак применённости: единица измерения денежного учёта.
-- Одна строка, id всегда true. Создаётся до всего остального, чтобы повторный
-- прогон миграции мог отличить «ещё рубли» от «уже копейки».
-- ---------------------------------------------------------------------------

create table if not exists private.wallet_currency_state (
  id boolean primary key default true,
  unit text not null,
  converted_at timestamptz,
  accounts_rows bigint,
  accounts_sum_before bigint,
  accounts_sum_after bigint,
  entries_rows bigint,
  entries_sum_before bigint,
  entries_sum_after bigint,
  constraint wallet_currency_state_singleton check (id),
  constraint wallet_currency_state_unit check (unit in ('ruble', 'kopeck'))
);

comment on table private.wallet_currency_state is
  'Единица хранения денежных сумм. Признак идемпотентности миграции 20260830160000_wallet_in_kopecks.';

-- Первый прогон на базе, где ещё рубли: заводим исходное состояние.
insert into private.wallet_currency_state (id, unit)
values (true, 'ruble')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Блок 2. Блокировка денежных таблиц на время конвертации.
-- EXCLUSIVE пропускает обычные SELECT, но останавливает любые UPDATE/INSERT
-- из spend_solution_credit / reserve_solution_credit / handle_new_user, чтобы
-- параллельная покупка не попала «наполовину в рубли, наполовину в копейки».
-- ---------------------------------------------------------------------------

lock table
  public.wallet_accounts,
  public.wallet_entries,
  public.referral_invites,
  private.verified_balance_top_ups,
  private.support_feature_credits
in exclusive mode;

-- ---------------------------------------------------------------------------
-- Блок 3. Контрольные суммы ДО конвертации во временные таблицы.
-- Снимаем не только итоги, но и построчный снимок: совпадение общей суммы
-- не доказывает, что у каждого пользователя баланс не поехал.
-- on commit drop — временные таблицы исчезнут вместе с транзакцией.
-- ---------------------------------------------------------------------------

create temporary table wallet_kopeck_accounts_before on commit drop as
select user_id, balance from public.wallet_accounts;

create temporary table wallet_kopeck_entries_before on commit drop as
select id, amount from public.wallet_entries;

create temporary table wallet_kopeck_totals_before on commit drop as
select
  (select count(*) from public.wallet_accounts)                                as accounts_rows,
  (select coalesce(sum(balance), 0)::bigint from public.wallet_accounts)       as accounts_sum,
  (select count(*) from public.wallet_entries)                                 as entries_rows,
  (select coalesce(sum(amount), 0)::bigint from public.wallet_entries)         as entries_sum,
  (select count(*) from public.referral_invites)                               as referral_rows,
  (select coalesce(sum(referrer_reward_amount), 0)::bigint
     from public.referral_invites)                                             as referral_referrer_sum,
  (select coalesce(sum(invitee_reward_amount), 0)::bigint
     from public.referral_invites)                                             as referral_invitee_sum,
  (select count(*) from private.verified_balance_top_ups)                      as top_up_rows,
  (select coalesce(sum(amount), 0)::bigint from private.verified_balance_top_ups) as top_up_sum,
  (select count(*) from private.support_feature_credits)                       as feature_credit_rows,
  (select coalesce(sum(amount), 0)::bigint from private.support_feature_credits) as feature_credit_sum;

-- Отметка «конвертировали ли мы данные именно в этом прогоне».
-- Нужна блоку 17: при повторном применении сверять надо не «×100»,
-- а «ничего не изменилось».
create temporary table wallet_kopeck_run (converted boolean not null) on commit drop;

-- ---------------------------------------------------------------------------
-- Блок 4. Конвертация данных ×100 под флагом идемпотентности.
-- Всё, что здесь падает, откатывает транзакцию целиком.
-- ---------------------------------------------------------------------------

do $conversion$
declare
  current_unit text;
  -- integer выдерживает 2 147 483 647 копеек = 21 474 836,47 ₽ на счёт.
  -- Ниже — предохранитель на случай, если где-то уже лежит слишком крупная сумма.
  max_rubles constant integer := 21474836;
begin
  select unit into current_unit from private.wallet_currency_state where id;

  if current_unit = 'kopeck' then
    raise notice 'wallet: конвертация в копейки уже применена, данные не трогаем';
    insert into pg_temp.wallet_kopeck_run (converted) values (false);
    return;
  end if;

  -- Предохранитель от переполнения integer при умножении на 100.
  if exists (
    select 1 from public.wallet_accounts where abs(balance) > max_rubles
  ) or exists (
    select 1 from public.wallet_entries where abs(amount) > max_rubles
  ) or exists (
    select 1 from private.verified_balance_top_ups where abs(amount) > max_rubles
  ) or exists (
    select 1 from private.support_feature_credits where abs(amount) > max_rubles
  ) then
    raise exception 'wallet: найдена сумма, которая при умножении на 100 переполнит integer';
  end if;

  -- 4.1 Кошельки и журнал операций.
  update public.wallet_accounts set balance = balance * 100;
  update public.wallet_entries  set amount  = amount  * 100;

  -- 4.2 Реферальные награды. CHECK жёстко фиксировал 10 и 5 рублей,
  -- поэтому его надо снять до UPDATE и вернуть уже в копейках.
  alter table public.referral_invites
    drop constraint if exists referral_invites_referrer_reward_amount_check,
    drop constraint if exists referral_invites_invitee_reward_amount_check;

  update public.referral_invites
  set referrer_reward_amount = referrer_reward_amount * 100,
      invitee_reward_amount  = invitee_reward_amount  * 100;

  alter table public.referral_invites
    alter column referrer_reward_amount set default 1000,
    alter column invitee_reward_amount  set default 500;

  alter table public.referral_invites
    add constraint referral_invites_referrer_reward_amount_check
      check (referrer_reward_amount = 1000),
    add constraint referral_invites_invitee_reward_amount_check
      check (invitee_reward_amount = 500);

  -- 4.3 История подтверждённых пополнений. Границы CHECK были 1..1 000 000 ₽;
  -- в копейках нижняя граница опускается до 1 копейки, верхняя — до 1 000 000 ₽.
  alter table private.verified_balance_top_ups
    drop constraint if exists verified_balance_top_ups_amount_check;

  update private.verified_balance_top_ups set amount = amount * 100;

  alter table private.verified_balance_top_ups
    add constraint verified_balance_top_ups_amount_check
      check (amount >= 1 and amount <= 100000000);

  -- 4.4 Награды за принятые идеи. CHECK там только «amount > 0» —
  -- знак при умножении сохраняется, снимать ограничение не нужно.
  update private.support_feature_credits set amount = amount * 100;

  -- 4.5 Приветственный баланс нового пользователя: 20 ₽ = 2000 копеек.
  alter table public.wallet_accounts alter column balance set default 2000;

  -- 4.6 Переводим признак. Дальше повторный прогон данные уже не тронет.
  update private.wallet_currency_state
  set unit = 'kopeck',
      converted_at = now(),
      accounts_rows = (select accounts_rows from pg_temp.wallet_kopeck_totals_before),
      accounts_sum_before = (select accounts_sum from pg_temp.wallet_kopeck_totals_before),
      accounts_sum_after = (select coalesce(sum(balance), 0)::bigint from public.wallet_accounts),
      entries_rows = (select entries_rows from pg_temp.wallet_kopeck_totals_before),
      entries_sum_before = (select entries_sum from pg_temp.wallet_kopeck_totals_before),
      entries_sum_after = (select coalesce(sum(amount), 0)::bigint from public.wallet_entries)
  where id;

  insert into pg_temp.wallet_kopeck_run (converted) values (true);
end;
$conversion$;

-- ---------------------------------------------------------------------------
-- Блок 5. Форматирование копеек для человекочитаемых описаний операций.
-- Целые рубли печатаются без дробной части («15 ₽»), копейки — с запятой
-- («0,37 ₽»), чтобы описания в истории баланса и сообщения поддержки
-- выглядели как раньше и были готовы к посекундной тарификации ИИ-чата.
-- ---------------------------------------------------------------------------

create or replace function private.format_kopecks(p_amount integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_amount is null then '0 ₽'
    when p_amount % 100 = 0 then (p_amount / 100)::text || ' ₽'
    else replace(to_char(p_amount::numeric / 100, 'FM9999999990.00'), '.', ',') || ' ₽'
  end;
$$;

comment on function private.format_kopecks(integer) is
  'Печатает сумму в копейках как рублёвую строку для описаний операций.';

-- ---------------------------------------------------------------------------
-- Блок 6. Цена решения задачи. Было 5/10/15 ₽ — стало 500/1000/1500 копеек.
-- Тип возврата и сигнатура прежние; меняются только числа.
-- ---------------------------------------------------------------------------

create or replace function private.solution_task_price(p_textbook_id text, p_task_number integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $function$
declare
  chapter_length integer;
  position_in_chapter integer;
begin
  if p_task_number is null or p_task_number not between 1 and 9999 then
    raise exception 'invalid task number' using errcode = '22023';
  end if;

  chapter_length := case p_textbook_id
    when 'geometry' then 60
    when 'physics' then 45
    when 'chemistry' then 45
    else 40
  end;
  position_in_chapter := mod(p_task_number - 1, chapter_length);

  -- 500 / 1000 / 1500 копеек = прежние 5 / 10 / 15 ₽.
  if position_in_chapter < ceil(chapter_length / 3.0) then return 500; end if;
  if position_in_chapter < ceil(chapter_length * 2 / 3.0) then return 1000; end if;
  return 1500;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Блок 7. Приветственный баланс при регистрации: 20 ₽ = 2000 копеек.
-- Текст записи в истории остаётся рублёвым — его читает пользователь.
-- ---------------------------------------------------------------------------

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  profile_name text;
  profile_grade smallint;
begin
  profile_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'Ученик');
  profile_name := left(profile_name, 80);

  if coalesce(new.raw_user_meta_data ->> 'grade', '') ~ '^[1-9]$|^1[01]$' then
    profile_grade := (new.raw_user_meta_data ->> 'grade')::smallint;
  else
    profile_grade := 8;
  end if;

  insert into public.profiles (id, full_name, grade)
  values (new.id, profile_name, profile_grade);

  insert into public.wallet_accounts (user_id, balance)
  values (new.id, 2000);

  insert into public.wallet_entries (user_id, amount, kind, description, idempotency_key)
  values (new.id, 2000, 'credit', 'Стартовые 20 ₽', 'welcome-credit');

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Блок 8. Списание за решение. Цена по фото 15 ₽ = 1500 копеек.
-- Возвращаемый integer — остаток баланса, теперь в копейках. Сигнатура прежняя.
-- ---------------------------------------------------------------------------

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

  if p_source not in ('number', 'photo') then
    raise exception 'invalid solution source' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.wallet_entries
    where user_id = current_user_id and idempotency_key = p_idempotency_key
  ) then
    select balance into resulting_balance
    from public.wallet_accounts where user_id = current_user_id;
    return resulting_balance;
  end if;

  solution_price := case
    when p_source = 'photo' then 1500
    else private.solution_task_price(p_textbook_id, p_task_number)
  end;

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

-- ---------------------------------------------------------------------------
-- Блок 9. Резерв оплаты до вызова модели (уже на проде, миграция 20260830120000).
-- Цена по фото 15 ₽ = 1500 копеек. Ключи JSON ('balance', 'reserved',
-- 'alreadyReserved', 'price') не меняются — их читает server/homeworkSolver.ts.
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

  if p_source not in ('number', 'photo') then
    raise exception 'invalid solution source' using errcode = '22023';
  end if;

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
    when p_source = 'photo' then 1500
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
  when unique_violation then
    select balance into resulting_balance
    from public.wallet_accounts
    where user_id = current_user_id;

    return jsonb_build_object('balance', resulting_balance, 'reserved', false, 'alreadyReserved', true);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Блок 10. Возврат резерва (тоже уже на проде, миграция 20260830120000).
-- Функция не содержит числовых литералов: она возвращает ровно ту сумму,
-- которая лежит в зарезервированной записи, поэтому единица измерения ей
-- безразлична. Переиздаём без изменений, чтобы файл описывал полное
-- состояние денежного контура после миграции.
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
$function$;

-- ---------------------------------------------------------------------------
-- Блок 11. Выдача решения и списание. Меняются два места:
--   * цена решения по фото 15 ₽ -> 1500 копеек;
--   * описание операции печатается через private.format_kopecks, иначе
--     в истории баланса появилось бы «Решение задачи № 12 · 500 ₽».
-- Вся остальная логика (проверки, идемпотентность, публикация решения)
-- перенесена без изменений.
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
  p_solution jsonb default null
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
    or char_length(coalesce(p_source_url, '')) not between 1 and 500
    or p_source not in ('number', 'photo')
    or (p_source = 'number' and (
      p_task !~ '^[0-9]{1,4}$'
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

    if exists (
      select 1 from public.wallet_entries
      where user_id = current_user_id and idempotency_key = p_idempotency_key
    ) then
      raise exception 'idempotency key already used' using errcode = '22023';
    end if;

    solution_price := private.solution_task_price(p_textbook_id, p_task::integer);
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
    select * into stored_solution
    from public.homework_solutions
    where textbook_id = p_textbook_id
      and textbook_edition = p_edition
      and source_url = p_source_url
      and task = p_task
      and source = 'photo'
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

  if exists (
    select 1 from public.wallet_entries
    where user_id = current_user_id and idempotency_key = p_idempotency_key
  ) then
    raise exception 'idempotency key already used' using errcode = '22023';
  end if;

  if (stored_solution.id is null or not private.homework_solution_payload_is_current(stored_solution.solution))
    and not private.homework_solution_payload_is_valid(
      p_solution, p_textbook_id, p_task, p_source, p_edition,
      p_source_url, p_source_page, p_condition_normalized
    ) then
    raise exception 'invalid verified homework solution' using errcode = '22023';
  end if;

  solution_price := case
    when p_source = 'photo' then 1500
    else private.solution_task_price(p_textbook_id, p_task::integer)
  end;
  description := case
    when p_source = 'photo' then 'Решение задачи по фото · ' || private.format_kopecks(solution_price)
    else 'Решение задачи № ' || p_task || ' · ' || private.format_kopecks(solution_price)
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

-- ---------------------------------------------------------------------------
-- Блок 12. Ручная корректировка баланса из админки.
-- p_amount теперь приходит в копейках, поэтому предел ±100 000 ₽ становится
-- ±10 000 000 копеек. Сигнатура (uuid, integer, text) и ключи возвращаемого
-- JSON ('userId', 'amount', 'balance') не меняются.
-- ---------------------------------------------------------------------------

create or replace function public.admin_adjust_balance(p_user_id uuid, p_amount integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := private.require_admin();
  current_balance integer;
  resulting_balance integer;
  normalized_reason text := trim(coalesce(p_reason, ''));
begin
  if p_amount is null or p_amount = 0 or abs(p_amount) > 10000000 then
    raise exception 'balance adjustment must be between -100000 and 100000, excluding 0'
      using errcode = '22023';
  end if;

  if char_length(normalized_reason) not between 3 and 160 then
    raise exception 'adjustment reason must contain 3 to 160 characters' using errcode = '22023';
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'user not found' using errcode = 'P0002';
  end if;

  select balance into current_balance
  from public.wallet_accounts
  where user_id = p_user_id
  for update;

  if current_balance is null then
    raise exception 'wallet not found' using errcode = 'P0002';
  end if;

  resulting_balance := current_balance + p_amount;
  if resulting_balance < 0 then
    raise exception 'balance cannot become negative' using errcode = '22023';
  end if;

  update public.wallet_accounts
  set balance = resulting_balance,
      updated_at = now()
  where user_id = p_user_id;

  insert into public.wallet_entries (user_id, amount, kind, description, idempotency_key)
  values (
    p_user_id,
    p_amount,
    case when p_amount > 0 then 'credit' else 'debit' end,
    normalized_reason,
    'admin:' || gen_random_uuid()::text
  );

  insert into private.admin_audit_log (actor_id, target_user_id, event_type, payload)
  values (
    actor_id,
    p_user_id,
    'balance_adjusted',
    jsonb_build_object(
      'amount', p_amount,
      'reason', normalized_reason,
      'balanceAfter', resulting_balance
    )
  );

  return jsonb_build_object(
    'userId', p_user_id,
    'amount', p_amount,
    'balance', resulting_balance
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Блок 13. Подтверждение пополнения и реферальные бонусы.
-- p_amount теперь в копейках: прежний предел 1..1 000 000 ₽ превращается
-- в 1..100 000 000 копеек (нижняя граница опускается до копейки).
-- Реферальные суммы в ответе и в аудите: 10 ₽ -> 1000, 5 ₽ -> 500.
-- Сами начисления берутся из колонок referral_invites, которые блок 4
-- уже перевёл в копейки.
-- ---------------------------------------------------------------------------

create or replace function public.admin_record_verified_top_up(
  p_user_id uuid,
  p_amount integer,
  p_provider_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := private.require_admin();
  normalized_reference text := lower(trim(coalesce(p_provider_reference, '')));
  existing_top_up private.verified_balance_top_ups%rowtype;
  referral public.referral_invites%rowtype;
  top_up_id uuid := gen_random_uuid();
  top_up_entry_id uuid;
  referrer_entry_id uuid;
  invitee_entry_id uuid;
  current_balance integer;
  invitee_balance integer;
  referrer_balance integer;
  first_top_up boolean;
  referral_rewarded boolean := false;
begin
  if p_amount is null or p_amount not between 1 and 100000000 then
    raise exception 'top up amount must be between 1 and 1000000' using errcode = '22023';
  end if;

  if char_length(normalized_reference) not between 6 and 160
    or normalized_reference !~ '^[a-z0-9][a-z0-9._:/-]*$' then
    raise exception 'invalid provider reference' using errcode = '22023';
  end if;

  select * into existing_top_up
  from private.verified_balance_top_ups
  where provider_reference = normalized_reference;

  if found then
    if existing_top_up.user_id <> p_user_id or existing_top_up.amount <> p_amount then
      raise exception 'provider reference conflict' using errcode = '23505';
    end if;

    select balance into current_balance
    from public.wallet_accounts
    where user_id = p_user_id;

    return jsonb_build_object(
      'applied', false,
      'amount', existing_top_up.amount,
      'balance', current_balance,
      'referralRewarded', exists (
        select 1 from public.referral_invites
        where qualifying_top_up_id = existing_top_up.id and status = 'rewarded'
      ),
      'referrerRewardAmount', 1000,
      'inviteeRewardAmount', 500
    );
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'user not found' using errcode = 'P0002';
  end if;

  select balance into current_balance
  from public.wallet_accounts
  where user_id = p_user_id
  for update;

  if current_balance is null then
    raise exception 'wallet not found' using errcode = 'P0002';
  end if;

  first_top_up := not exists (
    select 1 from private.verified_balance_top_ups
    where user_id = p_user_id
  );

  update public.wallet_accounts
  set balance = current_balance + p_amount,
      updated_at = now()
  where user_id = p_user_id
  returning balance into invitee_balance;

  insert into public.wallet_entries (
    user_id,
    amount,
    kind,
    description,
    idempotency_key
  ) values (
    p_user_id,
    p_amount,
    'credit',
    'Пополнение баланса',
    'verified-top-up:' || md5(normalized_reference)
  )
  returning id into top_up_entry_id;

  insert into private.verified_balance_top_ups (
    id,
    user_id,
    actor_id,
    provider_reference,
    amount,
    wallet_entry_id,
    source
  ) values (
    top_up_id,
    p_user_id,
    actor_id,
    normalized_reference,
    p_amount,
    top_up_entry_id,
    'admin'
  );

  if first_top_up then
    select * into referral
    from public.referral_invites
    where invitee_user_id = p_user_id
      and status = 'pending'
    for update;

    if found then
      select balance into referrer_balance
      from public.wallet_accounts
      where user_id = referral.referrer_user_id
      for update;

      if referrer_balance is null then
        raise exception 'referrer wallet not found' using errcode = 'P0002';
      end if;

      update public.wallet_accounts
      set balance = balance + referral.referrer_reward_amount,
          updated_at = now()
      where user_id = referral.referrer_user_id
      returning balance into referrer_balance;

      insert into public.wallet_entries (
        user_id,
        amount,
        kind,
        description,
        idempotency_key
      ) values (
        referral.referrer_user_id,
        referral.referrer_reward_amount,
        'credit',
        'Бонус за приглашённого друга',
        'referral-referrer:' || referral.id::text
      )
      returning id into referrer_entry_id;

      update public.wallet_accounts
      set balance = balance + referral.invitee_reward_amount,
          updated_at = now()
      where user_id = referral.invitee_user_id
      returning balance into invitee_balance;

      insert into public.wallet_entries (
        user_id,
        amount,
        kind,
        description,
        idempotency_key
      ) values (
        referral.invitee_user_id,
        referral.invitee_reward_amount,
        'credit',
        'Бонус за регистрацию по приглашению',
        'referral-invitee:' || referral.id::text
      )
      returning id into invitee_entry_id;

      update public.referral_invites
      set status = 'rewarded',
          qualifying_top_up_id = top_up_id,
          referrer_wallet_entry_id = referrer_entry_id,
          invitee_wallet_entry_id = invitee_entry_id,
          rewarded_at = now()
      where id = referral.id;

      referral_rewarded := true;
    end if;
  end if;

  insert into private.admin_audit_log (actor_id, target_user_id, event_type, payload)
  values (
    actor_id,
    p_user_id,
    'balance_adjusted',
    jsonb_build_object(
      'kind', 'verified_top_up',
      'amount', p_amount,
      'balanceAfter', invitee_balance,
      'providerReference', normalized_reference,
      'referralRewarded', referral_rewarded,
      'referrerRewardAmount', case when referral_rewarded then 1000 else 0 end,
      'inviteeRewardAmount', case when referral_rewarded then 500 else 0 end
    )
  );

  return jsonb_build_object(
    'applied', true,
    'amount', p_amount,
    'balance', invitee_balance,
    'referralRewarded', referral_rewarded,
    'referrerRewardAmount', case when referral_rewarded then 1000 else 0 end,
    'inviteeRewardAmount', case when referral_rewarded then 500 else 0 end,
    'referrerBalance', case when referral_rewarded then referrer_balance else null end
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Блок 14. Реферальная витрина пользователя.
-- Здесь были зашиты рублёвые 10 и 5; earnedAmount считается по колонке,
-- которую блок 4 уже перевёл в копейки. Ключи JSON не меняются.
-- ---------------------------------------------------------------------------

create or replace function public.get_my_referral()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_user_id uuid := (select auth.uid());
  own_code text;
  candidate text;
  invited_count integer;
  pending_count integer;
  rewarded_count integer;
  earned_amount integer;
  joined_status text;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  perform private.assert_account_not_banned(current_user_id);

  select code into own_code
  from public.referral_codes
  where user_id = current_user_id;

  if own_code is null then
    for attempt_counter in 1..12 loop
      candidate := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
      begin
        insert into public.referral_codes (user_id, code)
        values (current_user_id, candidate)
        on conflict (user_id) do nothing;
      exception when unique_violation then
        null;
      end;

      select code into own_code
      from public.referral_codes
      where user_id = current_user_id;

      exit when own_code is not null or attempt_counter = 12;
    end loop;
  end if;

  if own_code is null then
    raise exception 'could not create referral code' using errcode = 'P0001';
  end if;

  select
    count(*)::integer,
    count(*) filter (where status = 'pending')::integer,
    count(*) filter (where status = 'rewarded')::integer,
    coalesce(sum(referrer_reward_amount) filter (where status = 'rewarded'), 0)::integer
  into invited_count, pending_count, rewarded_count, earned_amount
  from public.referral_invites
  where referrer_user_id = current_user_id;

  select status into joined_status
  from public.referral_invites
  where invitee_user_id = current_user_id;

  return jsonb_build_object(
    'code', own_code,
    'invitedCount', invited_count,
    'pendingCount', pending_count,
    'rewardedCount', rewarded_count,
    'earnedAmount', earned_amount,
    'joinedViaReferral', joined_status is not null,
    'joinedRewardStatus', joined_status,
    'referrerRewardAmount', 1000,
    'inviteeRewardAmount', 500
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Блок 15. Награда за принятую идею.
-- p_amount теперь в копейках: прежний предел 1..10 000 ₽ становится
-- 1..1 000 000 копеек. Автосообщение в диалоге печатается через
-- private.format_kopecks, чтобы пользователь по-прежнему видел рубли.
-- ---------------------------------------------------------------------------

create or replace function public.admin_credit_feature_balance(
  p_conversation_id uuid,
  p_amount integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := private.require_admin();
  conversation public.support_conversations%rowtype;
  current_balance integer;
  resulting_balance integer;
  normalized_reason text := trim(coalesce(p_reason, ''));
  wallet_entry public.wallet_entries%rowtype;
  existing_credit private.support_feature_credits%rowtype;
  rejection private.support_idea_decisions%rowtype;
  approval_message_id uuid;
begin
  if p_amount is null or p_amount < 1 or p_amount > 1000000 then
    raise exception 'feature credit must be between 1 and 10000' using errcode = '22023';
  end if;
  if char_length(normalized_reason) not between 3 and 160 then
    raise exception 'feature credit reason must contain 3 to 160 characters' using errcode = '22023';
  end if;

  select * into conversation
  from public.support_conversations
  where id = p_conversation_id
  for update;

  if not found then
    raise exception 'support conversation not found' using errcode = 'P0002';
  end if;
  if conversation.category <> 'feature' then
    raise exception 'balance credit is only available for feature ideas' using errcode = '22023';
  end if;

  select * into existing_credit
  from private.support_feature_credits
  where conversation_id = p_conversation_id;
  if found then
    select balance into resulting_balance
    from public.wallet_accounts
    where user_id = conversation.user_id;
    return jsonb_build_object(
      'conversationId', p_conversation_id,
      'credited', false,
      'amount', existing_credit.amount,
      'balance', resulting_balance,
      'reason', existing_credit.reason
    );
  end if;

  select * into rejection
  from private.support_idea_decisions
  where conversation_id = p_conversation_id
    and decision = 'rejected';
  if found then
    raise exception 'idea reward is unavailable because the idea was rejected' using errcode = 'P0001';
  end if;

  select message.id into approval_message_id
  from public.support_messages message
  where message.conversation_id = p_conversation_id
    and message.author_type = 'owner'
    and private.normalize_support_idea_approval(message.body) = 'да это хорошая идея'
  order by message.created_at asc
  limit 1;

  if approval_message_id is null then
    raise exception 'owner approval required: reply exactly "да это хорошая идея" in this idea conversation' using errcode = 'P0001';
  end if;

  select balance into current_balance
  from public.wallet_accounts
  where user_id = conversation.user_id
  for update;
  if current_balance is null then
    raise exception 'wallet not found' using errcode = 'P0002';
  end if;

  resulting_balance := current_balance + p_amount;
  update public.wallet_accounts
  set balance = resulting_balance,
      updated_at = now()
  where user_id = conversation.user_id;

  insert into public.wallet_entries (user_id, amount, kind, description, idempotency_key)
  values (
    conversation.user_id,
    p_amount,
    'credit',
    left('За идею: ' || normalized_reason, 160),
    'support-feature:' || p_conversation_id::text
  )
  returning * into wallet_entry;

  insert into private.support_feature_credits (
    conversation_id, user_id, actor_id, wallet_entry_id, amount, reason
  )
  values (
    p_conversation_id, conversation.user_id, actor_id, wallet_entry.id, p_amount, normalized_reason
  );

  insert into public.support_messages (conversation_id, author_type, body)
  values (
    p_conversation_id,
    'owner',
    'Владелец начислил ' || private.format_kopecks(p_amount)
      || ' на баланс за идею. Новый баланс: ' || private.format_kopecks(resulting_balance) || '.'
  );

  update public.support_conversations
  set status = 'pending_user', updated_at = now(), last_message_at = now()
  where id = p_conversation_id;

  insert into private.admin_audit_log (actor_id, target_user_id, event_type, payload)
  values (
    actor_id,
    conversation.user_id,
    'support_feature_credited',
    jsonb_build_object(
      'conversationId', p_conversation_id,
      'amount', p_amount,
      'reason', normalized_reason,
      'balanceAfter', resulting_balance
    )
  );

  return jsonb_build_object(
    'conversationId', p_conversation_id,
    'credited', true,
    'amount', p_amount,
    'balance', resulting_balance,
    'reason', normalized_reason
  );
exception
  when unique_violation then
    select * into existing_credit
    from private.support_feature_credits
    where conversation_id = p_conversation_id;
    select balance into resulting_balance
    from public.wallet_accounts
    where user_id = conversation.user_id;
    return jsonb_build_object(
      'conversationId', p_conversation_id,
      'credited', false,
      'amount', existing_credit.amount,
      'balance', resulting_balance,
      'reason', existing_credit.reason
    );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Блок 16. Функции, которые НЕ требуют правок, и почему.
--   * public.bind_my_referral         — возвращает суммы из колонок
--                                       referral_invites, единица наследуется.
--   * public.admin_dashboard          — totalWalletBalance, solutionCharges,
--                                       walletCredits и series.charges — чистые
--                                       агрегаты по wallet_*, единица наследуется.
--   * public.admin_list_users         — balance читается из wallet_accounts.
--   * public.admin_user_detail        — balance и walletEntries.amount как есть.
--   * public.admin_support_detail     — balance и walletEntries.amount как есть.
--   * public.begin_referral_registration, public.record_support_idea_telegram_decision
--                                     — денежных величин не содержат.
-- Все они начнут отдавать копейки автоматически. Ответственность за
-- отображение переходит на форматтер во фронтенде (src/lib/currency.ts).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Блок 17. Сверка ПОСЛЕ конвертации. Любое расхождение поднимает исключение
-- и откатывает всю транзакцию: в базе останутся рубли и старые функции.
--   * если данные конвертировались в этом прогоне — требуем строго ×100
--     по каждой строке и совпадение числа строк;
--   * если миграция уже была применена раньше — требуем, чтобы данные
--     не изменились ни на копейку, то есть повторный прогон был холостым.
-- ---------------------------------------------------------------------------

do $verify$
declare
  did_convert boolean;
  before_totals pg_temp.wallet_kopeck_totals_before%rowtype;
  after_accounts_rows bigint;
  after_accounts_sum bigint;
  after_entries_rows bigint;
  after_entries_sum bigint;
  mismatched bigint;
  expected_factor integer;
begin
  select converted into did_convert from pg_temp.wallet_kopeck_run;
  select * into before_totals from pg_temp.wallet_kopeck_totals_before;
  expected_factor := case when did_convert then 100 else 1 end;

  select count(*), coalesce(sum(balance), 0)::bigint
  into after_accounts_rows, after_accounts_sum
  from public.wallet_accounts;

  select count(*), coalesce(sum(amount), 0)::bigint
  into after_entries_rows, after_entries_sum
  from public.wallet_entries;

  -- 17.1 Число строк не должно измениться ни в одной денежной таблице.
  if after_accounts_rows <> before_totals.accounts_rows then
    raise exception 'wallet: изменилось число кошельков: было %, стало %',
      before_totals.accounts_rows, after_accounts_rows;
  end if;

  if after_entries_rows <> before_totals.entries_rows then
    raise exception 'wallet: изменилось число операций: было %, стало %',
      before_totals.entries_rows, after_entries_rows;
  end if;

  -- 17.2 Итоговые суммы.
  if after_accounts_sum <> before_totals.accounts_sum * expected_factor then
    raise exception 'wallet: сумма балансов % не равна % * %',
      after_accounts_sum, before_totals.accounts_sum, expected_factor;
  end if;

  if after_entries_sum <> before_totals.entries_sum * expected_factor then
    raise exception 'wallet: сумма операций % не равна % * %',
      after_entries_sum, before_totals.entries_sum, expected_factor;
  end if;

  -- 17.3 Построчная сверка. Совпадение итогов не доказывает, что у каждого
  -- пользователя баланс на месте: две ошибки могли скомпенсировать друг друга.
  select count(*) into mismatched
  from public.wallet_accounts a
  full join pg_temp.wallet_kopeck_accounts_before b on b.user_id = a.user_id
  where a.user_id is null
     or b.user_id is null
     or a.balance <> b.balance * expected_factor;

  if mismatched > 0 then
    raise exception 'wallet: % кошельков не совпали построчно', mismatched;
  end if;

  select count(*) into mismatched
  from public.wallet_entries e
  full join pg_temp.wallet_kopeck_entries_before b on b.id = e.id
  where e.id is null
     or b.id is null
     or e.amount <> b.amount * expected_factor;

  if mismatched > 0 then
    raise exception 'wallet: % операций не совпали построчно', mismatched;
  end if;

  -- 17.4 Сопутствующие денежные таблицы.
  if (select count(*) from public.referral_invites) <> before_totals.referral_rows
    or (select coalesce(sum(referrer_reward_amount), 0)::bigint from public.referral_invites)
       <> before_totals.referral_referrer_sum * expected_factor
    or (select coalesce(sum(invitee_reward_amount), 0)::bigint from public.referral_invites)
       <> before_totals.referral_invitee_sum * expected_factor then
    raise exception 'wallet: реферальные награды не сошлись после конвертации';
  end if;

  if (select count(*) from private.verified_balance_top_ups) <> before_totals.top_up_rows
    or (select coalesce(sum(amount), 0)::bigint from private.verified_balance_top_ups)
       <> before_totals.top_up_sum * expected_factor then
    raise exception 'wallet: история пополнений не сошлась после конвертации';
  end if;

  if (select count(*) from private.support_feature_credits) <> before_totals.feature_credit_rows
    or (select coalesce(sum(amount), 0)::bigint from private.support_feature_credits)
       <> before_totals.feature_credit_sum * expected_factor then
    raise exception 'wallet: награды за идеи не сошлись после конвертации';
  end if;

  -- 17.5 Признак обязан стоять в 'kopeck' независимо от того, конвертировали
  -- мы сейчас или миграция уже была применена раньше.
  if (select unit from private.wallet_currency_state where id) <> 'kopeck' then
    raise exception 'wallet: признак единицы измерения не переведён в kopeck';
  end if;

  -- 17.6 Проверяем, что новые цены отдаются в копейках.
  if private.solution_task_price('algebra', 1) <> 500
    or private.solution_task_price('algebra', 20) <> 1000
    or private.solution_task_price('algebra', 35) <> 1500 then
    raise exception 'wallet: solution_task_price отдаёт не копейки';
  end if;

  if private.format_kopecks(1500) <> '15 ₽' or private.format_kopecks(37) <> '0,37 ₽' then
    raise exception 'wallet: format_kopecks печатает сумму неверно';
  end if;

  if did_convert then
    raise notice 'wallet: конвертация в копейки выполнена и сверена';
  else
    raise notice 'wallet: миграция уже была применена, данные не изменились';
  end if;
end;
$verify$;

commit;
