-- Owner-only administration control plane.
-- Client applications never receive a writable admin role: every privileged
-- operation below is guarded by private.require_admin().

create schema if not exists private;

create table if not exists private.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users(id) on delete set null
);

alter table private.admin_users enable row level security;
revoke all on table private.admin_users from public, anon, authenticated;

insert into private.admin_users (user_id, granted_by)
select id, id
from auth.users
where lower(email) = lower('roman.kandeevy@gmail.com')
on conflict (user_id) do nothing;

create table if not exists public.account_controls (
  user_id uuid primary key references auth.users(id) on delete cascade,
  is_banned boolean not null default false,
  ban_reason text,
  banned_at timestamptz,
  banned_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint account_controls_ban_state check (
    (
      is_banned
      and banned_at is not null
      and char_length(coalesce(ban_reason, '')) between 3 and 500
    )
    or (
      not is_banned
      and ban_reason is null
      and banned_at is null
      and banned_by is null
    )
  )
);

alter table public.account_controls enable row level security;
revoke all on table public.account_controls from public, anon, authenticated;
grant select on table public.account_controls to authenticated;
drop policy if exists account_controls_select_own on public.account_controls;
create policy account_controls_select_own
  on public.account_controls
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

alter table public.profiles
  add column if not exists last_seen_at timestamptz;

create table if not exists private.user_activity_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('session_started', 'session_ended', 'page_view')),
  path text,
  created_at timestamptz not null default now()
);

create index if not exists user_activity_events_user_created_at_idx
  on private.user_activity_events (user_id, created_at desc);
create index if not exists user_activity_events_created_at_idx
  on private.user_activity_events (created_at desc);

alter table private.user_activity_events enable row level security;
revoke all on table private.user_activity_events from public, anon, authenticated;

create table if not exists private.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete restrict,
  target_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in ('balance_adjusted', 'user_banned', 'user_unbanned')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_created_at_idx
  on private.admin_audit_log (created_at desc);

alter table private.admin_audit_log enable row level security;
revoke all on table private.admin_audit_log from public, anon, authenticated;

create or replace function private.seed_account_controls()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.account_controls (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function private.seed_account_controls() from public, anon, authenticated;

drop trigger if exists on_auth_user_seed_account_controls on auth.users;
create trigger on_auth_user_seed_account_controls
  after insert on auth.users
  for each row execute function private.seed_account_controls();

insert into public.account_controls (user_id)
select id
from auth.users
on conflict (user_id) do nothing;

create or replace function private.is_current_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.admin_users
    where user_id = (select auth.uid())
  );
$$;

create or replace function private.require_admin()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null or not private.is_current_admin() then
    raise exception 'admin access required' using errcode = '42501';
  end if;

  return current_user_id;
end;
$$;

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
  ) then
    raise exception 'account is blocked' using errcode = '42501';
  end if;
end;
$$;

revoke all on function private.is_current_admin() from public, anon, authenticated;
revoke all on function private.require_admin() from public, anon, authenticated;
revoke all on function private.assert_account_not_banned(uuid) from public, anon, authenticated;

create or replace function public.get_admin_context()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('isAdmin', private.is_current_admin());
$$;

create or replace function public.track_my_activity(
  p_event text,
  p_path text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    return;
  end if;

  if p_event not in ('session_started', 'session_ended', 'page_view') then
    raise exception 'unsupported activity event' using errcode = '22023';
  end if;

  if p_path is not null and (
    char_length(p_path) not between 1 and 120
    or p_path !~ '^/[A-Za-z0-9/_-]*$'
  ) then
    raise exception 'invalid activity path' using errcode = '22023';
  end if;

  update public.profiles
  set last_seen_at = now()
  where id = current_user_id;

  if p_event = 'page_view' and exists (
    select 1
    from private.user_activity_events
    where user_id = current_user_id
      and event_type = p_event
      and path is not distinct from p_path
      and created_at > now() - interval '30 seconds'
  ) then
    return;
  end if;

  insert into private.user_activity_events (user_id, event_type, path)
  values (current_user_id, p_event, p_path);
end;
$$;

create or replace function public.admin_dashboard(p_period_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_period_days integer := greatest(1, least(coalesce(p_period_days, 30), 90));
  period_start timestamptz := now() - make_interval(days => safe_period_days);
begin
  perform private.require_admin();

  return (
    with summary as (
      select
        (select count(*) from public.profiles) as total_users,
        (select count(*) from public.profiles where created_at >= period_start) as new_users,
        (select count(*) from public.profiles where last_seen_at >= period_start) as active_users,
        (select count(*) from public.profiles where last_seen_at >= now() - interval '10 minutes') as online_users,
        (select count(*) from public.account_controls where is_banned) as banned_users,
        (
          select coalesce(sum(-amount), 0)
          from public.wallet_entries
          where amount < 0 and created_at >= period_start
        ) as solution_charges,
        (
          select coalesce(sum(amount), 0)
          from public.wallet_entries
          where amount > 0 and created_at >= period_start
        ) as wallet_credits,
        (
          select count(*)
          from public.homework_solution_access
          where created_at >= period_start
        ) as opened_solutions
    ),
    daily as (
      select generate_series(
        (current_date - (safe_period_days - 1))::timestamptz,
        current_date::timestamptz,
        interval '1 day'
      )::date as day
    ),
    series as (
      select jsonb_agg(
        jsonb_build_object(
          'date', to_char(d.day, 'YYYY-MM-DD'),
          'users', coalesce((
            select count(*)
            from public.profiles p
            where p.last_seen_at::date = d.day
          ), 0),
          'newUsers', coalesce((
            select count(*)
            from public.profiles p
            where p.created_at::date = d.day
          ), 0),
          'charges', coalesce((
            select sum(-we.amount)
            from public.wallet_entries we
            where we.amount < 0
              and we.created_at::date = d.day
          ), 0)
        )
        order by d.day
      ) as value
      from daily d
    ),
    recent_activity as (
      select jsonb_agg(
        jsonb_build_object(
          'id', ua.id,
          'userId', ua.user_id,
          'email', au.email,
          'fullName', p.full_name,
          'event', ua.event_type,
          'path', ua.path,
          'createdAt', ua.created_at
        )
        order by ua.created_at desc
      ) as value
      from (
        select *
        from private.user_activity_events
        order by created_at desc
        limit 24
      ) ua
      join auth.users au on au.id = ua.user_id
      left join public.profiles p on p.id = ua.user_id
    ),
    recent_actions as (
      select jsonb_agg(
        jsonb_build_object(
          'id', al.id,
          'actorId', al.actor_id,
          'targetUserId', al.target_user_id,
          'event', al.event_type,
          'payload', al.payload,
          'createdAt', al.created_at
        )
        order by al.created_at desc
      ) as value
      from (
        select *
        from private.admin_audit_log
        order by created_at desc
        limit 12
      ) al
    )
    select jsonb_build_object(
      'periodDays', safe_period_days,
      'summary', jsonb_build_object(
        'totalUsers', s.total_users,
        'newUsers', s.new_users,
        'activeUsers', s.active_users,
        'onlineUsers', s.online_users,
        'bannedUsers', s.banned_users,
        'solutionCharges', s.solution_charges,
        'walletCredits', s.wallet_credits,
        'openedSolutions', s.opened_solutions
      ),
      'series', coalesce(se.value, '[]'::jsonb),
      'recentActivity', coalesce(ra.value, '[]'::jsonb),
      'recentAdminActions', coalesce(ac.value, '[]'::jsonb)
    )
    from summary s
    cross join series se
    cross join recent_activity ra
    cross join recent_actions ac
  );
end;
$$;

create or replace function public.admin_list_users(
  p_search text default '',
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_limit integer := greatest(1, least(coalesce(p_limit, 100), 200));
  normalized_search text := trim(coalesce(p_search, ''));
begin
  perform private.require_admin();

  return coalesce((
    with listed_users as (
      select
        p.id,
        au.email,
        p.full_name,
        p.grade,
        p.created_at,
        p.last_seen_at,
        coalesce(wa.balance, 0) as balance,
        coalesce(ac.is_banned, false) as is_banned,
        ac.ban_reason,
        ac.banned_at,
        (
          select max(ua.created_at)
          from private.user_activity_events ua
          where ua.user_id = p.id
        ) as last_activity_at
      from public.profiles p
      join auth.users au on au.id = p.id
      left join public.wallet_accounts wa on wa.user_id = p.id
      left join public.account_controls ac on ac.user_id = p.id
      where normalized_search = ''
        or au.email ilike '%' || normalized_search || '%'
        or coalesce(p.full_name, '') ilike '%' || normalized_search || '%'
      order by coalesce(p.last_seen_at, p.created_at) desc
      limit safe_limit
    )
    select jsonb_agg(
      jsonb_build_object(
        'id', id,
        'email', email,
        'fullName', full_name,
        'grade', grade,
        'balance', balance,
        'createdAt', created_at,
        'lastSeenAt', last_seen_at,
        'lastActivityAt', last_activity_at,
        'isBanned', is_banned,
        'banReason', ban_reason,
        'bannedAt', banned_at
      )
      order by coalesce(last_seen_at, created_at) desc
    )
    from listed_users
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_user_detail(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();

  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'user not found' using errcode = 'P0002';
  end if;

  return (
    with user_record as (
      select
        p.id,
        au.email,
        p.full_name,
        p.grade,
        p.created_at,
        p.last_seen_at,
        coalesce(wa.balance, 0) as balance,
        coalesce(ac.is_banned, false) as is_banned,
        ac.ban_reason,
        ac.banned_at
      from public.profiles p
      join auth.users au on au.id = p.id
      left join public.wallet_accounts wa on wa.user_id = p.id
      left join public.account_controls ac on ac.user_id = p.id
      where p.id = p_user_id
    ),
    wallet_entries as (
      select jsonb_agg(
        jsonb_build_object(
          'id', we.id,
          'amount', we.amount,
          'reason', we.reason,
          'reference', we.reference,
          'createdAt', we.created_at
        )
        order by we.created_at desc
      ) as value
      from (
        select *
        from public.wallet_entries
        where user_id = p_user_id
        order by created_at desc
        limit 50
      ) we
    ),
    activity as (
      select jsonb_agg(
        jsonb_build_object(
          'id', ua.id,
          'event', ua.event_type,
          'path', ua.path,
          'createdAt', ua.created_at
        )
        order by ua.created_at desc
      ) as value
      from (
        select *
        from private.user_activity_events
        where user_id = p_user_id
        order by created_at desc
        limit 50
      ) ua
    )
    select jsonb_build_object(
      'user', jsonb_build_object(
        'id', ur.id,
        'email', ur.email,
        'fullName', ur.full_name,
        'grade', ur.grade,
        'balance', ur.balance,
        'createdAt', ur.created_at,
        'lastSeenAt', ur.last_seen_at,
        'isBanned', ur.is_banned,
        'banReason', ur.ban_reason,
        'bannedAt', ur.banned_at
      ),
      'walletEntries', coalesce(we.value, '[]'::jsonb),
      'activity', coalesce(a.value, '[]'::jsonb)
    )
    from user_record ur
    cross join wallet_entries we
    cross join activity a
  );
end;
$$;

create or replace function public.admin_adjust_balance(
  p_user_id uuid,
  p_amount integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

  insert into public.wallet_entries (user_id, amount, reason, reference)
  values (
    p_user_id,
    p_amount,
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
$$;

create or replace function public.admin_set_user_ban(
  p_user_id uuid,
  p_is_banned boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_admin();
  normalized_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if p_user_id = actor_id and p_is_banned then
    raise exception 'an administrator cannot block their own account' using errcode = '22023';
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'user not found' using errcode = 'P0002';
  end if;

  if p_is_banned and char_length(coalesce(normalized_reason, '')) not between 3 and 500 then
    raise exception 'block reason must contain 3 to 500 characters' using errcode = '22023';
  end if;

  insert into public.account_controls (
    user_id,
    is_banned,
    ban_reason,
    banned_at,
    banned_by,
    updated_at
  )
  values (
    p_user_id,
    p_is_banned,
    case when p_is_banned then normalized_reason else null end,
    case when p_is_banned then now() else null end,
    case when p_is_banned then actor_id else null end,
    now()
  )
  on conflict (user_id) do update
  set is_banned = excluded.is_banned,
      ban_reason = excluded.ban_reason,
      banned_at = excluded.banned_at,
      banned_by = excluded.banned_by,
      updated_at = excluded.updated_at;

  insert into private.admin_audit_log (actor_id, target_user_id, event_type, payload)
  values (
    actor_id,
    p_user_id,
    case when p_is_banned then 'user_banned' else 'user_unbanned' end,
    jsonb_build_object('reason', case when p_is_banned then normalized_reason else null end)
  );

  return jsonb_build_object(
    'userId', p_user_id,
    'isBanned', p_is_banned,
    'reason', case when p_is_banned then normalized_reason else null end
  );
end;
$$;

/*
create or replace function public.spend_solution_credit(
  p_product_kind text,
  p_product_id text,
  p_amount integer,
  p_reason text,
  p_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  existing_entry public.wallet_entries%rowtype;
  current_balance integer;
  updated_balance integer;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  perform private.assert_account_not_banned(current_user_id);

  if p_product_kind not in ('solution', 'check') then
    raise exception 'invalid product kind' using errcode = '22023';
  end if;

  if coalesce(length(trim(p_product_id)), 0) = 0 or length(p_product_id) > 160 then
    raise exception 'invalid product id' using errcode = '22023';
  end if;

  if p_amount <= 0 or p_amount > 10000 then
    raise exception 'invalid debit amount' using errcode = '22023';
  end if;

  if coalesce(length(trim(p_reason)), 0) = 0 or length(p_reason) > 160 then
    raise exception 'invalid debit reason' using errcode = '22023';
  end if;

  if coalesce(length(trim(p_reference)), 0) = 0 or length(p_reference) > 200 then
    raise exception 'invalid debit reference' using errcode = '22023';
  end if;

  select *
  into existing_entry
  from public.wallet_entries
  where user_id = current_user_id
    and reference = p_reference;

  if found then
    return jsonb_build_object(
      'balance', (select balance from public.wallet_accounts where user_id = current_user_id),
      'charged', false,
      'entryId', existing_entry.id
    );
  end if;

  select balance
  into current_balance
  from public.wallet_accounts
  where user_id = current_user_id
  for update;

  if current_balance is null then
    raise exception 'wallet not found' using errcode = 'P0002';
  end if;

  if current_balance < p_amount then
    raise exception 'insufficient balance' using errcode = '22023';
  end if;

  updated_balance := current_balance - p_amount;

  update public.wallet_accounts
  set balance = updated_balance,
      updated_at = now()
  where user_id = current_user_id;

  insert into public.wallet_entries (
    user_id,
    amount,
    reason,
    reference
  )
  values (
    current_user_id,
    -p_amount,
    p_reason,
    p_reference
  )
  returning id into existing_entry.id;

  return jsonb_build_object(
    'balance', updated_balance,
    'charged', true,
    'entryId', existing_entry.id
  );
end;
$$;

create or replace function public.complete_homework_solution(
  p_task_key text,
  p_task_number text,
  p_task_input text,
  p_photo_hash text,
  p_requested_answer text,
  p_requested_work text,
  p_requested_source text,
  p_solution_price integer,
  p_check_price integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  normalized_task_key text := trim(coalesce(p_task_key, ''));
  normalized_task_number text := trim(coalesce(p_task_number, ''));
  normalized_task_input text := trim(coalesce(p_task_input, ''));
  normalized_photo_hash text := trim(coalesce(p_photo_hash, ''));
  normalized_answer text := trim(coalesce(p_requested_answer, ''));
  normalized_work text := trim(coalesce(p_requested_work, ''));
  normalized_source text := trim(coalesce(p_requested_source, ''));
  canonical_task public.verified_homework_tasks%rowtype;
  existing_access public.homework_solution_access%rowtype;
  current_balance integer;
  resulting_balance integer;
  charged_amount integer := 0;
  resolved_solution_price integer := 0;
  resolved_check_price integer := 0;
  resolved_answer text;
  resolved_work text;
  resolved_source text;
  access_type text;
  reference_value text;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  perform private.assert_account_not_banned(current_user_id);

  if normalized_task_key = '' or length(normalized_task_key) > 180 then
    raise exception 'invalid task key' using errcode = '22023';
  end if;

  if normalized_task_number !~ '^[0-9]{1,4}$' then
    raise exception 'invalid task number' using errcode = '22023';
  end if;

  if normalized_task_input = '' or length(normalized_task_input) > 12000 then
    raise exception 'invalid task input' using errcode = '22023';
  end if;

  if normalized_photo_hash = '' or length(normalized_photo_hash) > 180 then
    raise exception 'invalid photo hash' using errcode = '22023';
  end if;

  if normalized_answer = '' or length(normalized_answer) > 12000 then
    raise exception 'invalid requested answer' using errcode = '22023';
  end if;

  if normalized_work = '' or length(normalized_work) > 12000 then
    raise exception 'invalid requested work' using errcode = '22023';
  end if;

  if normalized_source = '' or length(normalized_source) > 500 then
    raise exception 'invalid requested source' using errcode = '22023';
  end if;

  if p_solution_price is null or p_solution_price < 0 or p_solution_price > 10000 then
    raise exception 'invalid solution price' using errcode = '22023';
  end if;

  if p_check_price is null or p_check_price < 0 or p_check_price > 10000 then
    raise exception 'invalid check price' using errcode = '22023';
  end if;

  select *
  into canonical_task
  from public.verified_homework_tasks
  where task_key = normalized_task_key
    and task_number = normalized_task_number
    and task_input = normalized_task_input
    and photo_hash = normalized_photo_hash
  limit 1;

  if found then
    resolved_answer := canonical_task.answer;
    resolved_work := canonical_task.work;
    resolved_source := canonical_task.source;
    resolved_solution_price := canonical_task.solution_price;
    resolved_check_price := canonical_task.check_price;
  else
    resolved_answer := normalized_answer;
    resolved_work := normalized_work;
    resolved_source := normalized_source;
    resolved_solution_price := p_solution_price;
    resolved_check_price := p_check_price;
  end if;

  select *
  into existing_access
  from public.homework_solution_access
  where user_id = current_user_id
    and task_key = normalized_task_key
  for update;

  if found then
    return jsonb_build_object(
      'balance', (select balance from public.wallet_accounts where user_id = current_user_id),
      'charged', false,
      'alreadyPurchased', true,
      'accessType', existing_access.access_type,
      'taskKey', normalized_task_key,
      'taskNumber', normalized_task_number,
      'answer', resolved_answer,
      'work', resolved_work,
      'source', resolved_source
    );
  end if;

  if resolved_solution_price > 0 then
    charged_amount := resolved_solution_price;
    access_type := 'solution';
  elsif resolved_check_price > 0 then
    charged_amount := resolved_check_price;
    access_type := 'check';
  else
    access_type := 'solution';
  end if;

  select balance
  into current_balance
  from public.wallet_accounts
  where user_id = current_user_id
  for update;

  if current_balance is null then
    raise exception 'wallet not found' using errcode = 'P0002';
  end if;

  if current_balance < charged_amount then
    raise exception 'insufficient balance' using errcode = '22023';
  end if;

  resulting_balance := current_balance - charged_amount;
  reference_value := 'homework:' || normalized_task_key;

  if charged_amount > 0 then
    update public.wallet_accounts
    set balance = resulting_balance,
        updated_at = now()
    where user_id = current_user_id;

    insert into public.wallet_entries (user_id, amount, reason, reference)
    values (
      current_user_id,
      -charged_amount,
      case
        when access_type = 'solution' then 'Полное решение задания №' || normalized_task_number
        else 'Проверка задания №' || normalized_task_number
      end,
      reference_value
    );
  end if;

  insert into public.homework_solution_access (
    user_id,
    task_key,
    task_number,
    access_type,
    amount
  )
  values (
    current_user_id,
    normalized_task_key,
    normalized_task_number,
    access_type,
    charged_amount
  );

  return jsonb_build_object(
    'balance', resulting_balance,
    'charged', charged_amount > 0,
    'alreadyPurchased', false,
    'accessType', access_type,
    'taskKey', normalized_task_key,
    'taskNumber', normalized_task_number,
    'answer', resolved_answer,
    'work', resolved_work,
    'source', resolved_source
  );
end;
$$;
*/

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
as $$
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
$$;

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
as $$
declare
  current_user_id uuid := (select auth.uid());
  stored_solution public.homework_solutions%rowtype;
  previous_solution_id uuid;
  solution_price integer;
  description text;
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

  if stored_solution.id is not null and exists (
    select 1
    from public.homework_solution_access as access
    where access.user_id = current_user_id and access.solution_id = stored_solution.id
  ) then
    return jsonb_set(stored_solution.solution, '{ownerId}', to_jsonb(current_user_id::text));
  end if;

  if stored_solution.id is null and p_solution is null then
    return null;
  end if;

  if exists (
    select 1 from public.wallet_entries
    where user_id = current_user_id and idempotency_key = p_idempotency_key
  ) then
    raise exception 'idempotency key already used' using errcode = '22023';
  end if;

  if stored_solution.id is null then
    if jsonb_typeof(p_solution) <> 'object'
      or p_solution ->> 'textbookId' <> p_textbook_id
      or p_solution ->> 'task' <> p_task
      or p_solution ->> 'source' <> p_source
      or p_solution ->> 'textbookEdition' <> p_edition
      or p_solution ->> 'sourceUrl' <> p_source_url
      or p_solution ->> 'conditionNormalized' <> p_condition_normalized
      or p_solution ->> 'sourceVerified' <> 'true'
      or char_length(coalesce(p_solution ->> 'condition', '')) = 0
      or jsonb_typeof(p_solution -> 'steps') <> 'array'
      or jsonb_array_length(p_solution -> 'steps') = 0 then
      raise exception 'invalid verified homework solution' using errcode = '22023';
    end if;
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
      p_textbook_id,
      p_task,
      p_source,
      p_edition,
      p_source_url,
      p_source_page,
      p_condition_normalized,
      left(coalesce(p_solution ->> 'subject', ''), 150),
      left(coalesce(p_solution ->> 'textbookTitle', ''), 300),
      p_solution - 'ownerId',
      current_user_id
    )
    returning * into stored_solution;

    if p_source = 'number' then
      insert into public.homework_solution_catalog (
        solution_id, textbook_id, task, textbook_edition, source_url, source_page,
        condition_normalized, subject, textbook_title, created_at
      )
      values (
        stored_solution.id,
        stored_solution.textbook_id,
        stored_solution.task,
        stored_solution.textbook_edition,
        stored_solution.source_url,
        stored_solution.source_page,
        stored_solution.condition_normalized,
        stored_solution.subject,
        stored_solution.textbook_title,
        stored_solution.created_at
      );
    end if;
  end if;

  insert into public.homework_solution_access (user_id, solution_id, idempotency_key)
  values (current_user_id, stored_solution.id, p_idempotency_key);

  return jsonb_set(stored_solution.solution, '{ownerId}', to_jsonb(current_user_id::text));
end;
$$;

revoke all on function public.get_admin_context() from public, anon;
grant execute on function public.get_admin_context() to authenticated;
revoke all on function public.track_my_activity(text, text) from public, anon;
grant execute on function public.track_my_activity(text, text) to authenticated;
revoke all on function public.admin_dashboard(integer) from public, anon;
grant execute on function public.admin_dashboard(integer) to authenticated;
revoke all on function public.admin_list_users(text, integer) from public, anon;
grant execute on function public.admin_list_users(text, integer) to authenticated;
revoke all on function public.admin_user_detail(uuid) from public, anon;
grant execute on function public.admin_user_detail(uuid) to authenticated;
revoke all on function public.admin_adjust_balance(uuid, integer, text) from public, anon;
grant execute on function public.admin_adjust_balance(uuid, integer, text) to authenticated;
revoke all on function public.admin_set_user_ban(uuid, boolean, text) from public, anon;
grant execute on function public.admin_set_user_ban(uuid, boolean, text) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.wallet_accounts;
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.account_controls;
exception
  when duplicate_object then null;
end;
$$;
