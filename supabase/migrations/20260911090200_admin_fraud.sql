-- Антифрод: только помечает, решает всегда администратор.
--
-- Восемь детекторов из ТЗ, каждый с порогом, который меняется из админки.
-- Детектор кладёт флаг с объяснением «почему сработало» и уликами; повторный
-- прогон обновляет улики открытого флага, а не заводит второй. «Ок, не фрод»
-- снимает флаг и записывает исключение - по этому правилу пользователя
-- больше не трогаем. Автобана нет.

-- ---------------------------------------------------------------------------
-- 1. Возвраты пополнений (нужны детекторам 7 и 8; финансовый раздел пишет сюда же)
-- ---------------------------------------------------------------------------

create table if not exists private.top_up_refunds (
  id uuid primary key default gen_random_uuid(),
  top_up_id uuid not null references private.verified_balance_top_ups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  amount integer not null check (amount > 0),
  reason text not null check (char_length(reason) between 3 and 300),
  wallet_entry_id uuid references public.wallet_entries(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists top_up_refunds_user_idx on private.top_up_refunds (user_id, created_at desc);
create index if not exists top_up_refunds_created_idx on private.top_up_refunds (created_at desc);
alter table private.top_up_refunds enable row level security;
revoke all on table private.top_up_refunds from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Правила, флаги, исключения, белый список, одноразовые домены
-- ---------------------------------------------------------------------------

create table if not exists private.fraud_rules (
  id text primary key,
  title text not null,
  description text not null,
  enabled boolean not null default true,
  threshold numeric not null,
  window_hours integer not null default 24,
  risk text not null default 'medium',
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint fraud_rules_risk_known check (risk in ('low', 'medium', 'high'))
);

insert into private.fraud_rules (id, title, description, threshold, window_hours, risk) values
  ('ip_accounts', 'Аккаунты с одного IP', 'Столько и больше аккаунтов зашли с одного адреса за окно.', 3, 24, 'medium'),
  ('device_accounts', 'Аккаунты с одного устройства', 'Столько и больше аккаунтов с одной меткой браузера.', 2, 720, 'high'),
  ('email_pattern', 'Одинаковый шаблон почты', 'Столько и больше адресов вида имя+1@, имя+2@ на одном ящике.', 2, 720, 'medium'),
  ('temp_mail', 'Одноразовая почта', 'Домен из списка временных ящиков. Порог не используется.', 1, 720, 'low'),
  ('fast_free_spend', 'Быстро сожгли стартовые', 'Стартовый баланс потрачен за столько минут после регистрации и быстрее.', 60, 24, 'medium'),
  ('duplicate_task_text', 'Одна задача с разных аккаунтов', 'Одно и то же условие пришло со стольких аккаунтов за окно.', 3, 72, 'medium'),
  ('refunds', 'Возвраты', 'Столько и больше возвратов за окно.', 3, 168, 'high'),
  ('pay_use_refund', 'Оплата → использование → возврат', 'Пополнил, решил столько и больше задач, потом возврат - за окно.', 3, 168, 'high')
on conflict (id) do nothing;

create table if not exists private.fraud_flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  rule_id text not null references private.fraud_rules(id) on delete cascade,
  risk text not null,
  explanation text not null,
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid,
  deferred_until timestamptz,
  constraint fraud_flags_risk_known check (risk in ('low', 'medium', 'high')),
  constraint fraud_flags_status_known check (status in ('open', 'dismissed', 'banned', 'limited', 'deferred'))
);

create unique index if not exists fraud_flags_open_idx
  on private.fraud_flags (user_id, rule_id)
  where status in ('open', 'deferred');
create index if not exists fraud_flags_status_idx on private.fraud_flags (status, risk, created_at desc);
create index if not exists fraud_flags_user_idx on private.fraud_flags (user_id, created_at desc);

create table if not exists private.fraud_exceptions (
  user_id uuid not null references auth.users(id) on delete cascade,
  rule_id text not null references private.fraud_rules(id) on delete cascade,
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (user_id, rule_id)
);

create table if not exists private.fraud_whitelist (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  value text not null,
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint fraud_whitelist_kind_known check (kind in ('ip', 'email_domain', 'user')),
  unique (kind, value)
);

create table if not exists private.temp_mail_domains (
  domain text primary key
);

insert into private.temp_mail_domains (domain) values
  ('10minutemail.com'), ('10minutemail.net'), ('20minutemail.com'), ('guerrillamail.com'), ('guerrillamail.net'),
  ('guerrillamail.org'), ('sharklasers.com'), ('grr.la'), ('mailinator.com'), ('maildrop.cc'), ('yopmail.com'),
  ('yopmail.fr'), ('temp-mail.org'), ('temp-mail.io'), ('tempmail.com'), ('tempmail.net'), ('tempail.com'),
  ('throwawaymail.com'), ('trashmail.com'), ('trashmail.de'), ('getnada.com'), ('nada.email'), ('dispostable.com'),
  ('mintemail.com'), ('mohmal.com'), ('emailondeck.com'), ('fakeinbox.com'), ('mailnesia.com'), ('mytemp.email'),
  ('tempr.email'), ('discard.email'), ('spamgourmet.com'), ('mailcatch.com'), ('inboxkitten.com'), ('burnermail.io'),
  ('crazymailing.com'), ('tempinbox.com'), ('mailtemp.net'), ('dropmail.me'), ('harakirimail.com'), ('mail-temp.com'),
  ('luxusmail.org'), ('cool.fr.nf'), ('jetable.org'), ('spam4.me'), ('tmpmail.net'), ('tmpmail.org'), ('moakt.com'),
  ('mailsac.com'), ('mail7.io'), ('temp-mail.ru'), ('tempmail.ru'), ('mailforspam.com'), ('spambox.us'),
  ('mailexpire.com'), ('incognitomail.org'), ('anonbox.net'), ('tempmailo.com'), ('emailfake.com'), ('generator.email')
on conflict do nothing;

alter table private.fraud_rules enable row level security;
alter table private.fraud_flags enable row level security;
alter table private.fraud_exceptions enable row level security;
alter table private.fraud_whitelist enable row level security;
alter table private.temp_mail_domains enable row level security;
revoke all on table private.fraud_rules, private.fraud_flags, private.fraud_exceptions, private.fraud_whitelist, private.temp_mail_domains
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Постановка флага
-- ---------------------------------------------------------------------------

create or replace function private.raise_fraud_flag(
  p_user_id uuid,
  p_rule_id text,
  p_explanation text,
  p_evidence jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  rule private.fraud_rules%rowtype;
  inserted boolean := false;
begin
  select * into rule from private.fraud_rules where id = p_rule_id;
  if rule.id is null or not rule.enabled then
    return false;
  end if;
  if exists (select 1 from private.fraud_exceptions where user_id = p_user_id and rule_id = p_rule_id) then
    return false;
  end if;
  if exists (select 1 from private.fraud_whitelist where kind = 'user' and value = p_user_id::text) then
    return false;
  end if;
  if exists (select 1 from private.admin_users where user_id = p_user_id) then
    return false;
  end if;

  insert into private.fraud_flags as f (user_id, rule_id, risk, explanation, evidence)
  values (p_user_id, p_rule_id, rule.risk, left(p_explanation, 1000), coalesce(p_evidence, '{}'::jsonb))
  on conflict (user_id, rule_id) where status in ('open', 'deferred') do update
  set explanation = excluded.explanation,
      evidence = excluded.evidence,
      updated_at = now(),
      -- Отложенный флаг с новыми уликами снова открыт, если срок вышел.
      status = case
        when f.status = 'deferred' and f.deferred_until < now() then 'open'
        else f.status
      end
  returning (xmax = 0) into inserted;

  return inserted;
end;
$$;

revoke all on function private.raise_fraud_flag(uuid, text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Детекторы
-- ---------------------------------------------------------------------------

create or replace function private.run_fraud_detectors()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  rule private.fraud_rules%rowtype;
  raised integer := 0;
  row_record record;
  welcome integer := 2000;
begin
  -- 1. N+ аккаунтов с одного IP за окно
  select * into rule from private.fraud_rules where id = 'ip_accounts';
  if rule.enabled then
    for row_record in
      select d.ip, array_agg(distinct d.user_id) as users, array_agg(distinct u.email) as emails
      from private.user_devices d
      join auth.users u on u.id = d.user_id
      where d.user_id is not null
        and d.ip is not null
        and d.first_seen_at > now() - make_interval(hours => rule.window_hours)
        and u.created_at > now() - make_interval(hours => rule.window_hours)
        and not exists (select 1 from private.fraud_whitelist w where w.kind = 'ip' and w.value = d.ip)
      group by d.ip
      having count(distinct d.user_id) >= rule.threshold
    loop
      raised := raised + (
        select count(*) from unnest(row_record.users) as uid
        where private.raise_fraud_flag(
          uid, 'ip_accounts',
          format('С адреса %s за %s ч зарегистрировано %s аккаунтов', row_record.ip, rule.window_hours, array_length(row_record.users, 1)),
          jsonb_build_object('ip', row_record.ip, 'users', to_jsonb(row_record.users), 'emails', to_jsonb(row_record.emails))
        )
      );
    end loop;
  end if;

  -- 2. N+ аккаунтов с одной метки устройства
  select * into rule from private.fraud_rules where id = 'device_accounts';
  if rule.enabled then
    for row_record in
      with by_device as (
        select device_id, user_id from public.homework_jobs where user_id is not null and device_id <> '' and created_at > now() - make_interval(hours => rule.window_hours)
        union
        select device_id, user_id from private.user_devices where user_id is not null and device_id is not null and last_seen_at > now() - make_interval(hours => rule.window_hours)
        union
        select device_id, user_id from private.welcome_grants where created_at > now() - make_interval(hours => rule.window_hours)
      )
      select device_id, array_agg(distinct user_id) as users
      from by_device
      group by device_id
      having count(distinct user_id) >= rule.threshold
    loop
      raised := raised + (
        select count(*) from unnest(row_record.users) as uid
        where private.raise_fraud_flag(
          uid, 'device_accounts',
          format('С одной метки браузера работают %s аккаунтов', array_length(row_record.users, 1)),
          jsonb_build_object('deviceId', row_record.device_id, 'users', to_jsonb(row_record.users))
        )
      );
    end loop;
  end if;

  -- 3. Одинаковый паттерн почты: имя+1@, имя+2@
  select * into rule from private.fraud_rules where id = 'email_pattern';
  if rule.enabled then
    for row_record in
      select lower(regexp_replace(split_part(email, '@', 1), '\+.*$', '')) || '@' || lower(split_part(email, '@', 2)) as base,
             array_agg(id) as users, array_agg(email) as emails
      from auth.users
      where email ~ '\+[^@]+@'
        and created_at > now() - make_interval(hours => rule.window_hours)
      group by 1
      having count(*) >= rule.threshold
    loop
      raised := raised + (
        select count(*) from unnest(row_record.users) as uid
        where private.raise_fraud_flag(
          uid, 'email_pattern',
          format('Ящик %s заведён %s раз с суффиксами «+»', row_record.base, array_length(row_record.users, 1)),
          jsonb_build_object('base', row_record.base, 'emails', to_jsonb(row_record.emails), 'users', to_jsonb(row_record.users))
        )
      );
    end loop;
  end if;

  -- 4. Одноразовые домены
  select * into rule from private.fraud_rules where id = 'temp_mail';
  if rule.enabled then
    for row_record in
      select u.id, u.email, lower(split_part(u.email, '@', 2)) as domain
      from auth.users u
      where lower(split_part(u.email, '@', 2)) in (select domain from private.temp_mail_domains)
        and not exists (select 1 from private.fraud_whitelist w where w.kind = 'email_domain' and w.value = lower(split_part(u.email, '@', 2)))
        and u.created_at > now() - make_interval(hours => rule.window_hours)
    loop
      if private.raise_fraud_flag(
        row_record.id, 'temp_mail',
        format('Почта на одноразовом домене %s', row_record.domain),
        jsonb_build_object('email', row_record.email, 'domain', row_record.domain)
      ) then raised := raised + 1; end if;
    end loop;
  end if;

  -- 5. Стартовый баланс сожжён быстро
  select * into rule from private.fraud_rules where id = 'fast_free_spend';
  if rule.enabled then
    for row_record in
      select p.id, p.created_at, sum(-we.amount) as spent, max(we.created_at) as last_debit
      from public.profiles p
      join public.wallet_entries we on we.user_id = p.id and we.kind = 'debit'
        and we.created_at <= p.created_at + make_interval(mins => rule.threshold::integer)
      where p.created_at > now() - make_interval(hours => rule.window_hours)
        and not exists (select 1 from private.verified_balance_top_ups t where t.user_id = p.id)
      group by p.id, p.created_at
      having sum(-we.amount) >= welcome
    loop
      if private.raise_fraud_flag(
        row_record.id, 'fast_free_spend',
        format('Стартовые %s ₽ потрачены за %s мин после регистрации', welcome / 100, greatest(1, extract(epoch from (row_record.last_debit - row_record.created_at))::integer / 60)),
        jsonb_build_object('spentKopecks', row_record.spent, 'registeredAt', row_record.created_at, 'lastDebitAt', row_record.last_debit)
      ) then raised := raised + 1; end if;
    end loop;
  end if;

  -- 6. Одно условие с разных аккаунтов
  select * into rule from private.fraud_rules where id = 'duplicate_task_text';
  if rule.enabled then
    for row_record in
      select lower(regexp_replace(condition_preview, '\s+', ' ', 'g')) as text_key,
             array_agg(distinct user_id) as users, min(condition_preview) as sample
      from public.homework_jobs
      where user_id is not null
        and char_length(condition_preview) >= 40
        and created_at > now() - make_interval(hours => rule.window_hours)
      group by 1
      having count(distinct user_id) >= rule.threshold
    loop
      raised := raised + (
        select count(*) from unnest(row_record.users) as uid
        where private.raise_fraud_flag(
          uid, 'duplicate_task_text',
          format('Одно и то же условие прислали %s аккаунтов: «%s…»', array_length(row_record.users, 1), left(row_record.sample, 80)),
          jsonb_build_object('users', to_jsonb(row_record.users), 'condition', left(row_record.sample, 400))
        )
      );
    end loop;
  end if;

  -- 7. Возвраты
  select * into rule from private.fraud_rules where id = 'refunds';
  if rule.enabled then
    for row_record in
      with refunds as (
        select user_id, created_at, 'top_up' as kind from private.top_up_refunds
        union all
        select user_id, created_at, 'solution' from public.wallet_entries where kind = 'credit' and idempotency_key like '%:refund'
      )
      select user_id, count(*) as total, sum((kind = 'top_up')::integer) as top_up_refunds
      from refunds
      where created_at > now() - make_interval(hours => rule.window_hours)
      group by user_id
      having count(*) >= rule.threshold
    loop
      if private.raise_fraud_flag(
        row_record.user_id, 'refunds',
        format('%s возвратов за %s ч, из них %s по пополнениям', row_record.total, rule.window_hours, row_record.top_up_refunds),
        jsonb_build_object('refunds', row_record.total, 'topUpRefunds', row_record.top_up_refunds)
      ) then raised := raised + 1; end if;
    end loop;
  end if;

  -- 8. Регистрация → оплата → массовое использование → возврат
  select * into rule from private.fraud_rules where id = 'pay_use_refund';
  if rule.enabled then
    for row_record in
      select r.user_id, r.created_at as refunded_at, t.created_at as paid_at,
             (select count(*) from public.homework_jobs j where j.user_id = r.user_id and j.status = 'done' and j.created_at between t.created_at and r.created_at) as solved
      from private.top_up_refunds r
      join private.verified_balance_top_ups t on t.id = r.top_up_id
      where r.created_at > now() - make_interval(hours => rule.window_hours)
    loop
      if row_record.solved >= rule.threshold then
        if private.raise_fraud_flag(
          row_record.user_id, 'pay_use_refund',
          format('Пополнил, решил %s задач и получил возврат', row_record.solved),
          jsonb_build_object('paidAt', row_record.paid_at, 'refundedAt', row_record.refunded_at, 'solved', row_record.solved)
        ) then raised := raised + 1; end if;
      end if;
    end loop;
  end if;

  update private.fraud_flags
  set status = 'open', updated_at = now()
  where status = 'deferred' and deferred_until < now();

  return jsonb_build_object('raised', raised, 'ranAt', now());
end;
$$;

revoke all on function private.run_fraud_detectors() from public, anon, authenticated;

select cron.unschedule('run-fraud-detectors')
where exists (select 1 from cron.job where jobname = 'run-fraud-detectors');
select cron.schedule('run-fraud-detectors', '*/15 * * * *', $job$ select private.run_fraud_detectors(); $job$);

-- ---------------------------------------------------------------------------
-- 5. Ограничение лимита и срок бана в account_controls
-- ---------------------------------------------------------------------------

alter table public.account_controls
  add column if not exists banned_until timestamptz,
  add column if not exists daily_solve_limit integer,
  add column if not exists limit_reason text;

alter table public.account_controls
  drop constraint if exists account_controls_daily_limit_range;
alter table public.account_controls
  add constraint account_controls_daily_limit_range check (daily_solve_limit is null or daily_solve_limit between 0 and 1000);

-- Бан со сроком: после срока аккаунт открыт, даже если строку ещё не сняли.
create or replace function private.assert_account_not_banned(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.account_controls
    where user_id = p_user_id
      and is_banned
      and (banned_until is null or banned_until > now())
  ) then
    raise exception 'account is blocked' using errcode = '42501';
  end if;
end;
$$;

create or replace function private.lift_expired_bans()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  lifted integer := 0;
  row_record record;
begin
  for row_record in
    select user_id, ban_reason, banned_until
    from public.account_controls
    where is_banned and banned_until is not null and banned_until <= now()
  loop
    update public.account_controls
    set is_banned = false, ban_reason = null, banned_at = null, banned_by = null, banned_until = null, updated_at = now()
    where user_id = row_record.user_id;
    insert into private.admin_audit_log (actor_id, target_user_id, event_type, payload, before_value, after_value)
    values (null, row_record.user_id, 'user_unbanned', jsonb_build_object('reason', 'срок блокировки вышел', 'system', true),
      jsonb_build_object('isBanned', true, 'reason', row_record.ban_reason, 'until', row_record.banned_until),
      jsonb_build_object('isBanned', false));
    lifted := lifted + 1;
  end loop;
  return lifted;
end;
$$;

revoke all on function private.lift_expired_bans() from public, anon, authenticated;

select cron.unschedule('lift-expired-bans')
where exists (select 1 from cron.job where jobname = 'lift-expired-bans');
select cron.schedule('lift-expired-bans', '*/10 * * * *', $job$ select private.lift_expired_bans(); $job$);

-- ---------------------------------------------------------------------------
-- 6. Админ-RPC антифрода
-- ---------------------------------------------------------------------------

create or replace function public.admin_fraud_overview(
  p_status text default 'open',
  p_risk text default null,
  p_page integer default 1,
  p_page_size integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_size integer := greatest(1, least(coalesce(p_page_size, 50), 200));
  safe_page integer := greatest(1, coalesce(p_page, 1));
  total integer;
begin
  perform private.require_admin('admin');

  select count(*) into total
  from private.fraud_flags f
  where (p_status is null or p_status = 'all' or f.status = p_status)
    and (p_risk is null or f.risk = p_risk);

  return jsonb_build_object(
    'total', total,
    'page', safe_page,
    'pageSize', safe_size,
    'counts', (
      select jsonb_build_object(
        'open', count(*) filter (where status = 'open'),
        'high', count(*) filter (where status = 'open' and risk = 'high'),
        'deferred', count(*) filter (where status = 'deferred')
      ) from private.fraud_flags
    ),
    'rules', (
      select jsonb_agg(jsonb_build_object(
        'id', id, 'title', title, 'description', description, 'enabled', enabled,
        'threshold', threshold, 'windowHours', window_hours, 'risk', risk, 'updatedAt', updated_at
      ) order by id) from private.fraud_rules
    ),
    'whitelist', (
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'value', value, 'note', note, 'createdAt', created_at) order by created_at desc), '[]'::jsonb)
      from private.fraud_whitelist
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id,
        'userId', f.user_id,
        'email', u.email,
        'fullName', p.full_name,
        'ruleId', f.rule_id,
        'ruleTitle', r.title,
        'risk', f.risk,
        'explanation', f.explanation,
        'evidence', f.evidence,
        'status', f.status,
        'createdAt', f.created_at,
        'updatedAt', f.updated_at,
        'deferredUntil', f.deferred_until,
        'isBanned', coalesce(ac.is_banned, false),
        'balance', coalesce(w.balance, 0)
      ) order by case f.risk when 'high' then 3 when 'medium' then 2 else 1 end desc, f.updated_at desc)
      from (
        select *
        from private.fraud_flags f
        where (p_status is null or p_status = 'all' or f.status = p_status)
          and (p_risk is null or f.risk = p_risk)
        order by case f.risk when 'high' then 3 when 'medium' then 2 else 1 end desc, f.updated_at desc
        limit safe_size offset (safe_page - 1) * safe_size
      ) f
      join auth.users u on u.id = f.user_id
      join private.fraud_rules r on r.id = f.rule_id
      left join public.profiles p on p.id = f.user_id
      left join public.account_controls ac on ac.user_id = f.user_id
      left join public.wallet_accounts w on w.user_id = f.user_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_fraud_decide(
  p_flag_id uuid,
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin('admin');
  flag private.fraud_flags%rowtype;
  reason text := left(trim(coalesce(p_payload ->> 'reason', '')), 500);
  next_status text;
  limit_value integer;
  defer_days integer;
begin
  select * into flag from private.fraud_flags where id = p_flag_id for update;
  if flag.id is null then
    raise exception 'flag not found' using errcode = 'P0002';
  end if;

  if p_action = 'clear' then
    next_status := 'dismissed';
    insert into private.fraud_exceptions (user_id, rule_id, created_by)
    values (flag.user_id, flag.rule_id, actor)
    on conflict do nothing;
  elsif p_action = 'ban' then
    if char_length(reason) < 3 then reason := 'Антифрод: ' || flag.explanation; end if;
    perform public.admin_set_user_ban(flag.user_id, true, left(reason, 500));
    next_status := 'banned';
  elsif p_action = 'limit' then
    limit_value := coalesce((p_payload ->> 'limit')::integer, 5);
    if limit_value not between 0 and 1000 then
      raise exception 'limit must be between 0 and 1000' using errcode = '22023';
    end if;
    insert into public.account_controls (user_id, daily_solve_limit, limit_reason, updated_at)
    values (flag.user_id, limit_value, coalesce(nullif(reason, ''), flag.explanation), now())
    on conflict (user_id) do update
    set daily_solve_limit = excluded.daily_solve_limit, limit_reason = excluded.limit_reason, updated_at = now();
    next_status := 'limited';
  elsif p_action = 'defer' then
    defer_days := greatest(1, least(coalesce((p_payload ->> 'days')::integer, 7), 90));
    next_status := 'deferred';
  else
    raise exception 'unknown fraud action' using errcode = '22023';
  end if;

  update private.fraud_flags
  set status = next_status,
      decided_at = now(),
      decided_by = actor,
      updated_at = now(),
      deferred_until = case when next_status = 'deferred' then now() + make_interval(days => defer_days) else null end
  where id = p_flag_id;

  perform private.audit(
    'fraud_flag_decided',
    flag.user_id,
    jsonb_build_object('flagId', p_flag_id, 'ruleId', flag.rule_id, 'action', p_action, 'reason', reason, 'limit', limit_value, 'days', defer_days),
    jsonb_build_object('status', flag.status),
    jsonb_build_object('status', next_status)
  );

  return jsonb_build_object('flagId', p_flag_id, 'status', next_status);
end;
$$;

create or replace function public.admin_fraud_update_rule(
  p_rule_id text,
  p_enabled boolean,
  p_threshold numeric,
  p_window_hours integer,
  p_risk text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin('admin');
  previous private.fraud_rules%rowtype;
begin
  select * into previous from private.fraud_rules where id = p_rule_id for update;
  if previous.id is null then
    raise exception 'rule not found' using errcode = 'P0002';
  end if;
  if p_risk not in ('low', 'medium', 'high') then
    raise exception 'unknown risk' using errcode = '22023';
  end if;
  if p_threshold is null or p_threshold < 0 or p_window_hours is null or p_window_hours not between 1 and 8760 then
    raise exception 'invalid rule parameters' using errcode = '22023';
  end if;

  update private.fraud_rules
  set enabled = coalesce(p_enabled, enabled),
      threshold = p_threshold,
      window_hours = p_window_hours,
      risk = p_risk,
      updated_at = now(),
      updated_by = actor
  where id = p_rule_id;

  perform private.audit(
    'fraud_rule_updated', null,
    jsonb_build_object('ruleId', p_rule_id),
    jsonb_build_object('enabled', previous.enabled, 'threshold', previous.threshold, 'windowHours', previous.window_hours, 'risk', previous.risk),
    jsonb_build_object('enabled', p_enabled, 'threshold', p_threshold, 'windowHours', p_window_hours, 'risk', p_risk)
  );

  return jsonb_build_object('ruleId', p_rule_id);
end;
$$;

create or replace function public.admin_fraud_whitelist(
  p_action text,
  p_kind text default null,
  p_value text default null,
  p_note text default null,
  p_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin('admin');
  removed private.fraud_whitelist%rowtype;
  normalized text := lower(trim(coalesce(p_value, '')));
begin
  if p_action = 'add' then
    if p_kind not in ('ip', 'email_domain', 'user') or char_length(normalized) not between 2 and 200 then
      raise exception 'invalid whitelist entry' using errcode = '22023';
    end if;
    insert into private.fraud_whitelist (kind, value, note, created_by)
    values (p_kind, normalized, nullif(left(trim(coalesce(p_note, '')), 200), ''), actor)
    on conflict (kind, value) do update set note = excluded.note;
    -- Открытые флаги, которые держались только на этом адресе, закрываем.
    if p_kind = 'ip' then
      update private.fraud_flags
      set status = 'dismissed', decided_at = now(), decided_by = actor, updated_at = now()
      where status in ('open', 'deferred') and rule_id = 'ip_accounts' and evidence ->> 'ip' = normalized;
    end if;
    perform private.audit('fraud_whitelist_added', null, jsonb_build_object('kind', p_kind, 'value', normalized, 'note', p_note));
    return jsonb_build_object('added', true);
  elsif p_action = 'remove' then
    delete from private.fraud_whitelist where id = p_id returning * into removed;
    perform private.audit('fraud_whitelist_removed', null, jsonb_build_object('kind', removed.kind, 'value', removed.value));
    return jsonb_build_object('removed', removed.id is not null);
  end if;
  raise exception 'unknown whitelist action' using errcode = '22023';
end;
$$;

create or replace function public.admin_fraud_run_now()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin('admin');
  return private.run_fraud_detectors();
end;
$$;

-- Граф связей: аккаунты, соединённые общим адресом или меткой устройства.
create or replace function public.admin_fraud_graph(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  frontier uuid[] := array[p_user_id];
  seen uuid[] := array[p_user_id];
  depth integer := 0;
  next_frontier uuid[];
  edges jsonb := '[]'::jsonb;
  new_edges jsonb;
begin
  perform private.require_admin('admin');

  while depth < 2 and coalesce(array_length(frontier, 1), 0) > 0 loop
    with links as (
      select a.user_id as source, b.user_id as target, 'ip' as kind, a.ip as value
      from private.user_devices a
      join private.user_devices b on b.ip = a.ip and b.user_id is not null and b.user_id <> a.user_id
      where a.user_id = any(frontier) and a.ip is not null
        and not exists (select 1 from private.fraud_whitelist w where w.kind = 'ip' and w.value = a.ip)
      union
      select a.user_id, b.user_id, 'device', a.device_id
      from (
        select user_id, device_id from public.homework_jobs where user_id is not null and device_id <> ''
        union select user_id, device_id from private.user_devices where user_id is not null and device_id is not null
        union select user_id, device_id from private.welcome_grants
      ) a
      join (
        select user_id, device_id from public.homework_jobs where user_id is not null and device_id <> ''
        union select user_id, device_id from private.user_devices where user_id is not null and device_id is not null
        union select user_id, device_id from private.welcome_grants
      ) b on b.device_id = a.device_id and b.user_id <> a.user_id
      where a.user_id = any(frontier)
    ),
    limited as (select * from links limit 400)
    select coalesce(jsonb_agg(jsonb_build_object('source', source, 'target', target, 'kind', kind, 'value', value)), '[]'::jsonb),
           coalesce(array_agg(distinct target) filter (where not (target = any(seen))), array[]::uuid[])
    into new_edges, next_frontier
    from limited;

    edges := edges || new_edges;
    seen := seen || next_frontier;
    frontier := next_frontier;
    depth := depth + 1;
  end loop;

  edges := coalesce((select jsonb_agg(distinct e) from jsonb_array_elements(edges) e), '[]'::jsonb);

  return jsonb_build_object(
    'root', p_user_id,
    'nodes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', u.id, 'email', u.email, 'fullName', p.full_name, 'createdAt', u.created_at,
        'isBanned', coalesce(ac.is_banned, false),
        'flags', (select count(*) from private.fraud_flags f where f.user_id = u.id and f.status = 'open'),
        'balance', coalesce(w.balance, 0)
      ))
      from unnest(seen) as s(node_id)
      join auth.users u on u.id = s.node_id
      left join public.profiles p on p.id = u.id
      left join public.account_controls ac on ac.user_id = u.id
      left join public.wallet_accounts w on w.user_id = u.id
    ), '[]'::jsonb),
    'edges', edges
  );
end;
$$;

revoke all on function public.admin_fraud_overview(text, text, integer, integer) from public, anon;
grant execute on function public.admin_fraud_overview(text, text, integer, integer) to authenticated;
revoke all on function public.admin_fraud_decide(uuid, text, jsonb) from public, anon;
grant execute on function public.admin_fraud_decide(uuid, text, jsonb) to authenticated;
revoke all on function public.admin_fraud_update_rule(text, boolean, numeric, integer, text) from public, anon;
grant execute on function public.admin_fraud_update_rule(text, boolean, numeric, integer, text) to authenticated;
revoke all on function public.admin_fraud_whitelist(text, text, text, text, uuid) from public, anon;
grant execute on function public.admin_fraud_whitelist(text, text, text, text, uuid) to authenticated;
revoke all on function public.admin_fraud_run_now() from public, anon;
grant execute on function public.admin_fraud_run_now() to authenticated;
revoke all on function public.admin_fraud_graph(uuid) from public, anon;
grant execute on function public.admin_fraud_graph(uuid) to authenticated;
