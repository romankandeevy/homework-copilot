-- Expand the owner dashboard with service-usage and wallet signals. Revenue is
-- deliberately not inferred here: the application has no payment ledger yet.

create or replace function public.admin_dashboard(p_period_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_period_days integer := greatest(1, least(coalesce(p_period_days, 30), 90));
  period_start timestamptz := now() - make_interval(days => safe_period_days);
  today_start timestamptz := date_trunc('day', now());
begin
  perform private.require_admin();

  return (
    with summary as (
      select
        (select count(*) from public.profiles) as total_users,
        (select count(*) from public.profiles where created_at >= period_start) as new_users,
        (select count(*) from public.profiles where created_at >= today_start) as new_users_today,
        (select count(*) from public.profiles where last_seen_at >= period_start) as active_users,
        (select count(*) from public.profiles where last_seen_at >= today_start) as active_users_today,
        (select count(*) from public.profiles where last_seen_at >= now() - interval '7 days') as active_users_7_days,
        (select count(*) from public.profiles where last_seen_at >= now() - interval '10 minutes') as online_users,
        (select count(*) from public.account_controls where is_banned) as banned_users,
        (
          select count(*) from private.user_activity_events
          where event_type = 'session_started' and created_at >= period_start
        ) as session_starts,
        (
          select count(*) from private.user_activity_events
          where event_type = 'page_view' and created_at >= period_start
        ) as page_views,
        (
          select coalesce(sum(balance), 0) from public.wallet_accounts
        ) as total_wallet_balance,
        (
          select coalesce(sum(-amount), 0)
          from public.wallet_entries
          where amount < 0 and created_at >= period_start
        ) as solution_charges,
        (
          select coalesce(sum(-amount), 0)
          from public.wallet_entries
          where amount < 0 and created_at >= today_start
        ) as solution_charges_today,
        (
          select coalesce(sum(amount), 0)
          from public.wallet_entries
          where amount > 0 and created_at >= period_start
        ) as wallet_credits,
        (
          select count(*) from public.homework_solution_access
          where purchased_at >= period_start
        ) as opened_solutions,
        (
          select count(*) from public.homework_solution_access
          where purchased_at >= today_start
        ) as opened_solutions_today
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
            select count(*) from public.profiles p
            where p.last_seen_at::date = d.day
          ), 0),
          'newUsers', coalesce((
            select count(*) from public.profiles p
            where p.created_at::date = d.day
          ), 0),
          'sessionStarts', coalesce((
            select count(*) from private.user_activity_events ua
            where ua.event_type = 'session_started' and ua.created_at::date = d.day
          ), 0),
          'pageViews', coalesce((
            select count(*) from private.user_activity_events ua
            where ua.event_type = 'page_view' and ua.created_at::date = d.day
          ), 0),
          'openedSolutions', coalesce((
            select count(*) from public.homework_solution_access hsa
            where hsa.purchased_at::date = d.day
          ), 0),
          'charges', coalesce((
            select sum(-we.amount) from public.wallet_entries we
            where we.amount < 0 and we.created_at::date = d.day
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
        select * from private.user_activity_events
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
        select * from private.admin_audit_log
        order by created_at desc
        limit 12
      ) al
    )
    select jsonb_build_object(
      'periodDays', safe_period_days,
      'summary', jsonb_build_object(
        'totalUsers', s.total_users,
        'newUsers', s.new_users,
        'newUsersToday', s.new_users_today,
        'activeUsers', s.active_users,
        'activeUsersToday', s.active_users_today,
        'activeUsers7Days', s.active_users_7_days,
        'onlineUsers', s.online_users,
        'bannedUsers', s.banned_users,
        'sessionStarts', s.session_starts,
        'pageViews', s.page_views,
        'totalWalletBalance', s.total_wallet_balance,
        'solutionCharges', s.solution_charges,
        'solutionChargesToday', s.solution_charges_today,
        'walletCredits', s.wallet_credits,
        'openedSolutions', s.opened_solutions,
        'openedSolutionsToday', s.opened_solutions_today
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
