-- Выручка без своих пополнений и владелец у старых решений.
--
-- 1. Выручка. Владелец пополнял свой кошелёк вручную, чтобы проверить
--    оплату, и дашборд показывал это как 200 ₽ выручки. Пополнения и
--    возвраты аккаунтов из private.admin_users больше не считаются ни в
--    выручке, ни в числе пополнений и плательщиков, ни в конверсии. В
--    ленте платежей финансов они остаются: это книга операций, а не отчёт.
--    Расход на модели считается полностью - тестовые решения тоже стоили
--    денег шлюзу.
--
-- 2. Владелец решения. До 11 сентября record_solution_cost не принимала,
--    кому решали, и все 44 записи себестоимости лежали без ученика - лента
--    дашборда подписывала их «Гость». Каждая из них однозначно совпадает с
--    задачей из очереди (тот же предмет, завершена в пределах полутора
--    минут), у которой ученик записан. Отсюда он и берётся.

create or replace function private.is_staff(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.admin_users where user_id = p_user_id);
$$;

revoke all on function private.is_staff(uuid) from public, anon, authenticated;

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
    'revenue', coalesce((select sum(amount) from private.verified_balance_top_ups
        where created_at >= p_from and created_at < p_to and not private.is_staff(user_id)), 0)
      - coalesce((select sum(amount) from private.top_up_refunds
        where created_at >= p_from and created_at < p_to and not private.is_staff(user_id)), 0),
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

create or replace function private.refresh_daily_metrics(p_from date, p_to date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  day_start timestamptz;
  day_end timestamptz;
  d date;
begin
  d := p_from;
  while d <= p_to loop
    day_start := (d::timestamp at time zone 'Europe/Moscow');
    day_end := ((d + 1)::timestamp at time zone 'Europe/Moscow');

    insert into private.daily_active_users (day, user_id)
    select distinct d, user_id from private.user_activity_events
    where created_at >= day_start and created_at < day_end
    union
    select distinct d, user_id from public.homework_jobs
    where user_id is not null and created_at >= day_start and created_at < day_end
    on conflict do nothing;

    insert into private.daily_metrics as m (
      day, registrations, active_users, solved, failed, revenue_kopecks, top_ups, first_payments,
      refunds_kopecks, consumption_kopecks, solution_cost_kopecks, chat_cost_kopecks, errors,
      rate_limited, payment_rejections, updated_at
    )
    select
      d,
      (select count(*) from public.profiles where created_at >= day_start and created_at < day_end),
      (select count(*) from private.daily_active_users where day = d),
      (select count(*) from private.solution_costs where outcome = 'solved' and created_at >= day_start and created_at < day_end),
      (select count(*) from private.solution_costs where outcome = 'failed' and created_at >= day_start and created_at < day_end),
      (select coalesce(sum(amount), 0) from private.verified_balance_top_ups
        where created_at >= day_start and created_at < day_end and not private.is_staff(user_id)),
      (select count(*) from private.verified_balance_top_ups
        where created_at >= day_start and created_at < day_end and not private.is_staff(user_id)),
      (select count(*) from private.verified_balance_top_ups t
        where t.created_at >= day_start and t.created_at < day_end and not private.is_staff(t.user_id)
          and not exists (select 1 from private.verified_balance_top_ups e where e.user_id = t.user_id and e.created_at < t.created_at)),
      (select coalesce(sum(amount), 0) from private.top_up_refunds
        where created_at >= day_start and created_at < day_end and not private.is_staff(user_id)),
      (select coalesce(sum(-amount), 0) from public.wallet_entries where kind = 'debit' and created_at >= day_start and created_at < day_end)
        - (select coalesce(sum(amount), 0) from public.wallet_entries where kind = 'credit' and idempotency_key like '%:refund' and created_at >= day_start and created_at < day_end),
      (select coalesce(sum(cost_kopecks), 0) from private.solution_costs where created_at >= day_start and created_at < day_end),
      (select coalesce(sum(provider_cost_kopecks), 0) from public.chat_generations where created_at >= day_start and created_at < day_end),
      (select count(*) from private.error_events where created_at >= day_start and created_at < day_end),
      (select count(*) from private.request_logs where status = 429 and created_at >= day_start and created_at < day_end),
      (select count(*) from private.request_logs where status = 402 and created_at >= day_start and created_at < day_end),
      now()
    on conflict (day) do update
    set registrations = excluded.registrations,
        active_users = excluded.active_users,
        solved = excluded.solved,
        failed = excluded.failed,
        revenue_kopecks = excluded.revenue_kopecks,
        top_ups = excluded.top_ups,
        first_payments = excluded.first_payments,
        refunds_kopecks = excluded.refunds_kopecks,
        consumption_kopecks = excluded.consumption_kopecks,
        solution_cost_kopecks = excluded.solution_cost_kopecks,
        chat_cost_kopecks = excluded.chat_cost_kopecks,
        errors = excluded.errors,
        rate_limited = excluded.rate_limited,
        payment_rejections = excluded.payment_rejections,
        updated_at = now();

    delete from private.daily_subject_metrics where day = d;
    insert into private.daily_subject_metrics (day, subject, solved, failed, cost_kopecks, truncated, seconds_total)
    select d, coalesce(nullif(subject, ''), 'Без предмета'),
      count(*) filter (where outcome = 'solved'),
      count(*) filter (where outcome = 'failed'),
      coalesce(sum(cost_kopecks), 0),
      count(*) filter (where truncated),
      coalesce(sum(seconds), 0)
    from private.solution_costs
    where created_at >= day_start and created_at < day_end
    group by 2;

    d := d + 1;
  end loop;
end;
$$;

revoke all on function private.refresh_daily_metrics(date, date) from public, anon, authenticated;

create or replace function private.period_summary(p_from date, p_to date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with m as (
    select * from private.daily_metrics where day between p_from and p_to
  ),
  regs as (
    select p.id from public.profiles p
    where private.msk_day(p.created_at) between p_from and p_to and not private.is_staff(p.id)
  )
  select jsonb_build_object(
    'revenue', coalesce((select sum(revenue_kopecks) - sum(refunds_kopecks) from m), 0),
    'topUps', coalesce((select sum(top_ups) from m), 0),
    'averageCheck', coalesce((select case when sum(top_ups) > 0 then round(sum(revenue_kopecks)::numeric / sum(top_ups)) end from m), 0),
    'registrations', coalesce((select sum(registrations) from m), 0),
    'solved', coalesce((select sum(solved) from m), 0),
    'failed', coalesce((select sum(failed) from m), 0),
    'consumption', coalesce((select sum(consumption_kopecks) from m), 0),
    'llmCost', coalesce((select sum(solution_cost_kopecks) + sum(chat_cost_kopecks) from m), 0),
    'solutionCost', coalesce((select sum(solution_cost_kopecks) from m), 0),
    'chatCost', coalesce((select sum(chat_cost_kopecks) from m), 0),
    'margin', coalesce((select sum(revenue_kopecks) - sum(refunds_kopecks) - sum(solution_cost_kopecks) - sum(chat_cost_kopecks) from m), 0),
    'errors', coalesce((select sum(errors) from m), 0),
    'dau', coalesce((select round(avg(active_users), 1) from m), 0),
    'wau', (select count(distinct user_id) from private.daily_active_users where day between p_to - 6 and p_to),
    'mau', (select count(distinct user_id) from private.daily_active_users where day between p_to - 29 and p_to),
    'mrr', coalesce((select sum(revenue_kopecks) - sum(refunds_kopecks) from private.daily_metrics where day between p_to - 29 and p_to), 0),
    'conversion', case when (select count(*) from regs) = 0 then 0 else round(
      100.0 * (select count(*) from regs r where exists (select 1 from private.verified_balance_top_ups t where t.user_id = r.id))
      / (select count(*) from regs), 1) end
  );
$$;

revoke all on function private.period_summary(date, date) from public, anon, authenticated;

create or replace function public.admin_finance_report(p_from date default null, p_to date default null, p_group text default 'day')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  period_to date := coalesce(p_to, private.msk_day(now()));
  period_from date := coalesce(p_from, period_to - 29);
  bucket text := case when p_group in ('week', 'month') then p_group else 'day' end;
  paying integer;
  active integer;
  revenue bigint;
  llm bigint;
begin
  perform private.require_admin('admin');

  select count(distinct user_id) into paying from private.verified_balance_top_ups
  where private.msk_day(created_at) between period_from and period_to and not private.is_staff(user_id);
  select count(distinct user_id) into active from private.daily_active_users where day between period_from and period_to;
  select coalesce(sum(revenue_kopecks - refunds_kopecks), 0), coalesce(sum(solution_cost_kopecks + chat_cost_kopecks), 0)
  into revenue, llm from private.daily_metrics where day between period_from and period_to;

  return jsonb_build_object(
    'from', period_from,
    'to', period_to,
    'group', bucket,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'period', b.bucket_start,
        'revenue', b.revenue, 'refunds', b.refunds, 'topUps', b.top_ups, 'consumption', b.consumption,
        'solutionCost', b.solution_cost, 'chatCost', b.chat_cost,
        'margin', b.revenue - b.refunds - b.solution_cost - b.chat_cost
      ) order by b.bucket_start)
      from (
        select date_trunc(bucket, day::timestamp)::date as bucket_start,
          sum(revenue_kopecks) as revenue, sum(refunds_kopecks) as refunds, sum(top_ups) as top_ups,
          sum(consumption_kopecks) as consumption, sum(solution_cost_kopecks) as solution_cost, sum(chat_cost_kopecks) as chat_cost
        from private.daily_metrics
        where day between period_from and period_to
        group by 1
      ) b
    ), '[]'::jsonb),
    'byPlan', coalesce((
      select jsonb_agg(jsonb_build_object('planId', x.plan_id, 'planTitle', x.title, 'revenue', x.revenue, 'payers', x.payers) order by x.revenue desc)
      from (
        select ep.id as plan_id, ep.title, sum(t.amount) as revenue, count(distinct t.user_id) as payers
        from private.verified_balance_top_ups t
        cross join lateral (select * from private.effective_plan(t.user_id)) ep
        where private.msk_day(t.created_at) between period_from and period_to and not private.is_staff(t.user_id)
        group by ep.id, ep.title
      ) x
    ), '[]'::jsonb),
    'llmByDay', coalesce((
      select jsonb_agg(jsonb_build_object('date', day, 'solutions', solution_cost_kopecks, 'chat', chat_cost_kopecks) order by day)
      from private.daily_metrics where day between period_from and period_to
    ), '[]'::jsonb),
    'llmByModel', coalesce((
      select jsonb_agg(jsonb_build_object('model', model, 'kind', kind, 'calls', calls, 'costKopecks', cost) order by cost desc)
      from (
        select c ->> 'model' as model, 'solution' as kind, count(*) as calls,
          round(sum(coalesce((c ->> 'credits')::numeric, 0)) * 43)::bigint as cost
        from private.solution_logs l, jsonb_array_elements(l.calls) c
        where private.msk_day(l.created_at) between period_from and period_to
        group by 1
        union all
        select model_id, 'chat', count(*), coalesce(sum(provider_cost_kopecks), 0)
        from public.chat_generations
        where private.msk_day(created_at) between period_from and period_to
        group by 1
      ) m
    ), '[]'::jsonb),
    'llmBySubject', coalesce((
      select jsonb_agg(jsonb_build_object('subject', subject, 'costKopecks', cost, 'solved', solved, 'failed', failed) order by cost desc)
      from (
        select subject, sum(cost_kopecks) as cost, sum(solved) as solved, sum(failed) as failed
        from private.daily_subject_metrics where day between period_from and period_to group by subject
      ) s
    ), '[]'::jsonb),
    'unitEconomics', jsonb_build_object(
      'revenue', revenue,
      'llmCost', llm,
      'margin', revenue - llm,
      'payingUsers', paying,
      'activeUsers', active,
      'revenuePerPayer', case when paying > 0 then round(revenue::numeric / paying) else 0 end,
      'llmCostPerActive', case when active > 0 then round(llm::numeric / active) else 0 end,
      'llmCostPerPayer', case when paying > 0 then round(coalesce((
        select sum(c.cost_kopecks) from private.solution_costs c
        where c.user_id in (select distinct user_id from private.verified_balance_top_ups
          where private.msk_day(created_at) between period_from and period_to and not private.is_staff(user_id))
          and private.msk_day(c.created_at) between period_from and period_to
      ), 0)::numeric / paying) else 0 end,
      'arpu', case when active > 0 then round(revenue::numeric / active) else 0 end,
      'costPerSolved', coalesce((
        select case when sum(solved) > 0 then round(sum(solution_cost_kopecks)::numeric / sum(solved)) else 0 end
        from private.daily_metrics where day between period_from and period_to
      ), 0)
    )
  );
end;
$$;

revoke all on function public.admin_finance_report(date, date, text) from public, anon;
grant execute on function public.admin_finance_report(date, date, text) to authenticated;

-- Владелец у записей себестоимости, сделанных до 11 сентября.
update private.solution_costs as c
set user_id = m.user_id,
    guest_id = m.guest_id,
    idempotency_key = coalesce(c.idempotency_key, m.idempotency_key)
from (
  select o.id, j.user_id, j.guest_id, j.idempotency_key
  from private.solution_costs o
  cross join lateral (
    select h.user_id, h.guest_id, h.idempotency_key
    from public.homework_jobs h
    where h.subject = o.subject
      and coalesce(h.finished_at, h.updated_at) between o.created_at - interval '90 seconds' and o.created_at + interval '90 seconds'
    order by abs(extract(epoch from coalesce(h.finished_at, h.updated_at) - o.created_at))
    limit 1
  ) as j
  where o.user_id is null and o.guest_id is null
) as m
where m.id = c.id;

-- Пересчёт всей истории по новым правилам.
select private.refresh_daily_metrics(
  coalesce((select private.msk_day(min(created_at)) from public.profiles), private.msk_day(now())),
  private.msk_day(now())
);
