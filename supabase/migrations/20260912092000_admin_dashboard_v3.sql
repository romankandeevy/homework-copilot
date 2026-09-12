-- Дашборд, третья версия: светофор сервисов, тревога сверки, лента отдельно.
--
-- 1. admin_dashboard_period отдаёт состояние каждого сервиса (для
--    светофора), проблемы сверки кошельков (зависшие резервы и балансы,
--    не сходящиеся с книгой операций) и число ошибок за период. Ленту
--    больше не отдаёт: она ушла в свою функцию.
-- 2. admin_dashboard_feed - лента событий за 30 дней с фильтром по виду
--    (решение, оплата, возврат, регистрация, обращение, ошибка), поиском
--    по имени, почте, предмету и тексту и постраничной выдачей.

create or replace function public.admin_dashboard_period(p_period text default 'day')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  period text := case when p_period in ('day', 'week', 'month', 'year') then p_period else 'day' end;
  span integer := case p_period when 'week' then 7 when 'month' then 30 when 'year' then 365 else 1 end;
  today date := private.msk_day(now());
  current_from timestamptz := ((today - (span - 1))::timestamp at time zone 'Europe/Moscow');
  previous_from timestamptz := ((today - (2 * span - 1))::timestamp at time zone 'Europe/Moscow');
  previous_to timestamptz := now() - make_interval(days => span);
  sla integer := private.setting_int('support_sla_minutes', 30);
  kie private.health_checks%rowtype;
  series jsonb;
  errors_last_hour integer;
  errors_norm numeric;
begin
  perform private.require_admin('support');
  if period <> 'day' then
    perform private.refresh_recent_metrics();
  end if;
  select * into kie from private.health_checks where service = 'kie';

  if period = 'day' then
    select coalesce(jsonb_agg(jsonb_build_object('label', to_char(h.hour_start at time zone 'Europe/Moscow', 'HH24:00')) || x.counts order by h.hour_start), '[]'::jsonb)
    into series
    from (select current_from + make_interval(hours => g) as hour_start from generate_series(0, 23) g) h
    cross join lateral (select private.dashboard_counts(h.hour_start, least(h.hour_start + interval '1 hour', now())) as counts) x
    where h.hour_start <= now();
  elsif period = 'year' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'label', (array['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'])[extract(month from mo.month_start)::integer],
      'solved', coalesce(s.solved, 0),
      'failed', coalesce(s.failed, 0),
      'revenue', coalesce(s.revenue, 0),
      'llmCost', coalesce(s.llm_cost, 0),
      'registrations', coalesce(s.registrations, 0),
      'active', (select count(distinct a.user_id) from private.daily_active_users a
        where a.day >= mo.month_start::date and a.day < (mo.month_start + interval '1 month')::date)
    ) order by mo.month_start), '[]'::jsonb)
    into series
    from generate_series(date_trunc('month', today::timestamp) - interval '11 months', date_trunc('month', today::timestamp), interval '1 month') as mo(month_start)
    left join lateral (
      select sum(m.solved) as solved, sum(m.failed) as failed, sum(m.revenue_kopecks - m.refunds_kopecks) as revenue,
             sum(m.solution_cost_kopecks + m.chat_cost_kopecks) as llm_cost, sum(m.registrations) as registrations
      from private.daily_metrics m
      where m.day >= mo.month_start::date and m.day < (mo.month_start + interval '1 month')::date
    ) s on true;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'label', to_char(g.day_start, 'YYYY-MM-DD'),
      'solved', coalesce(m.solved, 0),
      'failed', coalesce(m.failed, 0),
      'revenue', coalesce(m.revenue_kopecks - m.refunds_kopecks, 0),
      'llmCost', coalesce(m.solution_cost_kopecks + m.chat_cost_kopecks, 0),
      'registrations', coalesce(m.registrations, 0),
      'active', coalesce(m.active_users, 0)
    ) order by g.day_start), '[]'::jsonb)
    into series
    from generate_series((today - (span - 1))::timestamp, today::timestamp, interval '1 day') as g(day_start)
    left join private.daily_metrics m on m.day = g.day_start::date;
  end if;

  select count(*) into errors_last_hour from private.error_events where created_at > now() - interval '1 hour';
  select coalesce(count(*)::numeric / (7 * 24), 0) into errors_norm from private.error_events where created_at > now() - interval '7 days';

  return jsonb_build_object(
    'period', period,
    'from', current_from,
    'previousFrom', previous_from,
    'previousTo', previous_to,
    'current', private.dashboard_counts(current_from, now())
      || jsonb_build_object('errors', (select count(*) from private.error_events where created_at >= current_from)),
    'previous', private.dashboard_counts(previous_from, previous_to)
      || jsonb_build_object('errors', (select count(*) from private.error_events where created_at >= previous_from and created_at < previous_to)),
    'series', series,
    'online', (select count(*) from public.profiles where last_seen_at > now() - interval '10 minutes'),
    'subjects', coalesce((
      select jsonb_agg(jsonb_build_object('subject', s.subject, 'solved', s.solved, 'failed', s.failed) order by s.solved desc, s.failed desc)
      from (
        select coalesce(nullif(subject, ''), 'Без предмета') as subject,
               count(*) filter (where outcome = 'solved') as solved,
               count(*) filter (where outcome = 'failed') as failed
        from private.solution_costs
        where created_at >= current_from
        group by 1
      ) s
    ), '[]'::jsonb),
    'attention', jsonb_build_object(
      'slaMinutes', sla,
      'overdueTickets', coalesce((
        select jsonb_agg(jsonb_build_object('id', c.id, 'subject', c.subject, 'email', u.email,
          'waitingMinutes', floor(extract(epoch from (now() - c.last_user_message_at)) / 60)::integer) order by c.last_user_message_at)
        from public.support_conversations c join auth.users u on u.id = c.user_id
        where c.status = 'pending_owner' and c.last_user_message_at < now() - make_interval(mins => sla)
      ), '[]'::jsonb),
      'fraudOpen', (select count(*) from private.fraud_flags where status = 'open'),
      'errorSpike', jsonb_build_object('lastHour', errors_last_hour, 'norm', round(errors_norm, 2), 'spike', errors_last_hour > greatest(3, errors_norm * 2)),
      'stuckJobs', (select count(*) from public.homework_jobs where status = 'running' and updated_at < now() - interval '5 minutes'),
      'reconciliation', jsonb_build_object(
        'stuckReservations', (select count(*) from private.stuck_reservations()),
        'stuckAmount', coalesce((select sum(amount) from private.stuck_reservations()), 0),
        'walletMismatches', (
          select count(*) from public.wallet_accounts w
          where w.balance <> (select coalesce(sum(e.amount), 0) from public.wallet_entries e where e.user_id = w.user_id)
        )
      )
    ),
    'gateway', jsonb_build_object(
      'credits', (substring(kie.detail from '([0-9]+(?:\.[0-9]+)?)'))::numeric,
      'ok', kie.ok,
      'status', kie.status,
      'checkedAt', kie.checked_at,
      'avgCreditsPerTask', (select round(avg(credits), 3) from private.solution_costs where credits is not null and created_at > now() - interval '7 days'),
      'tasksLast7Days', (select count(*) from private.solution_costs where created_at > now() - interval '7 days')
    ),
    'services', jsonb_build_object(
      'total', (select count(*) from private.health_checks),
      'down', coalesce((select jsonb_agg(service order by service) from private.health_checks where not ok and status <> 'not_configured'), '[]'::jsonb),
      'notConfigured', coalesce((select jsonb_agg(service order by service) from private.health_checks where status = 'not_configured'), '[]'::jsonb),
      'checkedAt', (select max(checked_at) from private.health_checks),
      'list', coalesce((
        select jsonb_agg(jsonb_build_object(
          'service', h.service, 'ok', h.ok, 'status', h.status, 'latencyMs', h.latency_ms,
          'checkedAt', h.checked_at, 'downSince', h.down_since
        ) order by (h.ok or h.status = 'not_configured'), h.service)
        from private.health_checks h
      ), '[]'::jsonb)
    ),
    -- Лента осталась ради совместимости: прод-админка до выкатки этой
    -- версии читает её отсюда. Новая берёт admin_dashboard_feed.
    'feed', coalesce((public.admin_dashboard_feed('all', '', 30))->'items', '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_dashboard_period(text) from public, anon;
grant execute on function public.admin_dashboard_period(text) to authenticated;

create or replace function public.admin_dashboard_feed(
  p_kind text default 'all',
  p_search text default '',
  p_limit integer default 5
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  kind_filter text := case when p_kind in ('solution', 'payment', 'signup', 'ticket', 'error') then p_kind else 'all' end;
  search text := trim(coalesce(p_search, ''));
  safe_limit integer := greatest(1, least(coalesce(p_limit, 5), 100));
  since timestamptz := now() - interval '30 days';
  result jsonb;
begin
  perform private.require_admin('support');

  with events as (
    select 'solution' as kind, c.created_at as at, c.user_id, c.guest_id, c.subject, c.outcome = 'solved' as ok,
           c.price_kopecks as amount, c.cost_kopecks as cost, c.seconds, null::text as text
    from private.solution_costs c
    where c.created_at > since and kind_filter in ('all', 'solution')
    union all
    select 'payment', t.created_at, t.user_id, null, null, true, t.amount, null, null, t.provider_reference
    from private.verified_balance_top_ups t
    where t.created_at > since and kind_filter in ('all', 'payment')
    union all
    select 'refund', r.created_at, r.user_id, null, null, false, r.amount, null, null, r.reason
    from private.top_up_refunds r
    where r.created_at > since and kind_filter in ('all', 'payment')
    union all
    select 'signup', pr.created_at, pr.id, null, null, true, null, null, null, null
    from public.profiles pr
    where pr.created_at > since and kind_filter in ('all', 'signup')
    union all
    select 'ticket', m.created_at, c.user_id, null, c.subject, c.status <> 'pending_owner', null, null, null, left(m.body, 140)
    from public.support_messages m join public.support_conversations c on c.id = m.conversation_id
    where m.author_type = 'user' and m.created_at > since and kind_filter in ('all', 'ticket')
    union all
    select 'error', e.created_at, e.user_id, e.guest_id, e.route, e.severity not in ('error', 'critical'), null, null, null, left(e.message, 140)
    from private.error_events e
    where e.created_at > since and kind_filter in ('all', 'error')
  ),
  matched as (
    select e.*, u.email, p.full_name
    from events e
    left join auth.users u on u.id = e.user_id
    left join public.profiles p on p.id = e.user_id
    where search = ''
       or coalesce(u.email, '') ilike '%' || search || '%'
       or coalesce(p.full_name, '') ilike '%' || search || '%'
       or coalesce(e.subject, '') ilike '%' || search || '%'
       or coalesce(e.text, '') ilike '%' || search || '%'
  ),
  page as (
    select * from matched order by at desc limit safe_limit + 1
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', x.kind, 'at', x.at, 'userId', x.user_id, 'guestId', x.guest_id, 'email', x.email, 'name', x.full_name,
        'subject', x.subject, 'ok', x.ok, 'amount', x.amount, 'cost', x.cost, 'seconds', x.seconds, 'text', x.text
      ) order by x.at desc)
      from (select * from page order by at desc limit safe_limit) x
    ), '[]'::jsonb),
    'hasMore', (select count(*) from page) > safe_limit,
    'total', (select count(*) from matched)
  ) into result;

  return result;
end;
$$;

revoke all on function public.admin_dashboard_feed(text, text, integer) from public, anon;
grant execute on function public.admin_dashboard_feed(text, text, integer) to authenticated;
