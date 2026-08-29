-- ===========================================================================
-- ОТКАТ миграции 20260830160000_wallet_in_kopecks.sql — возврат из копеек
-- обратно в целые рубли.
--
-- ВНЕ ОБЫЧНОЙ НУМЕРАЦИИ: файл не имеет префикса-версии и не подхватывается
-- `supabase db push`. Применяется только вручную и осознанно:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/ROLLBACK_wallet_in_kopecks.sql
--
-- ГЛАВНОЕ ОГРАНИЧЕНИЕ. Откат возможен, только пока ВСЕ денежные величины
-- кратны 100 копейкам. Как только ИИ-чат спишет первую сумму с копейками
-- (например 37 копеек), деление на 100 перестанет быть обратимым: часть денег
-- пользователей пришлось бы округлить, то есть потерять или выдумать.
-- В этом случае блок 3 намеренно поднимает исключение и откат не выполняется.
-- Правильный выход из такой ситуации — не откат схемы, а исправление кода
-- вперёд (roll forward).
--
-- Возвращаются: данные, значения по умолчанию, CHECK-ограничения и тела всех
-- функций ровно в том виде, в котором они работали до 20260830160000.
-- Признак идемпотентности private.wallet_currency_state.unit переводится
-- обратно в 'ruble', поэтому прямую миграцию после отката можно применить
-- заново.
-- ===========================================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- Блок 1. Блокировка денежных таблиц: параллельная покупка не должна попасть
-- в середину обратной конвертации.
-- ---------------------------------------------------------------------------

lock table
  public.wallet_accounts,
  public.wallet_entries,
  public.referral_invites,
  private.verified_balance_top_ups,
  private.support_feature_credits
in exclusive mode;

-- ---------------------------------------------------------------------------
-- Блок 2. Контрольные суммы ДО отката: построчный снимок и итоги.
-- ---------------------------------------------------------------------------

create temporary table wallet_ruble_accounts_before on commit drop as
select user_id, balance from public.wallet_accounts;

create temporary table wallet_ruble_entries_before on commit drop as
select id, amount from public.wallet_entries;

create temporary table wallet_ruble_totals_before on commit drop as
select
  (select count(*) from public.wallet_accounts)                                   as accounts_rows,
  (select coalesce(sum(balance), 0)::bigint from public.wallet_accounts)          as accounts_sum,
  (select count(*) from public.wallet_entries)                                    as entries_rows,
  (select coalesce(sum(amount), 0)::bigint from public.wallet_entries)            as entries_sum,
  (select count(*) from public.referral_invites)                                  as referral_rows,
  (select coalesce(sum(referrer_reward_amount), 0)::bigint
     from public.referral_invites)                                                as referral_referrer_sum,
  (select coalesce(sum(invitee_reward_amount), 0)::bigint
     from public.referral_invites)                                                as referral_invitee_sum,
  (select count(*) from private.verified_balance_top_ups)                         as top_up_rows,
  (select coalesce(sum(amount), 0)::bigint from private.verified_balance_top_ups) as top_up_sum,
  (select count(*) from private.support_feature_credits)                          as feature_credit_rows,
  (select coalesce(sum(amount), 0)::bigint from private.support_feature_credits)  as feature_credit_sum;

create temporary table wallet_ruble_run (reverted boolean not null) on commit drop;

-- ---------------------------------------------------------------------------
-- Блок 3. Обратная конвертация данных ÷100 под тем же признаком
-- идемпотентности. Если unit уже 'ruble', данные не трогаем — откат
-- можно запускать повторно.
-- ---------------------------------------------------------------------------

do $revert$
declare
  current_unit text;
  fractional_rows bigint;
begin
  if to_regclass('private.wallet_currency_state') is null then
    raise exception 'wallet: признака private.wallet_currency_state нет — прямая миграция не применялась, откатывать нечего';
  end if;

  select unit into current_unit from private.wallet_currency_state where id;

  if current_unit = 'ruble' then
    raise notice 'wallet: учёт уже в рублях, данные не трогаем';
    insert into pg_temp.wallet_ruble_run (reverted) values (false);
    return;
  end if;

  -- 3.1 Проверка обратимости. Любая сумма, не кратная 100 копейкам,
  -- делает откат потерей денег — запрещаем.
  select
    (select count(*) from public.wallet_accounts where balance % 100 <> 0)
  + (select count(*) from public.wallet_entries where amount % 100 <> 0)
  + (select count(*) from public.referral_invites
       where referrer_reward_amount % 100 <> 0 or invitee_reward_amount % 100 <> 0)
  + (select count(*) from private.verified_balance_top_ups where amount % 100 <> 0)
  + (select count(*) from private.support_feature_credits where amount % 100 <> 0)
  into fractional_rows;

  if fractional_rows > 0 then
    raise exception
      'wallet: % записей содержат неполные рубли; откат в рубли округлил бы реальные деньги пользователей и запрещён. Исправляй вперёд, а не откатом.',
      fractional_rows;
  end if;

  -- 3.2 Кошельки и журнал операций.
  update public.wallet_accounts set balance = balance / 100;
  update public.wallet_entries  set amount  = amount  / 100;

  -- 3.3 Реферальные награды: снимаем «копеечный» CHECK, делим, возвращаем
  -- прежние рублёвые 10 и 5.
  alter table public.referral_invites
    drop constraint if exists referral_invites_referrer_reward_amount_check,
    drop constraint if exists referral_invites_invitee_reward_amount_check;

  update public.referral_invites
  set referrer_reward_amount = referrer_reward_amount / 100,
      invitee_reward_amount  = invitee_reward_amount  / 100;

  alter table public.referral_invites
    alter column referrer_reward_amount set default 10,
    alter column invitee_reward_amount  set default 5;

  alter table public.referral_invites
    add constraint referral_invites_referrer_reward_amount_check
      check (referrer_reward_amount = 10),
    add constraint referral_invites_invitee_reward_amount_check
      check (invitee_reward_amount = 5);

  -- 3.4 История подтверждённых пополнений: границы обратно в рубли.
  alter table private.verified_balance_top_ups
    drop constraint if exists verified_balance_top_ups_amount_check;

  update private.verified_balance_top_ups set amount = amount / 100;

  alter table private.verified_balance_top_ups
    add constraint verified_balance_top_ups_amount_check
      check (amount >= 1 and amount <= 1000000);

  -- 3.5 Награды за идеи: CHECK там только «amount > 0», снимать не нужно.
  update private.support_feature_credits set amount = amount / 100;

  -- 3.6 Приветственный баланс обратно в 20 ₽.
  alter table public.wallet_accounts alter column balance set default 20;

  -- 3.7 Возвращаем признак.
  update private.wallet_currency_state
  set unit = 'ruble',
      converted_at = now(),
      accounts_sum_after = (select coalesce(sum(balance), 0)::bigint from public.wallet_accounts),
      entries_sum_after = (select coalesce(sum(amount), 0)::bigint from public.wallet_entries)
  where id;

  insert into pg_temp.wallet_ruble_run (reverted) values (true);
end;
$revert$;

-- ---------------------------------------------------------------------------
-- Блок 4. Цена решения обратно в рубли: 500/1000/1500 -> 5/10/15.
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

  if position_in_chapter < ceil(chapter_length / 3.0) then return 5; end if;
  if position_in_chapter < ceil(chapter_length * 2 / 3.0) then return 10; end if;
  return 15;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Блок 5. Приветственный баланс обратно в 20 ₽.
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
  values (new.id, 20);

  insert into public.wallet_entries (user_id, amount, kind, description, idempotency_key)
  values (new.id, 20, 'credit', 'Стартовые 20 ₽', 'welcome-credit');

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Блок 6. Списание за решение: цена по фото обратно 15 ₽.
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
    when p_source = 'photo' then 15
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
-- Блок 7. Резерв оплаты: цена по фото обратно 15 ₽.
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
  when unique_violation then
    select balance into resulting_balance
    from public.wallet_accounts
    where user_id = current_user_id;

    return jsonb_build_object('balance', resulting_balance, 'reserved', false, 'alreadyReserved', true);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Блок 8. Возврат резерва: функция единице измерения безразлична, в прямой
-- миграции не менялась. Переиздаём для полноты состояния.
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
-- Блок 9. Выдача решения: цена по фото обратно 15 ₽, описание операции снова
-- собирается конкатенацией рублёвой цены без private.format_kopecks.
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
    description := 'Решение задачи № ' || p_task || ' · ' || solution_price || ' ₽';

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
    when p_source = 'photo' then 15
    else private.solution_task_price(p_textbook_id, p_task::integer)
  end;
  description := case
    when p_source = 'photo' then 'Решение задачи по фото · ' || solution_price || ' ₽'
    else 'Решение задачи № ' || p_task || ' · ' || solution_price || ' ₽'
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
-- Блок 10. Ручная корректировка баланса: предел обратно ±100 000 ₽.
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
  if p_amount is null or p_amount = 0 or abs(p_amount) > 100000 then
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
-- Блок 11. Подтверждение пополнения: границы 1..1 000 000 ₽,
-- реферальные суммы в ответе и аудите обратно 10 и 5.
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
  if p_amount is null or p_amount not between 1 and 1000000 then
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
      'referrerRewardAmount', 10,
      'inviteeRewardAmount', 5
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
      'referrerRewardAmount', case when referral_rewarded then 10 else 0 end,
      'inviteeRewardAmount', case when referral_rewarded then 5 else 0 end
    )
  );

  return jsonb_build_object(
    'applied', true,
    'amount', p_amount,
    'balance', invitee_balance,
    'referralRewarded', referral_rewarded,
    'referrerRewardAmount', case when referral_rewarded then 10 else 0 end,
    'inviteeRewardAmount', case when referral_rewarded then 5 else 0 end,
    'referrerBalance', case when referral_rewarded then referrer_balance else null end
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Блок 12. Реферальная витрина: суммы в ответе обратно 10 и 5.
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
    'referrerRewardAmount', 10,
    'inviteeRewardAmount', 5
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Блок 13. Награда за идею: границы обратно 1..10 000 ₽, автосообщение снова
-- собирается конкатенацией без private.format_kopecks.
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
  if p_amount is null or p_amount < 1 or p_amount > 10000 then
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
    'Владелец начислил ' || p_amount || ' ₽ на баланс за идею. Новый баланс: ' || resulting_balance || ' ₽.'
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
-- Блок 14. Убираем вспомогательный форматтер копеек: после отката его никто
-- не вызывает. Таблица-признак private.wallet_currency_state остаётся —
-- она хранит историю конвертаций и нужна для повторного применения прямой
-- миграции.
-- ---------------------------------------------------------------------------

drop function if exists private.format_kopecks(integer);

-- ---------------------------------------------------------------------------
-- Блок 15. Сверка ПОСЛЕ отката. Любое расхождение откатывает транзакцию,
-- и в базе остаются копейки со всеми копеечными функциями.
--   * если данные откатывались в этом прогоне — требуем строго ÷100
--     построчно и совпадение числа строк;
--   * если откат уже был выполнен раньше — требуем, чтобы данные не
--     изменились ни на копейку.
-- ---------------------------------------------------------------------------

do $verify$
declare
  did_revert boolean;
  before_totals pg_temp.wallet_ruble_totals_before%rowtype;
  after_accounts_rows bigint;
  after_accounts_sum bigint;
  after_entries_rows bigint;
  after_entries_sum bigint;
  mismatched bigint;
  divisor integer;
begin
  select reverted into did_revert from pg_temp.wallet_ruble_run;
  select * into before_totals from pg_temp.wallet_ruble_totals_before;
  divisor := case when did_revert then 100 else 1 end;

  select count(*), coalesce(sum(balance), 0)::bigint
  into after_accounts_rows, after_accounts_sum
  from public.wallet_accounts;

  select count(*), coalesce(sum(amount), 0)::bigint
  into after_entries_rows, after_entries_sum
  from public.wallet_entries;

  -- 15.1 Число строк не должно измениться.
  if after_accounts_rows <> before_totals.accounts_rows then
    raise exception 'wallet: изменилось число кошельков: было %, стало %',
      before_totals.accounts_rows, after_accounts_rows;
  end if;

  if after_entries_rows <> before_totals.entries_rows then
    raise exception 'wallet: изменилось число операций: было %, стало %',
      before_totals.entries_rows, after_entries_rows;
  end if;

  -- 15.2 Итоговые суммы.
  if after_accounts_sum * divisor <> before_totals.accounts_sum then
    raise exception 'wallet: сумма балансов % * % не равна исходной %',
      after_accounts_sum, divisor, before_totals.accounts_sum;
  end if;

  if after_entries_sum * divisor <> before_totals.entries_sum then
    raise exception 'wallet: сумма операций % * % не равна исходной %',
      after_entries_sum, divisor, before_totals.entries_sum;
  end if;

  -- 15.3 Построчная сверка: у каждого пользователя ровно исходная сумма / 100.
  select count(*) into mismatched
  from public.wallet_accounts a
  full join pg_temp.wallet_ruble_accounts_before b on b.user_id = a.user_id
  where a.user_id is null
     or b.user_id is null
     or a.balance * divisor <> b.balance;

  if mismatched > 0 then
    raise exception 'wallet: % кошельков не совпали построчно', mismatched;
  end if;

  select count(*) into mismatched
  from public.wallet_entries e
  full join pg_temp.wallet_ruble_entries_before b on b.id = e.id
  where e.id is null
     or b.id is null
     or e.amount * divisor <> b.amount;

  if mismatched > 0 then
    raise exception 'wallet: % операций не совпали построчно', mismatched;
  end if;

  -- 15.4 Сопутствующие денежные таблицы.
  if (select count(*) from public.referral_invites) <> before_totals.referral_rows
    or (select coalesce(sum(referrer_reward_amount), 0)::bigint from public.referral_invites) * divisor
       <> before_totals.referral_referrer_sum
    or (select coalesce(sum(invitee_reward_amount), 0)::bigint from public.referral_invites) * divisor
       <> before_totals.referral_invitee_sum then
    raise exception 'wallet: реферальные награды не сошлись после отката';
  end if;

  if (select count(*) from private.verified_balance_top_ups) <> before_totals.top_up_rows
    or (select coalesce(sum(amount), 0)::bigint from private.verified_balance_top_ups) * divisor
       <> before_totals.top_up_sum then
    raise exception 'wallet: история пополнений не сошлась после отката';
  end if;

  if (select count(*) from private.support_feature_credits) <> before_totals.feature_credit_rows
    or (select coalesce(sum(amount), 0)::bigint from private.support_feature_credits) * divisor
       <> before_totals.feature_credit_sum then
    raise exception 'wallet: награды за идеи не сошлись после отката';
  end if;

  -- 15.5 Признак обязан стоять в 'ruble'.
  if (select unit from private.wallet_currency_state where id) <> 'ruble' then
    raise exception 'wallet: признак единицы измерения не переведён обратно в ruble';
  end if;

  -- 15.6 Цены снова рублёвые.
  if private.solution_task_price('algebra', 1) <> 5
    or private.solution_task_price('algebra', 20) <> 10
    or private.solution_task_price('algebra', 35) <> 15 then
    raise exception 'wallet: solution_task_price отдаёт не рубли';
  end if;

  if did_revert then
    raise notice 'wallet: откат в рубли выполнен и сверен';
  else
    raise notice 'wallet: учёт уже был в рублях, данные не изменились';
  end if;
end;
$verify$;

commit;
