-- Ответы чата с 30 августа не списывались: расчёт падал на ограничении
-- брони, которой больше нет.
--
-- Разбор 14 сентября 2026 по журналу ошибок, строкам `chat_generations`
-- и пробе в транзакции с откатом.
--
--   1. 30 августа (коммит 7ca95a0 «не замораживать деньги в чате до ответа»)
--      `reserve_chat_generation` перестала снимать деньги вперёд и пишет в
--      `chat_generations.reserved_kopecks` ноль. Файла миграции у этой
--      правки не было: функции ушли в базу напрямую, и в репозитории до сих
--      пор лежала версия с бронью. Ниже они записаны такими, какие стоят
--      на проде, - чтобы следующий разбор начинался с правды.
--   2. Ограничение `chat_generations_charge_within_reserve`
--      (charged_kopecks <= reserved_kopecks) из 20260830170000 осталось.
--      С нулевой бронью любое списание больше нуля его нарушает, и
--      `settle_chat_generation` падает с 23514 целиком - вместе со
--      списанием с кошелька.
--   3. Сервер ошибку расчёта не проверял: ученик получал ответ бесплатно и
--      читал под ним «Списано 0 ₽, баланс 0 ₽», а генерация оставалась в
--      статусе `reserved`.
--   4. Висящую строку `assert_chat_quota` пять минут считает активной
--      генерацией, и следующий вопрос сразу получал «Дождись, пока
--      закончится предыдущий ответ». Через десять минут строку закрывал
--      уборщик как `refunded`. Та же цепочка 4 сентября была записана в
--      20260905134541 как «функция на Vercel не дошла до конца».
--
-- С 30 августа не оплачена ни одна генерация: две последние успешные, по
-- 20 копеек, прошли 30 августа до правки.
--
-- Проба на проде до этой миграции (блок do, который кончается raise, -
-- ничего не осталось): reserve по gpt-5-6-luna вернула reservedKopecks 0,
-- settle('succeeded', 0,02 кредита) упала с 23514
-- chat_generations_charge_within_reserve.

-- ---------------------------------------------------------------------------
-- 1. Сверка с бронью только там, где бронь была
-- ---------------------------------------------------------------------------
--
-- Старые строки (до 30 августа) несут настоящую бронь, и списание по ним
-- обязано в неё укладываться. У новых брони нет: потолок списания держит
-- `settle_chat_generation` - `max_charge_kopecks` модели и остаток баланса.

alter table public.chat_generations
  drop constraint if exists chat_generations_charge_within_reserve;

alter table public.chat_generations
  add constraint chat_generations_charge_within_reserve
  check (reserved_kopecks = 0 or charged_kopecks <= reserved_kopecks);

-- ---------------------------------------------------------------------------
-- 2. gemini-2.5-flash шлюз не обслуживает
-- ---------------------------------------------------------------------------
--
-- 14 сентября три запроса подряд - владельца в 18:42 и два проверочных -
-- получили HTTP 200 с телом {"code":500,"msg":"Network error, please try
-- again later."} и ни одного кадра потока. Модель стояла первой в списке,
-- то есть выбиралась по умолчанию: ученик открывал чат и получал ошибку на
-- первом же вопросе. gemini-3-pro и gpt-5-6-luna в ту же минуту отвечали.
-- Включать обратно - после живого запроса, который вернул текст.

update private.chat_model_catalog
set is_enabled = false, updated_at = now()
where model_id = 'gemini-2.5-flash';

-- ---------------------------------------------------------------------------
-- 3. Функции чата - как на проде с 30 августа
-- ---------------------------------------------------------------------------
--
-- Колонка ставки есть на проде, но ни одна миграция её не заводила.

alter table private.chat_model_catalog
  add column if not exists credits_per_1k_chars numeric not null default 0;

create or replace function public.reserve_chat_generation(
  p_idempotency_key text,
  p_conversation_id uuid,
  p_model_id text,
  p_image_count integer default 0,
  p_use_web_search boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  current_user_id uuid := (select auth.uid());
  settings private.chat_settings%rowtype;
  model private.chat_model_catalog%rowtype;
  existing public.chat_generations%rowtype;
  current_balance integer;
  kopecks_per_1k numeric;
  character_budget integer;
  -- Общий потолок ответа: тот же, что в server/chat.ts.
  max_characters constant integer := 20000;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if char_length(coalesce(p_idempotency_key, '')) not between 8 and 160 then
    raise exception 'invalid idempotency key' using errcode = '22023';
  end if;

  select * into settings from private.chat_settings where id;

  select balance into current_balance
  from public.wallet_accounts where user_id = current_user_id;

  -- Повторный вызов с тем же ключом ничего не начинает заново.
  select * into existing
  from public.chat_generations
  where user_id = current_user_id and idempotency_key = p_idempotency_key;

  if existing.id is not null then
    return jsonb_build_object(
      'generationId', existing.id,
      'reservedKopecks', 0,
      'balanceKopecks', current_balance,
      'answerCharacterBudget', max_characters,
      'alreadyReserved', true
    );
  end if;

  select * into model
  from private.chat_model_catalog
  where model_id = p_model_id and is_enabled;

  if not found then
    raise exception 'chat model is unavailable' using errcode = '22023';
  end if;

  if p_image_count > 0 and not model.supports_images then
    raise exception 'chat model does not accept images' using errcode = '22023';
  end if;

  if p_use_web_search and not model.supports_web_search then
    raise exception 'chat model does not support web search' using errcode = '22023';
  end if;

  if p_conversation_id is not null and not exists (
    select 1 from public.chat_conversations
    where id = p_conversation_id and user_id = current_user_id and deleted_at is null
  ) then
    raise exception 'chat conversation not found' using errcode = 'P0002';
  end if;

  perform private.assert_chat_quota(current_user_id, coalesce(p_image_count, 0));

  -- Денег должно хватать хотя бы на минимальное списание.
  if coalesce(current_balance, 0) < settings.min_charge_kopecks then
    raise exception 'insufficient balance' using errcode = 'P0001';
  end if;

  -- Сколько символов ответа покрывает баланс по замеренной ставке модели.
  -- Так перерасход невозможен без заморозки денег: длинный ответ просто
  -- не будет длиннее, чем школьник в состоянии оплатить.
  kopecks_per_1k := model.credits_per_1k_chars * model.credit_cost_kopecks
    * (100 + settings.markup_percent) / 100.0;

  character_budget := case
    when kopecks_per_1k <= 0 then max_characters
    else least(max_characters, floor(current_balance / kopecks_per_1k * 1000)::integer)
  end;

  -- Брони нет: reserved_kopecks всегда 0. Поэтому ограничение
  -- chat_generations_charge_within_reserve сверяет списание с бронью
  -- только у старых строк (раздел 1 выше).
  insert into public.chat_generations (
    user_id, conversation_id, idempotency_key, model_id, tariff_version,
    reserved_kopecks, markup_percent, image_count, used_web_search
  )
  values (
    current_user_id, p_conversation_id, p_idempotency_key, model.model_id, model.tariff_version,
    0, settings.markup_percent, coalesce(p_image_count, 0), coalesce(p_use_web_search, false)
  )
  returning * into existing;

  return jsonb_build_object(
    'generationId', existing.id,
    'reservedKopecks', 0,
    'balanceKopecks', current_balance,
    'answerCharacterBudget', character_budget,
    'alreadyReserved', false
  );
exception
  when unique_violation then
    select * into existing
    from public.chat_generations
    where user_id = current_user_id and idempotency_key = p_idempotency_key;
    return jsonb_build_object(
      'generationId', existing.id,
      'reservedKopecks', 0,
      'balanceKopecks', current_balance,
      'answerCharacterBudget', max_characters,
      'alreadyReserved', true
    );
end;
$function$;

revoke all on function public.reserve_chat_generation(text, uuid, text, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.reserve_chat_generation(text, uuid, text, integer, boolean)
  to authenticated;

create or replace function public.settle_chat_generation(
  p_generation_id uuid,
  p_status text,
  p_input_tokens integer default null,
  p_output_tokens integer default null,
  p_credits_consumed numeric default null,
  p_message_id uuid default null,
  p_error text default null,
  p_duration_ms integer default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  generation public.chat_generations%rowtype;
  settings private.chat_settings%rowtype;
  model private.chat_model_catalog%rowtype;
  provider_cost integer := 0;
  has_usage boolean := false;
  charge integer;
  balance_before integer;
  resulting_balance integer;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_status not in ('succeeded', 'failed', 'cancelled') then
    raise exception 'invalid generation status' using errcode = '22023';
  end if;

  select * into generation
  from public.chat_generations
  where id = p_generation_id
  for update;

  if generation.id is null then
    raise exception 'generation not found' using errcode = 'P0002';
  end if;

  if generation.status <> 'reserved' then
    select balance into resulting_balance
    from public.wallet_accounts where user_id = generation.user_id;
    return jsonb_build_object(
      'settled', false,
      'reason', 'already settled',
      'chargedKopecks', generation.charged_kopecks,
      'refundedKopecks', 0,
      'balanceKopecks', resulting_balance
    );
  end if;

  select * into settings from private.chat_settings where id;
  select * into model from private.chat_model_catalog where model_id = generation.model_id;

  select balance into balance_before
  from public.wallet_accounts where user_id = generation.user_id for update;

  -- Себестоимость считает база по снимку тарифа, а не сервер: держать прайс
  -- в двух местах — гарантированное расхождение, а верить присланной сервером
  -- сумме нельзя даже при service_role.
  if p_credits_consumed is not null and p_credits_consumed > 0 and coalesce(model.credit_cost_kopecks, 0) > 0 then
    provider_cost := ceil(p_credits_consumed * model.credit_cost_kopecks)::integer;
    has_usage := true;
  elsif (coalesce(p_input_tokens, 0) > 0 or coalesce(p_output_tokens, 0) > 0)
    and (coalesce(model.input_cost_per_mtok_kopecks, 0) > 0 or coalesce(model.output_cost_per_mtok_kopecks, 0) > 0)
  then
    provider_cost := ceil(
      coalesce(p_input_tokens, 0)::numeric * model.input_cost_per_mtok_kopecks / 1000000.0
      + coalesce(p_output_tokens, 0)::numeric * model.output_cost_per_mtok_kopecks / 1000000.0
    )::integer;
    has_usage := true;
  end if;

  if p_status = 'succeeded' and has_usage then
    charge := ceil(provider_cost * (100 + generation.markup_percent) / 100.0)::integer;
    charge := greatest(charge, settings.min_charge_kopecks);
    charge := least(charge, model.max_charge_kopecks);
    -- Не больше, чем есть на балансе: в долг школьника не загоняем.
    charge := least(charge, greatest(coalesce(balance_before, 0), 0));
  else
    -- Ошибка, отмена или отсутствие проверяемых данных о расходе:
    -- не списываем ничего. Отдать ответ бесплатно честнее, чем списать наугад.
    charge := 0;
  end if;

  if charge > 0 then
    update public.wallet_accounts
    set balance = balance - charge
    where user_id = generation.user_id
    returning balance into resulting_balance;

    insert into public.wallet_entries (user_id, amount, kind, description, idempotency_key)
    values (
      generation.user_id,
      -charge,
      'debit',
      'Ответ: ' || model.title,
      left(generation.idempotency_key || ':charge', 160)
    );
  else
    resulting_balance := balance_before;
  end if;

  update public.chat_generations
  set status = case when p_status = 'succeeded' and charge > 0 then 'succeeded'
                    when p_status = 'succeeded' then 'refunded'
                    else p_status end,
      provider_cost_kopecks = provider_cost,
      charged_kopecks = charge,
      input_tokens = p_input_tokens,
      output_tokens = p_output_tokens,
      credits_consumed = p_credits_consumed,
      message_id = coalesce(p_message_id, message_id),
      error = left(p_error, 1000),
      duration_ms = p_duration_ms,
      finished_at = now()
  where id = generation.id;

  return jsonb_build_object(
    'settled', true,
    'chargedKopecks', charge,
    'refundedKopecks', 0,
    'balanceKopecks', resulting_balance
  );
end;
$function$;

revoke all on function public.settle_chat_generation(uuid, text, integer, integer, numeric, uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.settle_chat_generation(uuid, text, integer, integer, numeric, uuid, text, integer)
  to service_role;

create or replace function public.list_chat_models()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  settings private.chat_settings%rowtype;
  models jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  select * into settings from private.chat_settings where id;

  if not found or not settings.is_enabled then
    return jsonb_build_object('enabled', false, 'models', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', catalog.model_id,
      'title', catalog.title,
      'description', catalog.description,
      'supportsImages', catalog.supports_images,
      'supportsWebSearch', catalog.supports_web_search,
      'maxChargeKopecks', catalog.max_charge_kopecks,
      'minChargeKopecks', settings.min_charge_kopecks
    )
    order by catalog.sort_order, catalog.title
  ), '[]'::jsonb) into models
  from private.chat_model_catalog catalog
  where catalog.is_enabled;

  return jsonb_build_object('enabled', true, 'models', models);
end;
$function$;

revoke all on function public.list_chat_models() from public, anon, authenticated;
grant execute on function public.list_chat_models() to authenticated;
