-- Ядро универсального ИИ-чата: диалоги, сообщения, биллинг генераций,
-- каталог моделей и защита от злоупотреблений.
--
-- Все денежные величины — целые КОПЕЙКИ. Никаких numeric и float:
-- деньги в дробных типах рано или поздно расходятся с реальностью.
-- Перевод существующего кошелька в копейки выполняет миграция
-- 20260830160000_wallet_in_kopecks и она должна примениться раньше.
--
-- Главный принцип прав: пользователь читает только своё, а ответы модели
-- и любые денежные поля пишет исключительно сервер под service_role.
-- Все RPC зовутся напрямую из браузера, поэтому каждая проверка —
-- бан, лимиты, потолок трат — живёт в базе, а не в TypeScript.

-- ---------------------------------------------------------------------------
-- 1. Настройки чата и аварийный выключатель
-- ---------------------------------------------------------------------------

create table if not exists private.chat_settings (
  id boolean primary key default true,
  is_enabled boolean not null default false,
  markup_percent integer not null default 30,
  -- Минимальное списание за сообщение. Без него наценка в 30% на запрос
  -- ценой в сотые доли копейки не покрывает даже вызов функции.
  min_charge_kopecks integer not null default 20,
  -- Потолки на пользователя. Подобраны под школьника, а не под нагрузочный
  -- тест: 10 сообщений в минуту — это быстрее, чем человек успевает читать
  -- ответы; 120 в час перекрывает домашку с запасом; 300 ₽ в день —
  -- заметно выше любого честного сценария и при этом ограничивает ущерб
  -- от угнанного аккаунта.
  max_messages_per_minute integer not null default 10,
  max_messages_per_hour integer not null default 120,
  max_daily_spend_kopecks integer not null default 30000,
  max_images_per_day integer not null default 40,
  max_active_generations integer not null default 1,
  updated_at timestamptz not null default now(),
  constraint chat_settings_single_row check (id),
  constraint chat_settings_markup check (markup_percent between 0 and 500),
  constraint chat_settings_min_charge check (min_charge_kopecks between 0 and 10000),
  constraint chat_settings_rates check (
    max_messages_per_minute between 1 and 600
    and max_messages_per_hour between 1 and 10000
    and max_daily_spend_kopecks between 0 and 10000000
    and max_images_per_day between 0 and 1000
    and max_active_generations between 1 and 10
  )
);

insert into private.chat_settings (id) values (true) on conflict (id) do nothing;

alter table private.chat_settings enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Каталог моделей
-- ---------------------------------------------------------------------------
--
-- Себестоимость и версия тарифа не должны попадать в браузер, поэтому
-- каталог лежит в private, а интерфейс получает урезанный список через RPC.

create table if not exists private.chat_model_catalog (
  model_id text primary key,
  title text not null,
  description text not null default '',
  supports_images boolean not null default false,
  supports_web_search boolean not null default false,
  -- Себестоимость за миллион токенов, в копейках. Хранится отдельно
  -- для входа и выхода: у большинства моделей они различаются в разы.
  input_cost_per_mtok_kopecks integer not null default 0,
  output_cost_per_mtok_kopecks integer not null default 0,
  -- Сколько копеек стоит один кредит провайдера, если модель тарифицируется
  -- кредитами, а не токенами.
  credit_cost_kopecks integer not null default 0,
  -- Потолок списания за одно сообщение. Он же резервируется до вызова.
  max_charge_kopecks integer not null default 3000,
  tariff_version integer not null default 1,
  sort_order integer not null default 100,
  is_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_model_costs_non_negative check (
    input_cost_per_mtok_kopecks >= 0
    and output_cost_per_mtok_kopecks >= 0
    and credit_cost_kopecks >= 0
    and max_charge_kopecks between 1 and 100000
  )
);

alter table private.chat_model_catalog enable row level security;

create index if not exists chat_model_catalog_enabled_idx
  on private.chat_model_catalog (is_enabled, sort_order);

-- ---------------------------------------------------------------------------
-- 3. Диалоги и сообщения
-- ---------------------------------------------------------------------------

create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Новый чат',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz,
  deleted_at timestamptz,
  constraint chat_conversations_title_length check (char_length(title) between 1 and 120)
);

create index if not exists chat_conversations_user_idx
  on public.chat_conversations (user_id, coalesce(last_message_at, created_at) desc)
  where deleted_at is null;

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  -- Пути к вложениям в приватном бакете. Сами файлы наружу не отдаются,
  -- в API уходит только короткоживущая подписанная ссылка.
  attachments jsonb not null default '[]'::jsonb,
  model_id text,
  status text not null default 'done' check (status in ('streaming', 'done', 'failed', 'cancelled')),
  created_at timestamptz not null default now(),
  constraint chat_messages_content_size check (char_length(content) <= 60000),
  constraint chat_messages_attachments_array check (jsonb_typeof(attachments) = 'array'),
  constraint chat_messages_attachments_limit check (jsonb_array_length(attachments) <= 4),
  -- Роль пользователя не может быть в статусе генерации.
  constraint chat_messages_user_role_done check (role <> 'user' or status = 'done')
);

create index if not exists chat_messages_conversation_idx
  on public.chat_messages (conversation_id, created_at);

create index if not exists chat_messages_user_created_idx
  on public.chat_messages (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. Генерации: единственный источник правды по деньгам
-- ---------------------------------------------------------------------------
--
-- Запись переживает удаление чата: при удалении диалога тексты стираются,
-- а обезличенная финансовая строка остаётся — иначе нельзя ни свести
-- выручку, ни разобрать спор о списании.

create table if not exists public.chat_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.chat_conversations(id) on delete set null,
  message_id uuid references public.chat_messages(id) on delete set null,
  idempotency_key text not null,
  model_id text not null,
  tariff_version integer not null default 1,
  status text not null default 'reserved'
    check (status in ('reserved', 'succeeded', 'failed', 'cancelled', 'refunded')),
  reserved_kopecks integer not null default 0,
  provider_cost_kopecks integer not null default 0,
  markup_percent integer not null default 30,
  charged_kopecks integer not null default 0,
  input_tokens integer,
  output_tokens integer,
  credits_consumed numeric(18, 6),
  used_web_search boolean not null default false,
  image_count integer not null default 0,
  error text,
  duration_ms integer,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint chat_generations_amounts_non_negative check (
    reserved_kopecks >= 0 and provider_cost_kopecks >= 0 and charged_kopecks >= 0
  ),
  constraint chat_generations_charge_within_reserve check (charged_kopecks <= reserved_kopecks),
  constraint chat_generations_error_length check (error is null or char_length(error) <= 1000),
  constraint chat_generations_images check (image_count between 0 and 4)
);

create unique index if not exists chat_generations_user_key_idx
  on public.chat_generations (user_id, idempotency_key);

-- Индексы под проверки лимитов: они выполняются на каждое сообщение,
-- поэтому обязаны идти по индексу, а не сканом.
create index if not exists chat_generations_user_created_idx
  on public.chat_generations (user_id, created_at desc);

create index if not exists chat_generations_active_idx
  on public.chat_generations (user_id)
  where status = 'reserved';

-- ---------------------------------------------------------------------------
-- 5. Права
-- ---------------------------------------------------------------------------

alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_generations enable row level security;

revoke all on table public.chat_conversations from public, anon, authenticated;
revoke all on table public.chat_messages from public, anon, authenticated;
revoke all on table public.chat_generations from public, anon, authenticated;

grant select on table public.chat_conversations to authenticated;
grant select on table public.chat_messages to authenticated;

drop policy if exists chat_conversations_select_own on public.chat_conversations;
create policy chat_conversations_select_own on public.chat_conversations
  for select to authenticated
  using ((select auth.uid()) = user_id and deleted_at is null);

drop policy if exists chat_messages_select_own on public.chat_messages;
create policy chat_messages_select_own on public.chat_messages
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- Записи о генерациях пользователю не видны вовсе: в них лежит
-- себестоимость провайдера, то есть внутренняя экономика сервиса.
-- Свои списания пользователь видит в кошельке, как и раньше.

-- ---------------------------------------------------------------------------
-- 6. Проверка лимитов
-- ---------------------------------------------------------------------------
--
-- Одна функция на все потолки: её зовёт и резерв, и загрузка вложений.
-- Проверки в TypeScript ничего не стоят — RPC доступны из браузера напрямую.

create or replace function private.assert_chat_quota(
  p_user_id uuid,
  p_image_count integer default 0
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  settings private.chat_settings%rowtype;
  used_minute integer;
  used_hour integer;
  spent_today integer;
  images_today integer;
  active_generations integer;
begin
  select * into settings from private.chat_settings where id;

  if not found or not settings.is_enabled then
    raise exception 'chat is disabled' using errcode = '53400';
  end if;

  perform private.assert_account_not_banned(p_user_id);

  select count(*) into used_minute
  from public.chat_generations
  where user_id = p_user_id and created_at > now() - interval '1 minute';

  if used_minute >= settings.max_messages_per_minute then
    raise exception 'chat rate limit per minute' using errcode = '53400';
  end if;

  select count(*) into used_hour
  from public.chat_generations
  where user_id = p_user_id and created_at > now() - interval '1 hour';

  if used_hour >= settings.max_messages_per_hour then
    raise exception 'chat rate limit per hour' using errcode = '53400';
  end if;

  -- Одна активная генерация на пользователя. Это и защита от спама,
  -- и защита от гонки: два параллельных резерва не пройдут.
  select count(*) into active_generations
  from public.chat_generations
  where user_id = p_user_id and status = 'reserved';

  if active_generations >= settings.max_active_generations then
    raise exception 'chat generation already running' using errcode = '55006';
  end if;

  select coalesce(sum(charged_kopecks), 0) into spent_today
  from public.chat_generations
  where user_id = p_user_id
    and created_at > now() - interval '1 day'
    and status in ('succeeded', 'refunded');

  if spent_today >= settings.max_daily_spend_kopecks then
    raise exception 'chat daily spend limit' using errcode = '53400';
  end if;

  if p_image_count > 0 then
    select coalesce(sum(image_count), 0) into images_today
    from public.chat_generations
    where user_id = p_user_id and created_at > now() - interval '1 day';

    if images_today + p_image_count > settings.max_images_per_day then
      raise exception 'chat image quota exceeded' using errcode = '53400';
    end if;
  end if;
end;
$$;

revoke all on function private.assert_chat_quota(uuid, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Диалоги: создание, переименование, удаление
-- ---------------------------------------------------------------------------

create or replace function public.create_chat_conversation(p_title text default 'Новый чат')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  normalized_title text := nullif(btrim(coalesce(p_title, '')), '');
  conversation public.chat_conversations%rowtype;
  open_conversations integer;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  perform private.assert_account_not_banned(current_user_id);

  if char_length(coalesce(normalized_title, 'Новый чат')) > 120 then
    raise exception 'invalid chat title' using errcode = '22023';
  end if;

  -- Потолок на число диалогов: без него скрипт создаёт их миллионами,
  -- не потратив ни копейки.
  select count(*) into open_conversations
  from public.chat_conversations
  where user_id = current_user_id and deleted_at is null;

  if open_conversations >= 200 then
    raise exception 'too many chat conversations' using errcode = '53400';
  end if;

  insert into public.chat_conversations (user_id, title)
  values (current_user_id, coalesce(normalized_title, 'Новый чат'))
  returning * into conversation;

  return jsonb_build_object(
    'id', conversation.id,
    'title', conversation.title,
    'createdAt', conversation.created_at
  );
end;
$$;

revoke all on function public.create_chat_conversation(text) from public, anon, authenticated;
grant execute on function public.create_chat_conversation(text) to authenticated;

create or replace function public.rename_chat_conversation(
  p_conversation_id uuid,
  p_title text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  normalized_title text := btrim(coalesce(p_title, ''));
  updated public.chat_conversations%rowtype;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if char_length(normalized_title) not between 1 and 120 then
    raise exception 'invalid chat title' using errcode = '22023';
  end if;

  update public.chat_conversations
  set title = normalized_title, updated_at = now()
  where id = p_conversation_id
    and user_id = current_user_id
    and deleted_at is null
  returning * into updated;

  if updated.id is null then
    raise exception 'chat conversation not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object('id', updated.id, 'title', updated.title);
end;
$$;

revoke all on function public.rename_chat_conversation(uuid, text) from public, anon, authenticated;
grant execute on function public.rename_chat_conversation(uuid, text) to authenticated;

-- Удаление стирает содержимое, но оставляет обезличенную финансовую строку:
-- иначе после удаления чата нельзя разобрать спор о списании.
create or replace function public.delete_chat_conversation(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  removed_messages integer;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if not exists (
    select 1 from public.chat_conversations
    where id = p_conversation_id and user_id = current_user_id and deleted_at is null
  ) then
    raise exception 'chat conversation not found' using errcode = 'P0002';
  end if;

  -- Отвязываем финансовые записи до удаления сообщений, чтобы каскад
  -- не унёс историю списаний вместе с текстами.
  update public.chat_generations
  set conversation_id = null, message_id = null
  where user_id = current_user_id and conversation_id = p_conversation_id;

  with purged as (
    delete from public.chat_messages
    where conversation_id = p_conversation_id and user_id = current_user_id
    returning 1
  )
  select count(*) into removed_messages from purged;

  update public.chat_conversations
  set deleted_at = now(), title = 'Удалённый чат', updated_at = now()
  where id = p_conversation_id and user_id = current_user_id;

  return jsonb_build_object('deleted', true, 'messages', removed_messages);
end;
$$;

revoke all on function public.delete_chat_conversation(uuid) from public, anon, authenticated;
grant execute on function public.delete_chat_conversation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Список моделей для интерфейса
-- ---------------------------------------------------------------------------
--
-- Наружу уходит только ориентир цены за сообщение и возможности модели.
-- Себестоимость и версия тарифа остаются внутри.

create or replace function public.list_chat_models()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
      'maxChargeKopecks', catalog.max_charge_kopecks
    )
    order by catalog.sort_order, catalog.title
  ), '[]'::jsonb) into models
  from private.chat_model_catalog catalog
  where catalog.is_enabled;

  return jsonb_build_object('enabled', true, 'models', models);
end;
$$;

revoke all on function public.list_chat_models() from public, anon, authenticated;
grant execute on function public.list_chat_models() to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Резерв под генерацию
-- ---------------------------------------------------------------------------
--
-- Та же схема, что у решений (20260830120000): списываем максимум вперёд,
-- после ответа возвращаем неизрасходованный остаток. Запись в wallet_entries
-- с ключом генерации служит и резервом, и защитой от повторного списания.

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
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  settings private.chat_settings%rowtype;
  model private.chat_model_catalog%rowtype;
  existing public.chat_generations%rowtype;
  resulting_balance integer;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if char_length(coalesce(p_idempotency_key, '')) not between 8 and 160 then
    raise exception 'invalid idempotency key' using errcode = '22023';
  end if;

  -- Повторный вызов с тем же ключом ничего не резервирует заново.
  select * into existing
  from public.chat_generations
  where user_id = current_user_id and idempotency_key = p_idempotency_key;

  if existing.id is not null then
    select balance into resulting_balance
    from public.wallet_accounts where user_id = current_user_id;
    return jsonb_build_object(
      'generationId', existing.id,
      'reservedKopecks', existing.reserved_kopecks,
      'balanceKopecks', resulting_balance,
      'alreadyReserved', true
    );
  end if;

  select * into settings from private.chat_settings where id;

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

  update public.wallet_accounts
  set balance = balance - model.max_charge_kopecks
  where user_id = current_user_id
    and balance >= model.max_charge_kopecks
  returning balance into resulting_balance;

  if resulting_balance is null then
    raise exception 'insufficient balance' using errcode = 'P0001';
  end if;

  insert into public.wallet_entries (user_id, amount, kind, description, idempotency_key)
  values (current_user_id, -model.max_charge_kopecks, 'debit', 'Резерв: ' || model.title, p_idempotency_key);

  insert into public.chat_generations (
    user_id, conversation_id, idempotency_key, model_id, tariff_version,
    reserved_kopecks, markup_percent, image_count, used_web_search
  )
  values (
    current_user_id, p_conversation_id, p_idempotency_key, model.model_id, model.tariff_version,
    model.max_charge_kopecks, settings.markup_percent, coalesce(p_image_count, 0), coalesce(p_use_web_search, false)
  )
  returning * into existing;

  return jsonb_build_object(
    'generationId', existing.id,
    'reservedKopecks', existing.reserved_kopecks,
    'balanceKopecks', resulting_balance,
    'alreadyReserved', false
  );
exception
  when unique_violation then
    select balance into resulting_balance
    from public.wallet_accounts where user_id = current_user_id;
    select * into existing
    from public.chat_generations
    where user_id = current_user_id and idempotency_key = p_idempotency_key;
    return jsonb_build_object(
      'generationId', existing.id,
      'reservedKopecks', existing.reserved_kopecks,
      'balanceKopecks', resulting_balance,
      'alreadyReserved', true
    );
end;
$$;

revoke all on function public.reserve_chat_generation(text, uuid, text, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.reserve_chat_generation(text, uuid, text, integer, boolean)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Расчёт по факту
-- ---------------------------------------------------------------------------
--
-- Зовёт только сервер: пользователь не может объявить, сколько он потратил.
-- Если проверяемых данных о расходе нет — не списываем ничего и считаем
-- генерацию неуспешной. Лучше отдать решение бесплатно, чем списать наугад.

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
set search_path = ''
as $$
declare
  generation public.chat_generations%rowtype;
  settings private.chat_settings%rowtype;
  model private.chat_model_catalog%rowtype;
  provider_cost integer := 0;
  has_usage boolean := false;
  charge integer;
  refund integer;
  resulting_balance integer;
begin
  -- Расчёт — операция сервера. Пользовательский JWT сюда не допускается.
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

  -- Повторный расчёт по той же генерации ничего не меняет.
  if generation.status <> 'reserved' then
    select balance into resulting_balance
    from public.wallet_accounts where user_id = generation.user_id;
    return jsonb_build_object(
      'settled', false,
      'reason', 'already settled',
      'chargedKopecks', generation.charged_kopecks,
      'balanceKopecks', resulting_balance
    );
  end if;

  select * into settings from private.chat_settings where id;
  select * into model from private.chat_model_catalog where model_id = generation.model_id;

  -- Себестоимость считает база по снимку тарифа, а не сервер: держать прайс
  -- в двух местах — гарантированное расхождение, а верить присланной сервером
  -- сумме нельзя даже при service_role.
  --
  -- Приоритет у кредитов провайдера: это его собственный учёт расхода.
  -- Токены — резервный путь, если кредитов в ответе нет.
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
    charge := least(charge, generation.reserved_kopecks);
  else
    -- Ошибка, отмена или отсутствие проверяемых данных о расходе:
    -- не списываем ничего. Отдать ответ бесплатно честнее, чем списать наугад.
    charge := 0;
  end if;

  refund := generation.reserved_kopecks - charge;

  if refund > 0 then
    update public.wallet_accounts
    set balance = balance + refund
    where user_id = generation.user_id
    returning balance into resulting_balance;

    insert into public.wallet_entries (user_id, amount, kind, description, idempotency_key)
    values (
      generation.user_id,
      refund,
      'credit',
      case when charge = 0 then 'Возврат резерва чата' else 'Возврат неизрасходованного резерва' end,
      left(generation.idempotency_key || ':settle', 160)
    );
  else
    select balance into resulting_balance
    from public.wallet_accounts where user_id = generation.user_id;
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
    'refundedKopecks', refund,
    'balanceKopecks', resulting_balance
  );
end;
$$;

revoke all on function public.settle_chat_generation(uuid, text, integer, integer, numeric, uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.settle_chat_generation(uuid, text, integer, integer, numeric, uuid, text, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 11. Разгребание брошенных резервов
-- ---------------------------------------------------------------------------
--
-- Сервер может умереть посреди генерации. Без реапера деньги останутся
-- зарезервированными навсегда, а пользователь не сможет начать новый запрос:
-- лимит активных генераций не даст.

create or replace function private.reap_stale_chat_generations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  stale record;
  reaped integer := 0;
begin
  for stale in
    select * from public.chat_generations
    where status = 'reserved' and created_at < now() - interval '10 minutes'
    for update skip locked
  loop
    update public.wallet_accounts
    set balance = balance + stale.reserved_kopecks
    where user_id = stale.user_id;

    insert into public.wallet_entries (user_id, amount, kind, description, idempotency_key)
    values (stale.user_id, stale.reserved_kopecks, 'credit', 'Возврат резерва чата',
            left(stale.idempotency_key || ':settle', 160))
    on conflict do nothing;

    update public.chat_generations
    set status = 'refunded',
        charged_kopecks = 0,
        error = coalesce(error, 'Генерация не завершилась'),
        finished_at = now()
    where id = stale.id;

    reaped := reaped + 1;
  end loop;

  return reaped;
end;
$$;

revoke all on function private.reap_stale_chat_generations() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('reap-stale-chat-generations')
      where exists (select 1 from cron.job where jobname = 'reap-stale-chat-generations');
    perform cron.schedule(
      'reap-stale-chat-generations',
      '*/5 * * * *',
      $cron$select private.reap_stale_chat_generations()$cron$
    );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. Приватный бакет для вложений
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-attachments',
  'chat-attachments',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Пользователь работает только со своей папкой: первый сегмент пути — его id.
drop policy if exists chat_attachments_insert_own on storage.objects;
create policy chat_attachments_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists chat_attachments_select_own on storage.objects;
create policy chat_attachments_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists chat_attachments_delete_own on storage.objects;
create policy chat_attachments_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ---------------------------------------------------------------------------
-- 13. Обновление updated_at
-- ---------------------------------------------------------------------------

drop trigger if exists chat_conversations_set_updated_at on public.chat_conversations;
create trigger chat_conversations_set_updated_at
  before update on public.chat_conversations
  for each row execute function private.set_updated_at();

drop trigger if exists chat_model_catalog_set_updated_at on private.chat_model_catalog;
create trigger chat_model_catalog_set_updated_at
  before update on private.chat_model_catalog
  for each row execute function private.set_updated_at();
