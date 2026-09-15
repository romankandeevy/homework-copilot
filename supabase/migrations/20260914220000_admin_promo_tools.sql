-- Промокоды: свой раздел админки и инструменты к нему (14 сентября 2026).
--
-- Промокоды переехали из вкладки «Настроек» в свой раздел меню, рядом с
-- финансами, и получили то, чего владельцу не хватало:
--   1. «Только новым аккаунтам»: код принимается, если аккаунт создан не
--      раньше, чем за new_users_days дней до ввода. Пусто - как раньше.
--   2. Пакет одноразовых кодов с префиксом (SCHOOL-7F3K9Q) и общими
--      настройками: от 1 до 500 штук за раз.
--   3. Полный список активаций кода - постранично и для выгрузки в CSV.
--   4. Удаление кода, которым ни разу не пользовались. Использованный код
--      только выключается: удаление каскадом унесло бы историю погашений.
--
-- База одна у превью и прода, а прод-админку обновят позже миграции.
-- Поэтому вывод admin_promo_list только расширяется, а admin_promo_save без
-- поля newUsersDays оставляет ограничение прежним: иначе кнопка «Выключить»
-- в старой админке молча снимала бы его.
--
-- Каждая admin-функция начинается с private.require_admin и пишет журнал.

-- ---------------------------------------------------------------------------
-- 1. Ограничение «только новым аккаунтам»
-- ---------------------------------------------------------------------------

alter table private.promo_codes add column if not exists new_users_days integer;

alter table private.promo_codes drop constraint if exists promo_codes_new_users_days;
alter table private.promo_codes
  add constraint promo_codes_new_users_days check (new_users_days is null or new_users_days between 1 and 365);

-- Погашение: всё как в 20260911090500, плюс проверка возраста аккаунта.
create or replace function public.redeem_promo_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  normalized text := upper(trim(coalesce(p_code, '')));
  promo private.promo_codes%rowtype;
  used integer;
  entry_id uuid;
  resulting integer;
  plan_title text;
  account_created_at timestamptz;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  perform private.assert_account_not_banned(current_user_id);

  -- Перебор кодов: не больше десяти попыток в час на аккаунт.
  if (select count(*) from private.promo_attempts where user_id = current_user_id and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'promo attempts exceeded' using errcode = '53400';
  end if;
  insert into private.promo_attempts (user_id, code) values (current_user_id, left(normalized, 40));

  select * into promo from private.promo_codes where code = normalized for update;
  if promo.code is null or not promo.active then
    raise exception 'promo code not found' using errcode = 'P0002';
  end if;
  if promo.starts_at is not null and promo.starts_at > now() then
    raise exception 'promo code not started' using errcode = '22023';
  end if;
  if promo.expires_at is not null and promo.expires_at <= now() then
    raise exception 'promo code expired' using errcode = '22023';
  end if;
  if exists (select 1 from private.promo_redemptions where code = normalized and user_id = current_user_id) then
    raise exception 'promo code already used' using errcode = '22023';
  end if;
  -- Код для новых: аккаунт создан не раньше, чем за new_users_days дней до
  -- ввода. Отказ - своей строкой: ученик должен понять, почему код не
  -- подошёл, а не читать «такого промокода нет» (src/account/BalancePage.tsx).
  if promo.new_users_days is not null then
    select created_at into account_created_at from auth.users where id = current_user_id;
    if account_created_at is null or account_created_at < now() - make_interval(days => promo.new_users_days) then
      raise exception 'promo code for new accounts only' using errcode = '22023';
    end if;
  end if;
  select count(*) into used from private.promo_redemptions where code = normalized;
  if promo.max_uses is not null and used >= promo.max_uses then
    raise exception 'promo code exhausted' using errcode = '22023';
  end if;

  if promo.kind = 'balance' then
    update public.wallet_accounts set balance = balance + promo.amount_kopecks, updated_at = now()
    where user_id = current_user_id returning balance into resulting;
    if resulting is null then
      raise exception 'wallet not found' using errcode = 'P0002';
    end if;
    insert into public.wallet_entries (user_id, amount, kind, description, idempotency_key)
    values (current_user_id, promo.amount_kopecks, 'credit', left('Промокод ' || normalized, 160), left('promo:' || normalized, 160))
    returning id into entry_id;
  else
    update private.user_plans set revoked_at = now() where user_id = current_user_id and revoked_at is null;
    insert into private.user_plans (user_id, plan_id, expires_at, source, note)
    values (current_user_id, promo.plan_id, now() + make_interval(days => promo.plan_days), 'promo', 'Промокод ' || normalized);
    select title into plan_title from private.plans where id = promo.plan_id;
  end if;

  insert into private.promo_redemptions (code, user_id, wallet_entry_id) values (normalized, current_user_id, entry_id);

  return jsonb_build_object(
    'kind', promo.kind,
    'amount', promo.amount_kopecks,
    'balance', resulting,
    'planTitle', plan_title,
    'planDays', promo.plan_days
  );
end;
$$;

revoke all on function public.redeem_promo_code(text) from public, anon;
grant execute on function public.redeem_promo_code(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Список и сохранение: прежние поля на месте, newUsersDays - новое
-- ---------------------------------------------------------------------------

create or replace function public.admin_promo_list()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin('admin');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'code', c.code, 'kind', c.kind, 'amountKopecks', c.amount_kopecks, 'planId', c.plan_id, 'planDays', c.plan_days,
      'startsAt', c.starts_at, 'expiresAt', c.expires_at, 'maxUses', c.max_uses, 'active', c.active, 'note', c.note,
      'createdAt', c.created_at,
      'newUsersDays', c.new_users_days,
      'uses', (select count(*) from private.promo_redemptions r where r.code = c.code),
      'lastUsedAt', (select max(redeemed_at) from private.promo_redemptions r where r.code = c.code),
      'creditedKopecks', coalesce((select sum(e.amount) from private.promo_redemptions r join public.wallet_entries e on e.id = r.wallet_entry_id where r.code = c.code), 0),
      'paidAfter', (
        select count(distinct r.user_id) from private.promo_redemptions r
        where r.code = c.code and exists (select 1 from private.verified_balance_top_ups t where t.user_id = r.user_id and t.created_at > r.redeemed_at)
      ),
      'recent', coalesce((
        select jsonb_agg(jsonb_build_object('email', u.email, 'redeemedAt', r.redeemed_at) order by r.redeemed_at desc)
        from (select * from private.promo_redemptions r where r.code = c.code order by redeemed_at desc limit 10) r
        join auth.users u on u.id = r.user_id
      ), '[]'::jsonb)
    ) order by c.created_at desc)
    from private.promo_codes c
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_promo_save(p_promo jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin('admin');
  normalized text := upper(trim(coalesce(p_promo ->> 'code', '')));
  previous private.promo_codes%rowtype;
  saved private.promo_codes%rowtype;
  audience integer;
begin
  select * into previous from private.promo_codes where code = normalized;
  -- Старая админка поля не знает и не присылает: тогда ограничение остаётся
  -- прежним. Присланный null снимает его.
  audience := case
    when p_promo ? 'newUsersDays' then nullif(p_promo ->> 'newUsersDays', '')::integer
    else previous.new_users_days
  end;
  insert into private.promo_codes as c (code, kind, amount_kopecks, plan_id, plan_days, starts_at, expires_at, max_uses, active, note, new_users_days, created_by)
  values (
    normalized,
    coalesce(p_promo ->> 'kind', 'balance'),
    nullif(p_promo ->> 'amountKopecks', '')::integer,
    nullif(p_promo ->> 'planId', ''),
    nullif(p_promo ->> 'planDays', '')::integer,
    nullif(p_promo ->> 'startsAt', '')::timestamptz,
    nullif(p_promo ->> 'expiresAt', '')::timestamptz,
    nullif(p_promo ->> 'maxUses', '')::integer,
    coalesce((p_promo ->> 'active')::boolean, true),
    nullif(left(trim(coalesce(p_promo ->> 'note', '')), 200), ''),
    audience,
    actor
  )
  on conflict (code) do update
  set kind = excluded.kind, amount_kopecks = excluded.amount_kopecks, plan_id = excluded.plan_id, plan_days = excluded.plan_days,
      starts_at = excluded.starts_at, expires_at = excluded.expires_at, max_uses = excluded.max_uses,
      active = excluded.active, note = excluded.note, new_users_days = excluded.new_users_days
  returning * into saved;
  perform private.audit('promo_saved', null, jsonb_build_object('code', normalized),
    case when previous.code is null then null else to_jsonb(previous) end, to_jsonb(saved));
  return to_jsonb(saved);
end;
$$;

revoke all on function public.admin_promo_list() from public, anon;
grant execute on function public.admin_promo_list() to authenticated;
revoke all on function public.admin_promo_save(jsonb) from public, anon;
grant execute on function public.admin_promo_save(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Пакет одноразовых кодов
-- ---------------------------------------------------------------------------
--
-- p_batch: prefix, count (1-500), kind, amountKopecks | planId + planDays,
-- startsAt, expiresAt, newUsersDays, note, active. Каждый код - на одно
-- погашение (max_uses = 1). Одна запись в журнале на весь пакет, со всеми
-- кодами: по ней видно, кто и когда выпустил каждый.

create or replace function public.admin_promo_generate(p_batch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin('admin');
  -- Без 0, O, 1, I и L: код переписывают с листка и диктуют голосом.
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  prefix text := trim(both '-' from upper(trim(coalesce(p_batch ->> 'prefix', ''))));
  wanted integer := coalesce(nullif(p_batch ->> 'count', '')::integer, 0);
  batch_kind text := coalesce(nullif(p_batch ->> 'kind', ''), 'balance');
  batch_plan text := nullif(p_batch ->> 'planId', '');
  settings jsonb;
  created text[] := '{}';
  candidate text;
  random_bytes bytea;
  attempts integer := 0;
begin
  if wanted < 1 or wanted > 500 then
    raise exception 'promo batch count must be between 1 and 500' using errcode = '22023';
  end if;
  if prefix !~ '^[A-Z0-9_-]{0,20}$' then
    raise exception 'promo prefix must be up to 20 characters: A-Z, 0-9, _ and -' using errcode = '22023';
  end if;
  if batch_kind = 'plan' and not exists (select 1 from private.plans where id = batch_plan and active) then
    raise exception 'plan not found' using errcode = 'P0002';
  end if;

  settings := jsonb_build_object(
    'kind', batch_kind,
    'amountKopecks', case when batch_kind = 'balance' then nullif(p_batch ->> 'amountKopecks', '')::integer end,
    'planId', case when batch_kind = 'plan' then batch_plan end,
    'planDays', case when batch_kind = 'plan' then nullif(p_batch ->> 'planDays', '')::integer end,
    'startsAt', nullif(p_batch ->> 'startsAt', '')::timestamptz,
    'expiresAt', nullif(p_batch ->> 'expiresAt', '')::timestamptz,
    'maxUses', 1,
    'active', coalesce((p_batch ->> 'active')::boolean, true),
    'note', nullif(left(trim(coalesce(p_batch ->> 'note', '')), 200), ''),
    'newUsersDays', nullif(p_batch ->> 'newUsersDays', '')::integer
  );

  -- Шесть знаков из 31 - почти миллиард вариантов. Совпадение с уже
  -- выпущенным кодом редкость, но и оно не ошибка: занятый код пропускаем
  -- и берём следующий. Предел попыток - страховка от вечного цикла.
  while coalesce(array_length(created, 1), 0) < wanted loop
    attempts := attempts + 1;
    if attempts > wanted * 4 + 20 then
      raise exception 'promo batch generation failed' using errcode = '55000';
    end if;
    random_bytes := extensions.gen_random_bytes(6);
    candidate := '';
    for i in 0 .. 5 loop
      candidate := candidate || substr(alphabet, 1 + get_byte(random_bytes, i) % length(alphabet), 1);
    end loop;
    if prefix <> '' then
      candidate := prefix || '-' || candidate;
    end if;
    insert into private.promo_codes (code, kind, amount_kopecks, plan_id, plan_days, starts_at, expires_at, max_uses, active, note, new_users_days, created_by)
    values (
      candidate,
      batch_kind,
      (settings ->> 'amountKopecks')::integer,
      settings ->> 'planId',
      (settings ->> 'planDays')::integer,
      (settings ->> 'startsAt')::timestamptz,
      (settings ->> 'expiresAt')::timestamptz,
      1,
      (settings ->> 'active')::boolean,
      settings ->> 'note',
      (settings ->> 'newUsersDays')::integer,
      actor
    )
    on conflict (code) do nothing;
    if found then
      created := created || candidate;
    end if;
  end loop;

  perform private.audit('promo_generated', null,
    jsonb_build_object('prefix', prefix, 'count', wanted, 'codes', to_jsonb(created)), null, settings);
  return jsonb_build_object('prefix', prefix, 'count', wanted, 'codes', to_jsonb(created), 'settings', settings);
end;
$$;

revoke all on function public.admin_promo_generate(jsonb) from public, anon;
grant execute on function public.admin_promo_generate(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Кто использовал код
-- ---------------------------------------------------------------------------
--
-- Постранично, от новых к старым. Страница до 5000 строк - столько берёт
-- выгрузка в CSV, как у платежей в финансах. Телефон - для входа по номеру,
-- где почты нет.

create or replace function public.admin_promo_redemptions(p_code text, p_page integer default 1, p_page_size integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized text := upper(trim(coalesce(p_code, '')));
  safe_size integer := greatest(1, least(coalesce(p_page_size, 50), 5000));
  safe_page integer := greatest(1, coalesce(p_page, 1));
  total integer;
begin
  perform private.require_admin('admin');
  select count(*) into total from private.promo_redemptions where code = normalized;
  return jsonb_build_object(
    'code', normalized,
    'total', total,
    'page', safe_page,
    'pageSize', safe_size,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'userId', r.user_id,
        'email', u.email,
        'phone', nullif(u.phone, ''),
        'fullName', p.full_name,
        'redeemedAt', r.redeemed_at,
        'creditedKopecks', e.amount,
        'paidAfter', exists (
          select 1 from private.verified_balance_top_ups t
          where t.user_id = r.user_id and t.created_at > r.redeemed_at
        )
      ) order by r.redeemed_at desc, r.id)
      from (
        select * from private.promo_redemptions
        where code = normalized
        order by redeemed_at desc, id
        offset (safe_page - 1) * safe_size
        limit safe_size
      ) r
      left join auth.users u on u.id = r.user_id
      left join public.profiles p on p.id = r.user_id
      left join public.wallet_entries e on e.id = r.wallet_entry_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_promo_redemptions(text, integer, integer) from public, anon;
grant execute on function public.admin_promo_redemptions(text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Удаление неиспользованного кода
-- ---------------------------------------------------------------------------

create or replace function public.admin_promo_delete(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin('admin');
  normalized text := upper(trim(coalesce(p_code, '')));
  previous private.promo_codes%rowtype;
begin
  -- Та же блокировка строки, что берёт redeem_promo_code: погашение не
  -- проскочит между проверкой и удалением, иначе каскад унёс бы его запись.
  select * into previous from private.promo_codes where code = normalized for update;
  if previous.code is null then
    raise exception 'promo code not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from private.promo_redemptions where code = normalized) then
    raise exception 'promo code already redeemed: disable it instead' using errcode = '22023';
  end if;
  delete from private.promo_codes where code = normalized;
  perform private.audit('promo_deleted', null, jsonb_build_object('code', normalized), to_jsonb(previous), null);
  return jsonb_build_object('deleted', true, 'code', normalized, 'by', actor);
end;
$$;

revoke all on function public.admin_promo_delete(text) from public, anon;
grant execute on function public.admin_promo_delete(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. История раздела: пакет и удаление - тоже события промокодов
-- ---------------------------------------------------------------------------
--
-- Как в 20260912098000, только у 'promo' три события вместо одного. Вывод
-- тот же.

create or replace function public.admin_settings_history(
  p_scope text,
  p_key text default null,
  p_limit integer default 8
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  events text[];
  key_field text;
  safe_limit integer := greatest(1, least(coalesce(p_limit, 8), 50));
  total integer;
begin
  perform private.require_admin('admin');

  events := case p_scope
    when 'plans' then array['plan_saved', 'plan_deleted', 'plan_disabled']
    when 'promo' then array['promo_saved', 'promo_generated', 'promo_deleted']
    when 'prompts' then array['prompt_saved', 'prompt_rolled_back', 'prompt_disabled', 'prompt_previewed']
    when 'subjects' then array['subjects_saved']
    when 'flags' then array['flag_saved']
    when 'site' then array['setting_saved']
    when 'admins' then array['admin_role_changed']
  end;
  if events is null then
    raise exception 'Неизвестный раздел истории.' using errcode = '22023';
  end if;

  -- По какому полю payload отбирать одну сущность: предмет у промптов,
  -- ключ у флагов и настроек, код у промокодов, идентификатор у тарифов.
  key_field := case p_scope
    when 'plans' then 'planId'
    when 'promo' then 'code'
    when 'prompts' then 'subjectId'
    when 'flags' then 'key'
    when 'site' then 'key'
  end;

  select count(*) into total
  from private.admin_audit_log l
  where l.event_type = any(events)
    and (p_key is null or key_field is null or l.payload ->> key_field = p_key);

  return jsonb_build_object(
    'total', total,
    'events', to_jsonb(events),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'event', l.event_type,
        'actorEmail', au.email,
        'actorRole', l.actor_role,
        'targetEmail', tu.email,
        'payload', l.payload,
        -- Текст промпта до 8000 знаков дважды на запись - истории он не
        -- нужен: вместо него длина, а сам текст лежит в версиях.
        'before', case
          when p_scope = 'prompts' and jsonb_typeof(l.before_value) = 'object'
            then (l.before_value - 'body') || jsonb_build_object('chars', char_length(l.before_value ->> 'body'))
          else l.before_value
        end,
        'after', case
          when p_scope = 'prompts' and jsonb_typeof(l.after_value) = 'object'
            then (l.after_value - 'body') || jsonb_build_object('chars', char_length(l.after_value ->> 'body'))
          else l.after_value
        end,
        'createdAt', l.created_at
      ) order by l.created_at desc)
      from (
        select *
        from private.admin_audit_log l
        where l.event_type = any(events)
          and (p_key is null or key_field is null or l.payload ->> key_field = p_key)
        order by l.created_at desc
        limit safe_limit
      ) l
      left join auth.users au on au.id = l.actor_id
      left join auth.users tu on tu.id = l.target_user_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_settings_history(text, text, integer) from public, anon;
grant execute on function public.admin_settings_history(text, text, integer) to authenticated;
