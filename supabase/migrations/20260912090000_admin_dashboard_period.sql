-- Дашборд за выбранный период: день, неделя, месяц, год.
--
-- Первая версия считала только «сегодня», и в тихое утро владелец видел
-- ряд нулей без выбора. Теперь период выбирается, а сравнение всегда
-- честное - с предыдущим таким же отрезком к этому же моменту:
--   день   - сегодня с полуночи по Москве против вчера до этого же часа;
--   неделя - последние 7 календарных дней против 7 до них;
--   месяц  - 30 дней против 30 до них;
--   год    - 365 дней против 365 до них.
-- Одна функция отдаёт всё, что показывает дашборд: цифры, ряд для
-- графика (по часам для дня, по дням для недели и месяца, по месяцам для
-- года), предметы, тревоги, шлюз, сервисы и ленту.

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
    'current', private.dashboard_counts(current_from, now()),
    'previous', private.dashboard_counts(previous_from, previous_to),
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
      'stuckJobs', (select count(*) from public.homework_jobs where status = 'running' and updated_at < now() - interval '5 minutes')
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
      'checkedAt', (select max(checked_at) from private.health_checks)
    ),
    'feed', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', e.kind, 'at', e.at, 'userId', e.user_id, 'email', u.email, 'name', p.full_name,
        'subject', e.subject, 'ok', e.ok, 'amount', e.amount, 'cost', e.cost, 'seconds', e.seconds, 'text', e.text
      ) order by e.at desc)
      from (
        (select 'solution' as kind, c.created_at as at, c.user_id, c.subject, c.outcome = 'solved' as ok,
                c.price_kopecks as amount, c.cost_kopecks as cost, c.seconds, null::text as text
         from private.solution_costs c order by c.created_at desc limit 20)
        union all
        (select 'payment', t.created_at, t.user_id, null, true, t.amount, null, null, t.provider_reference
         from private.verified_balance_top_ups t order by t.created_at desc limit 10)
        union all
        (select 'refund', r.created_at, r.user_id, null, false, r.amount, null, null, r.reason
         from private.top_up_refunds r order by r.created_at desc limit 10)
        union all
        (select 'signup', pr.created_at, pr.id, null, true, null, null, null, null
         from public.profiles pr order by pr.created_at desc limit 10)
        union all
        (select 'ticket', m.created_at, c.user_id, c.subject, c.status <> 'pending_owner', null, null, null, left(m.body, 140)
         from public.support_messages m join public.support_conversations c on c.id = m.conversation_id
         where m.author_type = 'user' order by m.created_at desc limit 10)
        order by at desc
        limit 30
      ) e
      left join auth.users u on u.id = e.user_id
      left join public.profiles p on p.id = e.user_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_dashboard_period(text) from public, anon;
grant execute on function public.admin_dashboard_period(text) to authenticated;

-- Прежняя функция «только сегодня» заменена этой.
drop function if exists public.admin_dashboard_today();
