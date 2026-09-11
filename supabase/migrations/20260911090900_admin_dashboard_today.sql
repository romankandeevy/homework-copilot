-- Дашборд «сегодня»: что происходит прямо сейчас.
--
-- Прежний дашборд повторял ТЗ буквально - MRR, когорты, воронка, десяток
-- карточек - и на сервисе с десятком учеников это был шум. Владельцу
-- нужно другое: сколько решено и заработано сегодня против вчерашнего к
-- этому же часу, хватит ли кредитов шлюза и живая лента событий.

create or replace function private.dashboard_counts(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'solved', (select count(*) from private.solution_costs where outcome = 'solved' and created_at >= p_from and created_at < p_to),
    'failed', (select count(*) from private.solution_costs where outcome = 'failed' and created_at >= p_from and created_at < p_to),
    'revenue', coalesce((select sum(amount) from private.verified_balance_top_ups where created_at >= p_from and created_at < p_to), 0)
      - coalesce((select sum(amount) from private.top_up_refunds where created_at >= p_from and created_at < p_to), 0),
    'registrations', (select count(*) from public.profiles where created_at >= p_from and created_at < p_to),
    'llmCost', coalesce((select sum(cost_kopecks) from private.solution_costs where created_at >= p_from and created_at < p_to), 0)
      + coalesce((select sum(provider_cost_kopecks) from public.chat_generations where created_at >= p_from and created_at < p_to), 0),
    'active', (
      select count(distinct user_id) from (
        select user_id from private.user_activity_events where created_at >= p_from and created_at < p_to
        union
        select user_id from public.homework_jobs where user_id is not null and created_at >= p_from and created_at < p_to
      ) a
    ),
    'guests', (select count(distinct guest_id) from public.homework_jobs where user_id is null and created_at >= p_from and created_at < p_to)
  );
$$;

revoke all on function private.dashboard_counts(timestamptz, timestamptz) from public, anon, authenticated;

create or replace function public.admin_dashboard_today()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  today_start timestamptz := (private.msk_day(now())::timestamp at time zone 'Europe/Moscow');
  yesterday_start timestamptz := ((private.msk_day(now()) - 1)::timestamp at time zone 'Europe/Moscow');
  kie private.health_checks%rowtype;
begin
  perform private.require_admin('support');
  select * into kie from private.health_checks where service = 'kie';

  return jsonb_build_object(
    'today', private.dashboard_counts(today_start, now()),
    -- Вчера к этому же часу: сравнивать неполный день с полным бессмысленно.
    'yesterday', private.dashboard_counts(yesterday_start, now() - interval '1 day'),
    'online', (select count(*) from public.profiles where last_seen_at > now() - interval '10 minutes'),
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

revoke all on function public.admin_dashboard_today() from public, anon;
grant execute on function public.admin_dashboard_today() to authenticated;
