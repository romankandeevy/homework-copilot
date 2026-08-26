-- Keep the owner console compatible with the wallet and solution schema already
-- used by the application. The preceding control-plane migration intentionally
-- remains immutable after production application.

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
          where purchased_at >= period_start
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
          'kind', we.kind,
          'description', we.description,
          'idempotencyKey', we.idempotency_key,
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
$$;
