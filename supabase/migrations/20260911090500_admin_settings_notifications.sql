-- Настройки без деплоя и уведомления администратору.
--
-- Тарифы, промокоды, промпты решателя с версиями, список предметов,
-- фиче-флаги, баннер и пороги меняются из админки и читаются приложением
-- и решателем на лету. Уведомления копятся в очереди и уходят в Telegram и
-- на почту через функцию на Vercel: pg_cron раз в минуту стучится к ней
-- через pg_net с одноразовым токеном, который знает только база.

create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- 1. Тарифы
-- ---------------------------------------------------------------------------

create or replace function public.admin_plan_save(p_plan jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin('admin');
  plan_id text := lower(trim(coalesce(p_plan ->> 'id', '')));
  previous private.plans%rowtype;
  saved private.plans%rowtype;
begin
  select * into previous from private.plans where id = plan_id;

  insert into private.plans as p (id, title, description, price_kopecks, period_days, daily_solve_limit, features, is_default, active, sort, updated_by, updated_at)
  values (
    plan_id,
    trim(coalesce(p_plan ->> 'title', '')),
    left(trim(coalesce(p_plan ->> 'description', '')), 500),
    coalesce((p_plan ->> 'priceKopecks')::integer, 0),
    coalesce((p_plan ->> 'periodDays')::integer, 30),
    nullif(p_plan ->> 'dailySolveLimit', '')::integer,
    coalesce(p_plan -> 'features', '[]'::jsonb),
    false,
    coalesce((p_plan ->> 'active')::boolean, true),
    coalesce((p_plan ->> 'sort')::integer, 0),
    actor,
    now()
  )
  on conflict (id) do update
  set title = excluded.title, description = excluded.description, price_kopecks = excluded.price_kopecks,
      period_days = excluded.period_days, daily_solve_limit = excluded.daily_solve_limit, features = excluded.features,
      active = case when p.is_default then true else excluded.active end,
      sort = excluded.sort, updated_by = actor, updated_at = now()
  returning * into saved;

  if (p_plan ->> 'isDefault')::boolean is true and not saved.is_default then
    update private.plans set is_default = false where is_default;
    update private.plans set is_default = true, active = true where id = plan_id returning * into saved;
  end if;

  perform private.audit('plan_saved', null, jsonb_build_object('planId', plan_id),
    case when previous.id is null then null else to_jsonb(previous) end, to_jsonb(saved));
  return to_jsonb(saved);
end;
$$;

create or replace function public.admin_plan_delete(p_plan_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous private.plans%rowtype;
begin
  perform private.require_admin('owner');
  select * into previous from private.plans where id = p_plan_id;
  if previous.id is null then
    raise exception 'plan not found' using errcode = 'P0002';
  end if;
  if previous.is_default then
    raise exception 'default plan cannot be deleted' using errcode = '22023';
  end if;
  if exists (select 1 from private.user_plans where plan_id = p_plan_id) then
    -- История выдач ссылается на тариф: не удаляем, а выключаем.
    update private.plans set active = false, updated_at = now() where id = p_plan_id;
    update private.user_plans set revoked_at = now() where plan_id = p_plan_id and revoked_at is null;
    perform private.audit('plan_disabled', null, jsonb_build_object('planId', p_plan_id), to_jsonb(previous), null);
    return jsonb_build_object('disabled', true);
  end if;
  delete from private.plans where id = p_plan_id;
  perform private.audit('plan_deleted', null, jsonb_build_object('planId', p_plan_id), to_jsonb(previous), null);
  return jsonb_build_object('deleted', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Промокоды
-- ---------------------------------------------------------------------------

create table if not exists private.promo_codes (
  code text primary key,
  kind text not null,
  amount_kopecks integer,
  plan_id text references private.plans(id) on delete restrict,
  plan_days integer,
  starts_at timestamptz,
  expires_at timestamptz,
  max_uses integer,
  active boolean not null default true,
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint promo_codes_format check (code ~ '^[A-Z0-9_-]{3,32}$'),
  constraint promo_codes_kind_known check (kind in ('balance', 'plan')),
  constraint promo_codes_shape check (
    (kind = 'balance' and amount_kopecks between 1 and 1000000 and plan_id is null)
    or (kind = 'plan' and plan_id is not null and plan_days between 1 and 3650)
  ),
  constraint promo_codes_max_uses check (max_uses is null or max_uses between 1 and 1000000)
);

create table if not exists private.promo_redemptions (
  id uuid primary key default gen_random_uuid(),
  code text not null references private.promo_codes(code) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  wallet_entry_id uuid references public.wallet_entries(id) on delete set null,
  redeemed_at timestamptz not null default now(),
  unique (code, user_id)
);

create index if not exists promo_redemptions_code_idx on private.promo_redemptions (code, redeemed_at desc);

alter table private.promo_codes enable row level security;
alter table private.promo_redemptions enable row level security;
revoke all on table private.promo_codes, private.promo_redemptions from public, anon, authenticated;

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

create table if not exists private.promo_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  code text not null,
  created_at timestamptz not null default now()
);

create index if not exists promo_attempts_user_idx on private.promo_attempts (user_id, created_at desc);
alter table private.promo_attempts enable row level security;
revoke all on table private.promo_attempts from public, anon, authenticated;

revoke all on function public.redeem_promo_code(text) from public, anon;
grant execute on function public.redeem_promo_code(text) to authenticated;

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
begin
  select * into previous from private.promo_codes where code = normalized;
  insert into private.promo_codes as c (code, kind, amount_kopecks, plan_id, plan_days, starts_at, expires_at, max_uses, active, note, created_by)
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
    actor
  )
  on conflict (code) do update
  set kind = excluded.kind, amount_kopecks = excluded.amount_kopecks, plan_id = excluded.plan_id, plan_days = excluded.plan_days,
      starts_at = excluded.starts_at, expires_at = excluded.expires_at, max_uses = excluded.max_uses,
      active = excluded.active, note = excluded.note
  returning * into saved;
  perform private.audit('promo_saved', null, jsonb_build_object('code', normalized),
    case when previous.code is null then null else to_jsonb(previous) end, to_jsonb(saved));
  return to_jsonb(saved);
end;
$$;

revoke all on function public.admin_plan_save(jsonb) from public, anon;
grant execute on function public.admin_plan_save(jsonb) to authenticated;
revoke all on function public.admin_plan_delete(text) from public, anon;
grant execute on function public.admin_plan_delete(text) to authenticated;
revoke all on function public.admin_promo_list() from public, anon;
grant execute on function public.admin_promo_list() to authenticated;
revoke all on function public.admin_promo_save(jsonb) from public, anon;
grant execute on function public.admin_promo_save(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Предметы, фиче-флаги, промпты решателя
-- ---------------------------------------------------------------------------

create table if not exists private.subject_settings (
  subject_id text primary key,
  enabled boolean not null default true,
  sort integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

insert into private.subject_settings (subject_id, sort) values
  ('mathematics', 0), ('algebra', 1), ('geometry', 2), ('physics', 3), ('chemistry', 4), ('biology', 5),
  ('informatics', 6), ('russian', 7), ('literature', 8), ('english', 9), ('history', 10), ('social', 11),
  ('geography', 12), ('astronomy', 13)
on conflict (subject_id) do nothing;

create table if not exists private.feature_flags (
  key text primary key,
  description text not null default '',
  enabled boolean not null default true,
  rollout_percent integer not null default 100,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint feature_flags_key_format check (key ~ '^[a-z0-9_]{2,40}$'),
  constraint feature_flags_rollout_range check (rollout_percent between 0 and 100)
);

insert into private.feature_flags (key, description) values
  ('ai_chat', 'ИИ-чат: раздел и отправка сообщений'),
  ('schedule', 'Раздел «Расписание»'),
  ('photo_input', 'Постановка задачи фотографией'),
  ('solution_rating', 'Оценка решения «помогло / не помогло»'),
  ('promo_codes', 'Ввод промокода в кошельке')
on conflict (key) do nothing;

create table if not exists private.solver_prompts (
  id uuid primary key default gen_random_uuid(),
  subject_id text not null,
  version integer not null,
  body text not null check (char_length(body) between 1 and 8000),
  note text,
  active boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (subject_id, version)
);

create unique index if not exists solver_prompts_active_idx on private.solver_prompts (subject_id) where active;

alter table private.subject_settings enable row level security;
alter table private.feature_flags enable row level security;
alter table private.solver_prompts enable row level security;
revoke all on table private.subject_settings, private.feature_flags, private.solver_prompts from public, anon, authenticated;

-- Флаг для конкретного человека: процент раскатки считается по устойчивому
-- хэшу ключа флага и идентификатора, поэтому один и тот же человек видит
-- функцию всегда одинаково.
create or replace function private.flag_enabled(p_key text, p_subject text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select f.enabled and (
      f.rollout_percent >= 100
      or (f.rollout_percent > 0 and abs(hashtext(f.key || ':' || coalesce(p_subject, ''))) % 100 < f.rollout_percent)
    )
    from private.feature_flags f where f.key = p_key
  ), true);
$$;

revoke all on function private.flag_enabled(text, text) from public, anon, authenticated;

insert into private.app_settings (key, value) values
  ('site_banner', '{"enabled": false, "text": "", "tone": "info", "link": ""}'::jsonb),
  ('notify_emails', '[]'::jsonb),
  ('daily_summary_hour', '9'::jsonb)
on conflict (key) do nothing;

-- Открытая конфигурация для приложения: предметы, флаги, баннер.
create or replace function public.get_public_config(p_guest_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  subject_key text := coalesce((select auth.uid())::text, p_guest_id::text, '');
begin
  return jsonb_build_object(
    'subjects', coalesce((
      select jsonb_agg(jsonb_build_object('id', subject_id, 'enabled', enabled) order by sort, subject_id)
      from private.subject_settings
    ), '[]'::jsonb),
    'flags', coalesce((
      select jsonb_object_agg(key, private.flag_enabled(key, subject_key)) from private.feature_flags
    ), '{}'::jsonb),
    'banner', coalesce((select value from private.app_settings where key = 'site_banner'), '{"enabled": false}'::jsonb)
  );
end;
$$;

revoke all on function public.get_public_config(uuid) from public;
grant execute on function public.get_public_config(uuid) to anon, authenticated;

-- Решателю и чату: лимит, предмет, промпт и флаги для этого человека.
create or replace function public.solver_context(p_user_id uuid default null, p_guest_id uuid default null, p_subject_id text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  plan private.plans;
  account_limit integer;
  prompt private.solver_prompts%rowtype;
  subject_key text := coalesce(p_user_id::text, p_guest_id::text, '');
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_user_id is not null then
    plan := private.effective_plan(p_user_id);
    select daily_solve_limit into account_limit from public.account_controls where user_id = p_user_id;
  end if;
  if p_subject_id is not null then
    select * into prompt from private.solver_prompts where subject_id = p_subject_id and active;
  end if;

  return jsonb_build_object(
    'dailySolveLimit', coalesce(account_limit, plan.daily_solve_limit),
    'planId', plan.id,
    'subjectEnabled', coalesce((select enabled from private.subject_settings where subject_id = p_subject_id), true),
    'prompt', prompt.body,
    'promptVersion', prompt.version,
    'flags', coalesce((select jsonb_object_agg(key, private.flag_enabled(key, subject_key)) from private.feature_flags), '{}'::jsonb)
  );
end;
$$;

revoke all on function public.solver_context(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.solver_context(uuid, uuid, text) to service_role;

create or replace function public.admin_prompt_action(p_action text, p_subject_id text default null, p_body text default null, p_note text default null, p_prompt_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin('admin');
  next_version integer;
  saved private.solver_prompts%rowtype;
  previous private.solver_prompts%rowtype;
begin
  if p_action = 'list' then
    return coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'subjectId', p.subject_id, 'version', p.version, 'body', p.body, 'note', p.note,
        'active', p.active, 'authorEmail', u.email, 'createdAt', p.created_at) order by p.subject_id, p.version desc)
      from private.solver_prompts p left join auth.users u on u.id = p.created_by
      where p_subject_id is null or p.subject_id = p_subject_id
    ), '[]'::jsonb);
  end if;

  if p_action = 'save' then
    if p_subject_id is null or not exists (select 1 from private.subject_settings where subject_id = p_subject_id) then
      raise exception 'unknown subject' using errcode = '22023';
    end if;
    select * into previous from private.solver_prompts where subject_id = p_subject_id and active;
    select coalesce(max(version), 0) + 1 into next_version from private.solver_prompts where subject_id = p_subject_id;
    update private.solver_prompts set active = false where subject_id = p_subject_id and active;
    insert into private.solver_prompts (subject_id, version, body, note, active, created_by)
    values (p_subject_id, next_version, trim(p_body), nullif(left(trim(coalesce(p_note, '')), 300), ''), true, actor)
    returning * into saved;
    perform private.audit('prompt_saved', null, jsonb_build_object('subjectId', p_subject_id, 'version', next_version),
      jsonb_build_object('version', previous.version, 'body', previous.body), jsonb_build_object('version', next_version, 'body', saved.body));
    return to_jsonb(saved);
  end if;

  if p_action = 'activate' then
    select * into saved from private.solver_prompts where id = p_prompt_id;
    if saved.id is null then
      raise exception 'prompt not found' using errcode = 'P0002';
    end if;
    select * into previous from private.solver_prompts where subject_id = saved.subject_id and active;
    update private.solver_prompts set active = false where subject_id = saved.subject_id and active;
    update private.solver_prompts set active = true where id = p_prompt_id returning * into saved;
    perform private.audit('prompt_rolled_back', null, jsonb_build_object('subjectId', saved.subject_id),
      jsonb_build_object('version', previous.version), jsonb_build_object('version', saved.version));
    return to_jsonb(saved);
  end if;

  if p_action = 'disable' then
    select * into previous from private.solver_prompts where subject_id = p_subject_id and active;
    update private.solver_prompts set active = false where subject_id = p_subject_id and active;
    perform private.audit('prompt_disabled', null, jsonb_build_object('subjectId', p_subject_id),
      jsonb_build_object('version', previous.version), null);
    return jsonb_build_object('disabled', true);
  end if;

  raise exception 'unknown prompt action' using errcode = '22023';
end;
$$;

revoke all on function public.admin_prompt_action(text, text, text, text, uuid) from public, anon;
grant execute on function public.admin_prompt_action(text, text, text, text, uuid) to authenticated;

create or replace function public.admin_settings_overview()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin('admin');
  return jsonb_build_object(
    'plans', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'title', p.title, 'description', p.description, 'priceKopecks', p.price_kopecks,
        'periodDays', p.period_days, 'dailySolveLimit', p.daily_solve_limit, 'features', p.features,
        'isDefault', p.is_default, 'active', p.active, 'sort', p.sort, 'updatedAt', p.updated_at,
        'users', (select count(*) from private.user_plans up where up.plan_id = p.id and up.revoked_at is null and (up.expires_at is null or up.expires_at > now()))
      ) order by p.sort, p.id)
      from private.plans p
    ), '[]'::jsonb),
    'subjects', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.subject_id, 'enabled', s.enabled, 'sort', s.sort,
        'promptVersion', (select version from private.solver_prompts p where p.subject_id = s.subject_id and p.active)) order by s.sort, s.subject_id)
      from private.subject_settings s
    ), '[]'::jsonb),
    'flags', coalesce((
      select jsonb_agg(jsonb_build_object('key', f.key, 'description', f.description, 'enabled', f.enabled, 'rolloutPercent', f.rollout_percent, 'updatedAt', f.updated_at) order by f.key)
      from private.feature_flags f
    ), '[]'::jsonb),
    'settings', coalesce((select jsonb_object_agg(key, value) from private.app_settings), '{}'::jsonb)
  );
end;
$$;

create or replace function public.admin_subjects_save(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin('admin');
  before_value jsonb;
  item jsonb;
begin
  select jsonb_agg(jsonb_build_object('id', subject_id, 'enabled', enabled, 'sort', sort) order by sort) into before_value from private.subject_settings;
  for item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    update private.subject_settings
    set enabled = coalesce((item ->> 'enabled')::boolean, enabled),
        sort = coalesce((item ->> 'sort')::integer, sort),
        updated_at = now(), updated_by = actor
    where subject_id = item ->> 'id';
  end loop;
  if not exists (select 1 from private.subject_settings where enabled) then
    raise exception 'at least one subject must stay enabled' using errcode = '22023';
  end if;
  perform private.audit('subjects_saved', null, '{}'::jsonb, before_value,
    (select jsonb_agg(jsonb_build_object('id', subject_id, 'enabled', enabled, 'sort', sort) order by sort) from private.subject_settings));
  return jsonb_build_object('saved', true);
end;
$$;

create or replace function public.admin_flag_save(p_key text, p_enabled boolean, p_rollout integer, p_description text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin('admin');
  previous private.feature_flags%rowtype;
  saved private.feature_flags%rowtype;
begin
  select * into previous from private.feature_flags where key = p_key;
  insert into private.feature_flags as f (key, description, enabled, rollout_percent, updated_by, updated_at)
  values (lower(trim(p_key)), coalesce(nullif(trim(coalesce(p_description, '')), ''), previous.description, ''), coalesce(p_enabled, true), coalesce(p_rollout, 100), actor, now())
  on conflict (key) do update
  set enabled = excluded.enabled, rollout_percent = excluded.rollout_percent,
      description = excluded.description, updated_by = actor, updated_at = now()
  returning * into saved;
  perform private.audit('flag_saved', null, jsonb_build_object('key', saved.key),
    case when previous.key is null then null else to_jsonb(previous) end, to_jsonb(saved));
  return to_jsonb(saved);
end;
$$;

-- Настройки-значения: баннер, SLA, пороги ошибок, адреса уведомлений.
create or replace function public.admin_setting_save(p_key text, p_value jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin('admin');
  previous jsonb;
begin
  if p_key not in ('site_banner', 'support_sla_minutes', 'error_alert_users', 'error_alert_window_minutes', 'error_spike_hourly', 'notify_emails', 'daily_summary_hour') then
    raise exception 'unknown setting' using errcode = '22023';
  end if;
  if p_key = 'site_banner' and (jsonb_typeof(p_value) <> 'object' or char_length(coalesce(p_value ->> 'text', '')) > 300) then
    raise exception 'invalid banner' using errcode = '22023';
  end if;
  if p_key in ('support_sla_minutes', 'error_alert_users', 'error_alert_window_minutes', 'error_spike_hourly', 'daily_summary_hour')
    and (jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric < 0 or (p_value #>> '{}')::numeric > 10000) then
    raise exception 'invalid numeric setting' using errcode = '22023';
  end if;
  if p_key = 'notify_emails' and jsonb_typeof(p_value) <> 'array' then
    raise exception 'emails must be a list' using errcode = '22023';
  end if;
  select value into previous from private.app_settings where key = p_key;
  insert into private.app_settings (key, value, updated_at, updated_by) values (p_key, p_value, now(), actor)
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = actor;
  perform private.audit('setting_saved', null, jsonb_build_object('key', p_key), jsonb_build_object('value', previous), jsonb_build_object('value', p_value));
  return jsonb_build_object('key', p_key, 'value', p_value);
end;
$$;

revoke all on function public.admin_settings_overview() from public, anon;
grant execute on function public.admin_settings_overview() to authenticated;
revoke all on function public.admin_subjects_save(jsonb) from public, anon;
grant execute on function public.admin_subjects_save(jsonb) to authenticated;
revoke all on function public.admin_flag_save(text, boolean, integer, text) from public, anon;
grant execute on function public.admin_flag_save(text, boolean, integer, text) to authenticated;
revoke all on function public.admin_setting_save(text, jsonb) from public, anon;
grant execute on function public.admin_setting_save(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Уведомления администратору
-- ---------------------------------------------------------------------------

create table if not exists private.admin_notification_rules (
  event text primary key,
  title text not null,
  telegram boolean not null default true,
  email boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into private.admin_notification_rules (event, title, telegram, email) values
  ('payment_new', 'Новый платёж', true, false),
  ('payment_failed', 'Провалившийся платёж', true, false),
  ('payment_refund', 'Возврат', true, true),
  ('ticket_new', 'Новый тикет', true, false),
  ('error_spike', 'Всплеск ошибок', true, true),
  ('error_alert', 'Новая ошибка задела много пользователей', true, true),
  ('fraud_high', 'Флаг фрода высокого уровня', true, false),
  ('service_down', 'Падение внешнего сервиса', true, true),
  ('daily_summary', 'Дневная сводка', true, true)
on conflict (event) do nothing;

create table if not exists private.admin_notifications (
  id uuid primary key default gen_random_uuid(),
  event text not null references private.admin_notification_rules(event) on delete cascade,
  title text not null,
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text,
  want_telegram boolean not null default false,
  want_email boolean not null default false,
  telegram_sent_at timestamptz,
  email_sent_at timestamptz,
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now()
);

create unique index if not exists admin_notifications_dedupe_idx on private.admin_notifications (dedupe_key) where dedupe_key is not null;
create index if not exists admin_notifications_pending_idx on private.admin_notifications (created_at)
  where (want_telegram and telegram_sent_at is null) or (want_email and email_sent_at is null);

alter table private.admin_notification_rules enable row level security;
alter table private.admin_notifications enable row level security;
revoke all on table private.admin_notification_rules, private.admin_notifications from public, anon, authenticated;

create or replace function private.notify_admin(p_event text, p_body text, p_payload jsonb default '{}'::jsonb, p_dedupe text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rule private.admin_notification_rules%rowtype;
begin
  select * into rule from private.admin_notification_rules where event = p_event;
  if rule.event is null or not (rule.telegram or rule.email) then
    return;
  end if;
  insert into private.admin_notifications (event, title, body, payload, dedupe_key, want_telegram, want_email)
  values (p_event, rule.title, left(p_body, 3500), coalesce(p_payload, '{}'::jsonb), p_dedupe, rule.telegram, rule.email)
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
end;
$$;

revoke all on function private.notify_admin(text, text, jsonb, text) from public, anon, authenticated;

create or replace function private.format_rub(p_kopecks bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_kopecks % 100 = 0 then (p_kopecks / 100)::text else to_char(p_kopecks / 100.0, 'FM999999990D00') end || ' ₽';
$$;

revoke all on function private.format_rub(bigint) from public, anon, authenticated;

create or replace function private.on_top_up_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.notify_admin('payment_new',
    format('Пополнение %s · %s', private.format_rub(new.amount), (select email from auth.users where id = new.user_id)),
    jsonb_build_object('topUpId', new.id, 'userId', new.user_id, 'amount', new.amount));
  return new;
end;
$$;

create or replace function private.on_refund_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.notify_admin('payment_refund',
    format('Возврат %s · %s · %s', private.format_rub(new.amount), (select email from auth.users where id = new.user_id), new.reason),
    jsonb_build_object('refundId', new.id, 'userId', new.user_id, 'amount', new.amount));
  return new;
end;
$$;

create or replace function private.on_ticket_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.notify_admin('ticket_new',
    format('Новое обращение «%s» от %s', new.subject, (select email from auth.users where id = new.user_id)),
    jsonb_build_object('conversationId', new.id, 'userId', new.user_id));
  return new;
end;
$$;

create or replace function private.on_fraud_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.risk = 'high' then
    perform private.notify_admin('fraud_high',
      format('%s · %s', (select email from auth.users where id = new.user_id), new.explanation),
      jsonb_build_object('flagId', new.id, 'userId', new.user_id, 'ruleId', new.rule_id));
  end if;
  return new;
end;
$$;

-- Отказ оплаты (402): одно уведомление на человека в час, иначе шум.
create or replace function private.on_payment_rejection_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 402 and new.user_id is not null then
    perform private.notify_admin('payment_failed',
      format('Не хватило баланса на %s · %s', new.route, (select email from auth.users where id = new.user_id)),
      jsonb_build_object('userId', new.user_id, 'route', new.route),
      'payment_failed:' || new.user_id::text || ':' || to_char(now(), 'YYYYMMDDHH24'));
  end if;
  return new;
end;
$$;

revoke all on function private.on_top_up_notify() from public, anon, authenticated;
revoke all on function private.on_refund_notify() from public, anon, authenticated;
revoke all on function private.on_ticket_notify() from public, anon, authenticated;
revoke all on function private.on_fraud_notify() from public, anon, authenticated;
revoke all on function private.on_payment_rejection_notify() from public, anon, authenticated;

drop trigger if exists top_ups_notify on private.verified_balance_top_ups;
create trigger top_ups_notify after insert on private.verified_balance_top_ups for each row execute function private.on_top_up_notify();
drop trigger if exists refunds_notify on private.top_up_refunds;
create trigger refunds_notify after insert on private.top_up_refunds for each row execute function private.on_refund_notify();
drop trigger if exists tickets_notify on public.support_conversations;
create trigger tickets_notify after insert on public.support_conversations for each row execute function private.on_ticket_notify();
drop trigger if exists fraud_flags_notify on private.fraud_flags;
create trigger fraud_flags_notify after insert on private.fraud_flags for each row execute function private.on_fraud_notify();
drop trigger if exists request_logs_notify on private.request_logs;
create trigger request_logs_notify after insert on private.request_logs for each row execute function private.on_payment_rejection_notify();

-- Алерты по ошибкам: новая ошибка задела больше N пользователей за окно,
-- и общий всплеск за час.
create or replace function private.check_error_alerts()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  alert_users integer := private.setting_int('error_alert_users', 5);
  alert_window integer := private.setting_int('error_alert_window_minutes', 10);
  spike integer := private.setting_int('error_spike_hourly', 20);
  row_record record;
  last_hour integer;
begin
  for row_record in
    select g.fingerprint, g.title, g.route, g.kind,
      count(distinct coalesce(e.user_id::text, e.guest_id::text, e.ip)) as users
    from private.error_groups g
    join private.error_events e on e.fingerprint = g.fingerprint and e.created_at > now() - make_interval(mins => alert_window)
    where g.status in ('new', 'in_progress')
      and (g.alerted_at is null or g.alerted_at < now() - interval '6 hours')
    group by g.fingerprint, g.title, g.route, g.kind
    having count(distinct coalesce(e.user_id::text, e.guest_id::text, e.ip)) > alert_users
  loop
    perform private.notify_admin('error_alert',
      format('%s · %s · %s пользователей за %s мин: %s', row_record.kind, coalesce(row_record.route, '—'), row_record.users, alert_window, row_record.title),
      jsonb_build_object('fingerprint', row_record.fingerprint));
    update private.error_groups set alerted_at = now() where fingerprint = row_record.fingerprint;
  end loop;

  select count(*) into last_hour from private.error_events where created_at > now() - interval '1 hour';
  if last_hour > spike then
    perform private.notify_admin('error_spike',
      format('За последний час %s ошибок (порог %s)', last_hour, spike),
      jsonb_build_object('count', last_hour),
      'error_spike:' || to_char(now(), 'YYYYMMDDHH24'));
  end if;
end;
$$;

revoke all on function private.check_error_alerts() from public, anon, authenticated;

create or replace function private.enqueue_daily_summary()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  yesterday date := private.msk_day(now()) - 1;
  m private.daily_metrics%rowtype;
begin
  perform private.refresh_daily_metrics(yesterday, yesterday);
  select * into m from private.daily_metrics where day = yesterday;
  perform private.notify_admin('daily_summary',
    format(E'Сводка за %s\nВыручка: %s (%s пополнений)\nРегистрации: %s\nАктивных: %s\nЗадач решено: %s, не решено: %s\nРасход на LLM: %s\nОшибок: %s\nОткрытых флагов фрода: %s\nОбращений ждут ответа: %s',
      to_char(yesterday, 'DD.MM.YYYY'),
      private.format_rub(coalesce(m.revenue_kopecks - m.refunds_kopecks, 0)), coalesce(m.top_ups, 0),
      coalesce(m.registrations, 0), coalesce(m.active_users, 0),
      coalesce(m.solved, 0), coalesce(m.failed, 0),
      private.format_rub(coalesce(m.solution_cost_kopecks + m.chat_cost_kopecks, 0)),
      coalesce(m.errors, 0),
      (select count(*) from private.fraud_flags where status = 'open'),
      (select count(*) from public.support_conversations where status = 'pending_owner')),
    jsonb_build_object('day', yesterday),
    'daily_summary:' || yesterday::text);
end;
$$;

revoke all on function private.enqueue_daily_summary() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Вызов функции на Vercel раз в минуту
-- ---------------------------------------------------------------------------

create table if not exists private.cron_tokens (
  token_hash text primary key,
  created_at timestamptz not null default now(),
  used_at timestamptz
);

alter table private.cron_tokens enable row level security;
revoke all on table private.cron_tokens from public, anon, authenticated;

create or replace function private.dispatch_admin_cron()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  token text := encode(extensions.gen_random_bytes(24), 'hex');
  summary_hour integer := private.setting_int('daily_summary_hour', 9);
begin
  delete from private.cron_tokens where created_at < now() - interval '1 hour';
  insert into private.cron_tokens (token_hash) values (encode(extensions.digest(token, 'sha256'), 'hex'));

  perform private.check_error_alerts();
  if extract(hour from now() at time zone 'Europe/Moscow') = summary_hour then
    perform private.enqueue_daily_summary();
  end if;

  perform net.http_post(
    url := 'https://homework-copilot-taupe.vercel.app/api/admin',
    body := jsonb_build_object('action', 'cron', 'token', token),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    timeout_milliseconds := 55000
  );
end;
$$;

revoke all on function private.dispatch_admin_cron() from public, anon, authenticated;

select cron.unschedule('admin-cron')
where exists (select 1 from cron.job where jobname = 'admin-cron');
select cron.schedule('admin-cron', '* * * * *', $job$ select private.dispatch_admin_cron(); $job$);

-- Функция на Vercel подтверждает токен и получает очередь уведомлений.
create or replace function public.claim_admin_cron(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed text;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  update private.cron_tokens
  set used_at = now()
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and used_at is null
    and created_at > now() - interval '5 minutes'
  returning token_hash into claimed;
  if claimed is null then
    raise exception 'invalid cron token' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'emails', coalesce((select value from private.app_settings where key = 'notify_emails'), '[]'::jsonb),
    'notifications', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', n.id, 'event', n.event, 'title', n.title, 'body', n.body, 'payload', n.payload,
        'telegram', n.want_telegram and n.telegram_sent_at is null,
        'email', n.want_email and n.email_sent_at is null,
        'createdAt', n.created_at
      ) order by n.created_at)
      from (
        select * from private.admin_notifications
        where ((want_telegram and telegram_sent_at is null) or (want_email and email_sent_at is null))
          and attempts < 5
          and created_at > now() - interval '1 day'
        order by created_at
        limit 30
      ) n
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.complete_admin_notifications(p_results jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  for item in select * from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) loop
    update private.admin_notifications
    set telegram_sent_at = case when (item ->> 'telegram')::boolean then now() else telegram_sent_at end,
        email_sent_at = case when (item ->> 'email')::boolean then now() else email_sent_at end,
        attempts = attempts + 1,
        last_error = nullif(left(coalesce(item ->> 'error', ''), 400), '')
    where id = (item ->> 'id')::uuid;
  end loop;
end;
$$;

-- Результат проверки внешнего сервиса. Переход в «лежит» и обратно
-- ставит уведомление.
create or replace function public.record_health_check(p_service text, p_ok boolean, p_status text, p_latency_ms integer default null, p_detail text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous private.health_checks%rowtype;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  select * into previous from private.health_checks where service = p_service;

  insert into private.health_checks as h (service, ok, status, latency_ms, detail, checked_at, last_ok_at, down_since)
  values (p_service, p_ok, left(p_status, 60), p_latency_ms, left(p_detail, 400), now(),
    case when p_ok then now() end, case when p_ok then null else now() end)
  on conflict (service) do update
  set ok = excluded.ok, status = excluded.status, latency_ms = excluded.latency_ms, detail = excluded.detail,
      checked_at = now(),
      last_ok_at = case when excluded.ok then now() else h.last_ok_at end,
      down_since = case when excluded.ok then null else coalesce(h.down_since, now()) end;

  insert into private.health_history (service, ok, latency_ms) values (p_service, p_ok, p_latency_ms);

  if previous.service is not null and previous.ok and not p_ok then
    perform private.notify_admin('service_down', format('%s не отвечает: %s', p_service, coalesce(p_detail, p_status)),
      jsonb_build_object('service', p_service));
  elsif previous.service is not null and not previous.ok and p_ok then
    perform private.notify_admin('service_down', format('%s снова работает (лежал с %s)', p_service, to_char(previous.down_since at time zone 'Europe/Moscow', 'DD.MM HH24:MI')),
      jsonb_build_object('service', p_service, 'recovered', true));
  end if;
end;
$$;

revoke all on function public.claim_admin_cron(text) from public, anon, authenticated;
grant execute on function public.claim_admin_cron(text) to service_role;
revoke all on function public.complete_admin_notifications(jsonb) from public, anon, authenticated;
grant execute on function public.complete_admin_notifications(jsonb) to service_role;
revoke all on function public.record_health_check(text, boolean, text, integer, text) from public, anon, authenticated;
grant execute on function public.record_health_check(text, boolean, text, integer, text) to service_role;

create or replace function public.admin_notifications_overview()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin('admin');
  return jsonb_build_object(
    'rules', coalesce((
      select jsonb_agg(jsonb_build_object('event', event, 'title', title, 'telegram', telegram, 'email', email) order by title)
      from private.admin_notification_rules
    ), '[]'::jsonb),
    'emails', coalesce((select value from private.app_settings where key = 'notify_emails'), '[]'::jsonb),
    'dailySummaryHour', private.setting_int('daily_summary_hour', 9),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', n.id, 'event', n.event, 'title', n.title, 'body', n.body, 'createdAt', n.created_at,
        'telegramSentAt', n.telegram_sent_at, 'emailSentAt', n.email_sent_at, 'wantTelegram', n.want_telegram,
        'wantEmail', n.want_email, 'attempts', n.attempts, 'lastError', n.last_error
      ) order by n.created_at desc)
      from (select * from private.admin_notifications order by created_at desc limit 50) n
    ), '[]'::jsonb),
    'lastCron', (
      select jsonb_build_object('status', r.status, 'startedAt', r.start_time, 'message', left(r.return_message, 200))
      from cron.job_run_details r join cron.job j on j.jobid = r.jobid
      where j.jobname = 'admin-cron' order by r.start_time desc limit 1
    ),
    'lastDelivery', (select max(greatest(telegram_sent_at, email_sent_at)) from private.admin_notifications)
  );
end;
$$;

create or replace function public.admin_notification_rule_save(p_event text, p_telegram boolean, p_email boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous private.admin_notification_rules%rowtype;
begin
  perform private.require_admin('admin');
  select * into previous from private.admin_notification_rules where event = p_event for update;
  if previous.event is null then
    raise exception 'unknown notification event' using errcode = 'P0002';
  end if;
  update private.admin_notification_rules set telegram = p_telegram, email = p_email, updated_at = now() where event = p_event;
  perform private.audit('notification_rule_saved', null, jsonb_build_object('event', p_event),
    jsonb_build_object('telegram', previous.telegram, 'email', previous.email), jsonb_build_object('telegram', p_telegram, 'email', p_email));
  return jsonb_build_object('event', p_event);
end;
$$;

create or replace function public.admin_notification_test()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin('admin');
begin
  insert into private.admin_notifications (event, title, body, want_telegram, want_email)
  values ('daily_summary', 'Проверка уведомлений',
    format('Тестовое уведомление из админки от %s в %s', (select email from auth.users where id = actor), to_char(now() at time zone 'Europe/Moscow', 'DD.MM HH24:MI')),
    true, true);
  return jsonb_build_object('queued', true);
end;
$$;

revoke all on function public.admin_notifications_overview() from public, anon;
grant execute on function public.admin_notifications_overview() to authenticated;
revoke all on function public.admin_notification_rule_save(text, boolean, boolean) from public, anon;
grant execute on function public.admin_notification_rule_save(text, boolean, boolean) to authenticated;
revoke all on function public.admin_notification_test() from public, anon;
grant execute on function public.admin_notification_test() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Уборка служебных таблиц
-- ---------------------------------------------------------------------------

create or replace function private.purge_admin_service_rows()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.admin_signals where created_at < now() - interval '1 day';
  delete from private.admin_notifications where created_at < now() - interval '30 days';
  delete from private.health_history where checked_at < now() - interval '30 days';
  delete from private.promo_attempts where created_at < now() - interval '7 days';
  delete from private.admin_request_log where created_at < now() - interval '90 days';
$$;

revoke all on function private.purge_admin_service_rows() from public, anon, authenticated;

select cron.unschedule('purge-admin-service-rows')
where exists (select 1 from cron.job where jobname = 'purge-admin-service-rows');
select cron.schedule('purge-admin-service-rows', '37 3 * * *', $job$ select private.purge_admin_service_rows(); $job$);
