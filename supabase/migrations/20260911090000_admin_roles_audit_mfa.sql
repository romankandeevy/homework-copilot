-- Админка: роли, обязательная 2FA, аудит «кто, что, старое → новое, IP»,
-- журнал всех обращений к админ-RPC и предел частоты на них.
--
-- До этого админ был один и без роли: private.admin_users хранила только
-- факт доступа. Теперь три роли:
--   owner   - всё;
--   admin   - всё, кроме удаления данных и денежных выплат (возвраты);
--   support - только обращения и просмотр карточки пользователя.
--
-- 2FA: вход в /admin требует уровня aal2. Проверяется в базе, а не только
-- в интерфейсе: без второго фактора admin-RPC отвечают отказом. Фактор
-- заводится через Supabase MFA (TOTP) прямо из админки.

-- ---------------------------------------------------------------------------
-- 1. Роли
-- ---------------------------------------------------------------------------

alter table private.admin_users
  add column if not exists role text not null default 'owner';

alter table private.admin_users
  drop constraint if exists admin_users_role_known;
alter table private.admin_users
  add constraint admin_users_role_known check (role in ('owner', 'admin', 'support'));

create or replace function private.admin_role_rank(p_role text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'owner' then 3
    when 'admin' then 2
    when 'support' then 1
    else 0
  end;
$$;

revoke all on function private.admin_role_rank(text) from public, anon, authenticated;

create or replace function private.current_admin_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role
  from private.admin_users
  where user_id = (select auth.uid());
$$;

revoke all on function private.current_admin_role() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Уровень подтверждения сессии (aal) и наличие второго фактора
-- ---------------------------------------------------------------------------

create or replace function private.current_aal()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal',
    'aal1'
  );
$$;

revoke all on function private.current_aal() from public, anon, authenticated;

create or replace function private.has_verified_mfa(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.mfa_factors
    where user_id = p_user_id
      and status = 'verified'
  );
$$;

revoke all on function private.has_verified_mfa(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Адрес и путь текущего запроса (PostgREST кладёт их в GUC)
-- ---------------------------------------------------------------------------

create or replace function private.request_ip()
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  headers jsonb;
  forwarded text;
begin
  begin
    headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    return null;
  end;
  if headers is null then
    return null;
  end if;
  forwarded := coalesce(headers ->> 'x-client-ip', headers ->> 'x-forwarded-for', headers ->> 'x-real-ip', headers ->> 'cf-connecting-ip');
  if forwarded is null then
    return null;
  end if;
  return left(trim(split_part(forwarded, ',', 1)), 64);
end;
$$;

revoke all on function private.request_ip() from public, anon, authenticated;

create or replace function private.request_user_agent()
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  headers jsonb;
begin
  begin
    headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    return null;
  end;
  return left(headers ->> 'user-agent', 400);
end;
$$;

revoke all on function private.request_user_agent() from public, anon, authenticated;

create or replace function private.request_path()
returns text
language sql
stable
set search_path = ''
as $$
  select left(coalesce(nullif(current_setting('request.path', true), ''), ''), 200);
$$;

revoke all on function private.request_path() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Журнал обращений к админ-API и предел частоты
-- ---------------------------------------------------------------------------

create table if not exists private.admin_request_log (
  id bigint generated always as identity primary key,
  actor_id uuid not null,
  role text not null,
  path text not null default '',
  ip text,
  created_at timestamptz not null default now()
);

create index if not exists admin_request_log_actor_created_idx
  on private.admin_request_log (actor_id, created_at desc);
create index if not exists admin_request_log_created_idx
  on private.admin_request_log (created_at desc);

alter table private.admin_request_log enable row level security;
revoke all on table private.admin_request_log from public, anon, authenticated;

-- 240 обращений в минуту на одного администратора. Живой человек в
-- интерфейсе делает пять-десять; двести сорок - это скрипт, а не работа.
create or replace function private.require_admin(p_min_role text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_role_name text;
  recent integer;
begin
  if current_user_id is null then
    raise exception 'admin access required' using errcode = '42501';
  end if;

  select role into current_role_name
  from private.admin_users
  where user_id = current_user_id;

  if current_role_name is null then
    raise exception 'admin access required' using errcode = '42501';
  end if;

  -- Второй фактор обязателен: без него роль ничего не открывает.
  if not private.has_verified_mfa(current_user_id) then
    raise exception 'admin mfa enrollment required' using errcode = '42501';
  end if;
  if private.current_aal() <> 'aal2' then
    raise exception 'admin mfa verification required' using errcode = '42501';
  end if;

  if private.admin_role_rank(current_role_name) < private.admin_role_rank(p_min_role) then
    raise exception 'admin role insufficient' using errcode = '42501';
  end if;

  select count(*) into recent
  from private.admin_request_log
  where actor_id = current_user_id
    and created_at > now() - interval '1 minute';
  if recent >= 240 then
    raise exception 'admin rate limit exceeded' using errcode = '53400';
  end if;

  insert into private.admin_request_log (actor_id, role, path, ip)
  values (current_user_id, current_role_name, private.request_path(), private.request_ip());

  return current_user_id;
end;
$$;

revoke all on function private.require_admin(text) from public, anon, authenticated;

-- Совместимость: старые функции зовут require_admin() без аргумента.
-- Для них минимальная роль - admin: это операции над деньгами и доступом.
create or replace function private.require_admin()
returns uuid
language sql
security definer
set search_path = ''
as $$
  select private.require_admin('admin');
$$;

revoke all on function private.require_admin() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Аудит: старое значение, новое значение, IP, роль
-- ---------------------------------------------------------------------------

alter table private.admin_audit_log
  drop constraint if exists admin_audit_log_event_type_check;
alter table private.admin_audit_log
  add constraint admin_audit_log_event_type_check check (char_length(event_type) between 3 and 80);

-- Действие системы (снятие бана по сроку, cron) пишется без автора.
alter table private.admin_audit_log alter column actor_id drop not null;

alter table private.admin_audit_log
  add column if not exists actor_role text,
  add column if not exists actor_ip text,
  add column if not exists before_value jsonb,
  add column if not exists after_value jsonb;

create index if not exists admin_audit_log_actor_created_idx
  on private.admin_audit_log (actor_id, created_at desc);
create index if not exists admin_audit_log_target_created_idx
  on private.admin_audit_log (target_user_id, created_at desc);

create or replace function private.audit(
  p_event text,
  p_target_user_id uuid,
  p_payload jsonb default '{}'::jsonb,
  p_before jsonb default null,
  p_after jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  entry_id uuid;
begin
  insert into private.admin_audit_log (
    actor_id, target_user_id, event_type, payload, actor_role, actor_ip, before_value, after_value
  )
  values (
    actor,
    p_target_user_id,
    p_event,
    coalesce(p_payload, '{}'::jsonb),
    private.current_admin_role(),
    private.request_ip(),
    p_before,
    p_after
  )
  returning id into entry_id;
  return entry_id;
end;
$$;

revoke all on function private.audit(text, uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Контекст админки для интерфейса
-- ---------------------------------------------------------------------------

create or replace function public.get_admin_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  role_name text;
begin
  if current_user_id is null then
    return jsonb_build_object('isAdmin', false);
  end if;

  select role into role_name from private.admin_users where user_id = current_user_id;
  if role_name is null then
    return jsonb_build_object('isAdmin', false);
  end if;

  return jsonb_build_object(
    'isAdmin', true,
    'role', role_name,
    'mfaEnrolled', private.has_verified_mfa(current_user_id),
    'aal', private.current_aal(),
    'permissions', jsonb_build_object(
      'users', true,
      'support', true,
      'moderate', private.admin_role_rank(role_name) >= 2,
      'money', private.admin_role_rank(role_name) >= 2,
      'settings', private.admin_role_rank(role_name) >= 2,
      'delete', role_name = 'owner',
      'payouts', role_name = 'owner',
      'admins', role_name = 'owner'
    )
  );
end;
$$;

revoke all on function public.get_admin_context() from public, anon;
grant execute on function public.get_admin_context() to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Управление администраторами (только владелец)
-- ---------------------------------------------------------------------------

create or replace function public.admin_list_admins()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin('owner');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'userId', a.user_id,
      'email', u.email,
      'fullName', p.full_name,
      'role', a.role,
      'grantedAt', a.granted_at,
      'mfaEnrolled', private.has_verified_mfa(a.user_id),
      'lastSignInAt', u.last_sign_in_at
    ) order by private.admin_role_rank(a.role) desc, a.granted_at)
    from private.admin_users a
    join auth.users u on u.id = a.user_id
    left join public.profiles p on p.id = a.user_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_set_admin_role(
  p_email text,
  p_role text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin('owner');
  target uuid;
  previous text;
begin
  if p_role not in ('owner', 'admin', 'support', 'none') then
    raise exception 'unknown admin role' using errcode = '22023';
  end if;

  select id into target from auth.users where lower(email) = lower(trim(coalesce(p_email, '')));
  if target is null then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
  if target = actor and p_role <> 'owner' then
    raise exception 'owner cannot demote themselves' using errcode = '22023';
  end if;

  select role into previous from private.admin_users where user_id = target;

  if p_role = 'none' then
    delete from private.admin_users where user_id = target;
  else
    insert into private.admin_users (user_id, granted_by, role)
    values (target, actor, p_role)
    on conflict (user_id) do update set role = excluded.role, granted_by = excluded.granted_by, granted_at = now();
  end if;

  perform private.audit(
    'admin_role_changed',
    target,
    jsonb_build_object('email', lower(trim(p_email))),
    jsonb_build_object('role', previous),
    jsonb_build_object('role', case when p_role = 'none' then null else p_role end)
  );

  return jsonb_build_object('userId', target, 'role', case when p_role = 'none' then null else p_role end);
end;
$$;

revoke all on function public.admin_list_admins() from public, anon;
grant execute on function public.admin_list_admins() to authenticated;
revoke all on function public.admin_set_admin_role(text, text) from public, anon;
grant execute on function public.admin_set_admin_role(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Чтение аудита и журнала обращений
-- ---------------------------------------------------------------------------

create or replace function public.admin_audit_log_list(
  p_page integer default 1,
  p_page_size integer default 50,
  p_event text default null,
  p_actor_id uuid default null,
  p_target_user_id uuid default null
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
  perform private.require_admin('support');

  select count(*) into total
  from private.admin_audit_log l
  where (p_event is null or l.event_type = p_event)
    and (p_actor_id is null or l.actor_id = p_actor_id)
    and (p_target_user_id is null or l.target_user_id = p_target_user_id);

  return jsonb_build_object(
    'total', total,
    'page', safe_page,
    'pageSize', safe_size,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'event', l.event_type,
        'actorId', l.actor_id,
        'actorEmail', au.email,
        'actorRole', l.actor_role,
        'actorIp', l.actor_ip,
        'targetUserId', l.target_user_id,
        'targetEmail', tu.email,
        'payload', l.payload,
        'before', l.before_value,
        'after', l.after_value,
        'createdAt', l.created_at
      ) order by l.created_at desc)
      from (
        select *
        from private.admin_audit_log l
        where (p_event is null or l.event_type = p_event)
          and (p_actor_id is null or l.actor_id = p_actor_id)
          and (p_target_user_id is null or l.target_user_id = p_target_user_id)
        order by l.created_at desc
        limit safe_size offset (safe_page - 1) * safe_size
      ) l
      left join auth.users au on au.id = l.actor_id
      left join auth.users tu on tu.id = l.target_user_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_request_log_list(
  p_page integer default 1,
  p_page_size integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_size integer := greatest(1, least(coalesce(p_page_size, 100), 500));
  safe_page integer := greatest(1, coalesce(p_page, 1));
begin
  perform private.require_admin('owner');
  return jsonb_build_object(
    'total', (select count(*) from private.admin_request_log),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'actorId', l.actor_id, 'actorEmail', u.email, 'role', l.role,
        'path', l.path, 'ip', l.ip, 'createdAt', l.created_at
      ) order by l.created_at desc)
      from (
        select * from private.admin_request_log
        order by created_at desc
        limit safe_size offset (safe_page - 1) * safe_size
      ) l
      left join auth.users u on u.id = l.actor_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_audit_log_list(integer, integer, text, uuid, uuid) from public, anon;
grant execute on function public.admin_audit_log_list(integer, integer, text, uuid, uuid) to authenticated;
revoke all on function public.admin_request_log_list(integer, integer) from public, anon;
grant execute on function public.admin_request_log_list(integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Уровни доступа у существующих функций
-- ---------------------------------------------------------------------------
--
-- Чтение обращений и карточки - роль support; деньги и доступ - admin
-- (это уже покрыто require_admin() без аргумента). Функции ниже переписаны
-- только в части проверки роли, тело прежнее.

create or replace function public.admin_support_list(
  p_status text default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_limit integer := greatest(1, least(coalesce(p_limit, 100), 200));
  normalized_status text := nullif(trim(coalesce(p_status, '')), '');
begin
  perform private.require_admin('support');

  if normalized_status is not null and normalized_status not in ('pending_owner', 'pending_user', 'resolved') then
    raise exception 'invalid support status' using errcode = '22023';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', conversation.id,
        'userId', conversation.user_id,
        'email', account.email,
        'fullName', profile.full_name,
        'category', conversation.category,
        'subject', conversation.subject,
        'status', conversation.status,
        'ownerNotificationStatus', conversation.owner_notification_status,
        'context', conversation.context,
        'createdAt', conversation.created_at,
        'updatedAt', conversation.updated_at,
        'lastMessageAt', conversation.last_message_at,
        'lastMessage', last_message.body
      )
      order by conversation.updated_at desc
    )
    from (
      select *
      from public.support_conversations
      where normalized_status is null or status = normalized_status
      order by updated_at desc
      limit safe_limit
    ) conversation
    join auth.users account on account.id = conversation.user_id
    left join public.profiles profile on profile.id = conversation.user_id
    left join lateral (
      select body
      from public.support_messages message
      where message.conversation_id = conversation.id
      order by message.created_at desc
      limit 1
    ) last_message on true
  ), '[]'::jsonb);
end;
$$;

-- Удаление решения из базы - только владелец.
create or replace function public.admin_delete_solution(
  p_solution_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_admin('owner');
  normalized_reason text := trim(coalesce(p_reason, ''));
  solution_record public.homework_solutions%rowtype;
  catalog_record public.homework_solution_catalog%rowtype;
  access_count integer := 0;
  canonical_rows_cleared integer := 0;
begin
  if char_length(normalized_reason) not between 3 and 160 then
    raise exception 'deletion reason must contain 3 to 160 characters' using errcode = '22023';
  end if;

  select * into solution_record
  from public.homework_solutions
  where id = p_solution_id
  for update;

  if not found then
    raise exception 'solution not found' using errcode = 'P0002';
  end if;

  select * into catalog_record
  from public.homework_solution_catalog
  where solution_id = p_solution_id;

  if not found then
    raise exception 'solution is not published in the library' using errcode = '22023';
  end if;

  select count(*) into access_count
  from public.homework_solution_access
  where solution_id = p_solution_id;

  update public.verified_homework_tasks
  set solution_payload = null
  where textbook_id = catalog_record.textbook_id
    and textbook_edition = catalog_record.textbook_edition
    and source_url = catalog_record.source_url
    and source_page is not distinct from catalog_record.source_page
    and task = catalog_record.task
    and condition_normalized = catalog_record.condition_normalized
    and solution_payload is not null;

  get diagnostics canonical_rows_cleared = row_count;

  delete from public.homework_solutions
  where id = p_solution_id;

  perform private.audit(
    'solution_deleted',
    solution_record.created_by,
    jsonb_build_object(
      'solutionId', p_solution_id,
      'textbookId', catalog_record.textbook_id,
      'textbookTitle', catalog_record.textbook_title,
      'edition', catalog_record.textbook_edition,
      'task', catalog_record.task,
      'accessCount', access_count,
      'canonicalRowsCleared', canonical_rows_cleared,
      'reason', normalized_reason
    ),
    to_jsonb(catalog_record),
    null
  );

  return jsonb_build_object(
    'deleted', true,
    'solutionId', p_solution_id,
    'task', catalog_record.task,
    'accessCount', access_count,
    'canonicalRowsCleared', canonical_rows_cleared
  );
end;
$$;
