-- Дашборд, финансы и мониторинг на реальных данных приложения.
--
-- Платёжного провайдера нет, поэтому «выручка» здесь - подтверждённые
-- пополнения кошелька (private.verified_balance_top_ups) минус возвраты
-- (private.top_up_refunds). «Потребление» - списания за решения и чат.
-- Расход на LLM - private.solution_costs и public.chat_generations.
--
-- Метрики дашборда читаются из агрегатов по дням, которые пересчитывает
-- pg_cron, а не сырыми запросами по всей базе (ТЗ, п. 9).

-- ---------------------------------------------------------------------------
-- 1. Агрегаты по дням
-- ---------------------------------------------------------------------------

create table if not exists private.daily_metrics (
  day date primary key,
  registrations integer not null default 0,
  active_users integer not null default 0,
  solved integer not null default 0,
  failed integer not null default 0,
  revenue_kopecks bigint not null default 0,
  top_ups integer not null default 0,
  first_payments integer not null default 0,
  refunds_kopecks bigint not null default 0,
  consumption_kopecks bigint not null default 0,
  solution_cost_kopecks bigint not null default 0,
  chat_cost_kopecks bigint not null default 0,
  errors integer not null default 0,
  rate_limited integer not null default 0,
  payment_rejections integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists private.daily_subject_metrics (
  day date not null,
  subject text not null,
  solved integer not null default 0,
  failed integer not null default 0,
  cost_kopecks bigint not null default 0,
  truncated integer not null default 0,
  seconds_total numeric not null default 0,
  primary key (day, subject)
);

create table if not exists private.daily_active_users (
  day date not null,
  user_id uuid not null,
  primary key (day, user_id)
);

create index if not exists daily_active_users_user_idx on private.daily_active_users (user_id, day);

alter table private.daily_metrics enable row level security;
alter table private.daily_subject_metrics enable row level security;
alter table private.daily_active_users enable row level security;
revoke all on table private.daily_metrics, private.daily_subject_metrics, private.daily_active_users from public, anon, authenticated;

-- День - по Москве: владелец и ученики живут в этом поясе.
create or replace function private.msk_day(p_at timestamptz)
returns date
language sql
immutable
set search_path = ''
as $$
  select (p_at at time zone 'Europe/Moscow')::date;
$$;

revoke all on function private.msk_day(timestamptz) from public, anon, authenticated;

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
      (select coalesce(sum(amount), 0) from private.verified_balance_top_ups where created_at >= day_start and created_at < day_end),
      (select count(*) from private.verified_balance_top_ups where created_at >= day_start and created_at < day_end),
      (select count(*) from private.verified_balance_top_ups t
        where t.created_at >= day_start and t.created_at < day_end
          and not exists (select 1 from private.verified_balance_top_ups e where e.user_id = t.user_id and e.created_at < t.created_at)),
      (select coalesce(sum(amount), 0) from private.top_up_refunds where created_at >= day_start and created_at < day_end),
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

create or replace function private.refresh_recent_metrics()
returns void
language sql
security definer
set search_path = ''
as $$
  select private.refresh_daily_metrics(private.msk_day(now()) - 1, private.msk_day(now()));
$$;

revoke all on function private.refresh_recent_metrics() from public, anon, authenticated;

-- Разовый пересчёт всей истории.
select private.refresh_daily_metrics(
  coalesce((select private.msk_day(min(created_at)) from public.profiles), private.msk_day(now())),
  private.msk_day(now())
);

select cron.unschedule('refresh-daily-metrics')
where exists (select 1 from cron.job where jobname = 'refresh-daily-metrics');
select cron.schedule('refresh-daily-metrics', '*/10 * * * *', $job$ select private.refresh_recent_metrics(); $job$);

-- ---------------------------------------------------------------------------
-- 2. Дашборд
-- ---------------------------------------------------------------------------

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
    where private.msk_day(p.created_at) between p_from and p_to
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

create or replace function public.admin_dashboard_v2(p_from date default null, p_to date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  period_to date := coalesce(p_to, private.msk_day(now()));
  period_from date := coalesce(p_from, period_to - 29);
  span integer;
  previous_to date;
  previous_from date;
  sla integer := private.setting_int('support_sla_minutes', 30);
  errors_last_hour integer;
  errors_hourly_norm numeric;
begin
  perform private.require_admin('support');
  if period_from > period_to then
    raise exception 'period start is after its end' using errcode = '22023';
  end if;
  if period_to - period_from > 366 then
    period_from := period_to - 366;
  end if;
  span := period_to - period_from + 1;
  previous_to := period_from - 1;
  previous_from := previous_to - span + 1;

  -- Сегодняшний день пересчитываем на лету: крон отстаёт до 10 минут.
  if period_to >= private.msk_day(now()) - 1 then
    perform private.refresh_recent_metrics();
  end if;

  select count(*) into errors_last_hour from private.error_events where created_at > now() - interval '1 hour';
  select coalesce(count(*)::numeric / (7 * 24), 0) into errors_hourly_norm
  from private.error_events where created_at > now() - interval '7 days';

  return jsonb_build_object(
    'from', period_from,
    'to', period_to,
    'previousFrom', previous_from,
    'previousTo', previous_to,
    'current', private.period_summary(period_from, period_to),
    'previous', private.period_summary(previous_from, previous_to),
    'errorsLastHour', errors_last_hour,
    'errorsHourlyNorm', round(errors_hourly_norm, 2),
    'errorsAboveNorm', errors_last_hour > greatest(3, errors_hourly_norm * 2),
    'online', (select count(*) from public.profiles where last_seen_at > now() - interval '10 minutes'),
    'series', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', g.day_ts::date,
        'revenue', coalesce(m.revenue_kopecks - m.refunds_kopecks, 0),
        'llmCost', coalesce(m.solution_cost_kopecks + m.chat_cost_kopecks, 0),
        'registrations', coalesce(m.registrations, 0),
        'activeUsers', coalesce(m.active_users, 0),
        'solved', coalesce(m.solved, 0),
        'failed', coalesce(m.failed, 0),
        'errors', coalesce(m.errors, 0),
        'bySubject', coalesce((
          select jsonb_object_agg(s.subject, s.solved) from private.daily_subject_metrics s where s.day = g.day_ts::date and s.solved > 0
        ), '{}'::jsonb)
      ) order by g.day_ts)
      from generate_series(period_from::timestamp, period_to::timestamp, interval '1 day') as g(day_ts)
      left join private.daily_metrics m on m.day = g.day_ts::date
    ), '[]'::jsonb),
    'cohorts', coalesce((
      with cohort as (
        select p.id, date_trunc('week', private.msk_day(p.created_at))::date as week
        from public.profiles p
        where p.created_at > now() - interval '12 weeks'
      )
      select jsonb_agg(jsonb_build_object(
        'week', c.week,
        'size', c.size,
        'retention', (
          select jsonb_agg(
            case when c.week + (k * 7) > private.msk_day(now()) then null
            else round(100.0 * (
              select count(distinct a.user_id) from private.daily_active_users a
              join cohort x on x.id = a.user_id and x.week = c.week
              where a.day >= c.week + (k * 7) and a.day < c.week + ((k + 1) * 7)
            ) / nullif(c.size, 0), 1) end
            order by k)
          from generate_series(0, 7) k
        )
      ) order by c.week)
      from (select week, count(*) as size from cohort group by week) c
    ), '[]'::jsonb),
    'funnel', (
      with regs as (
        select p.id from public.profiles p where private.msk_day(p.created_at) between period_from and period_to
      ),
      first_task as (
        select r.id from regs r
        where exists (select 1 from public.homework_jobs j where j.user_id = r.id)
           or exists (select 1 from public.homework_solution_access a where a.user_id = r.id)
      ),
      exhausted as (
        select f.id from first_task f
        where coalesce((select balance from public.wallet_accounts w where w.user_id = f.id), 0) < 400
           or exists (select 1 from private.request_logs l where l.user_id = f.id and l.status = 402)
           or exists (select 1 from private.verified_balance_top_ups t where t.user_id = f.id)
      ),
      paid as (
        select r.id from regs r where exists (select 1 from private.verified_balance_top_ups t where t.user_id = r.id)
      )
      select jsonb_build_array(
        jsonb_build_object('step', 'registered', 'count', (select count(*) from regs)),
        jsonb_build_object('step', 'first_task', 'count', (select count(*) from first_task)),
        jsonb_build_object('step', 'limit_exhausted', 'count', (select count(*) from exhausted)),
        jsonb_build_object('step', 'paid', 'count', (select count(*) from paid))
      )
    ),
    'attention', jsonb_build_object(
      'slaMinutes', sla,
      'overdueTickets', coalesce((
        select jsonb_agg(jsonb_build_object('id', c.id, 'subject', c.subject, 'email', u.email,
          'waitingMinutes', floor(extract(epoch from (now() - c.last_user_message_at)) / 60)::integer) order by c.last_user_message_at)
        from public.support_conversations c join auth.users u on u.id = c.user_id
        where c.status = 'pending_owner' and c.last_user_message_at < now() - make_interval(mins => sla)
      ), '[]'::jsonb),
      'fraudFlags', coalesce((
        select jsonb_agg(jsonb_build_object('id', f.id, 'userId', f.user_id, 'email', u.email, 'risk', f.risk, 'explanation', f.explanation) order by case f.risk when 'high' then 3 when 'medium' then 2 else 1 end desc, f.created_at desc)
        from (select * from private.fraud_flags where status = 'open' order by created_at desc limit 20) f
        join auth.users u on u.id = f.user_id
      ), '[]'::jsonb),
      'fraudOpen', (select count(*) from private.fraud_flags where status = 'open'),
      'errorSpike', jsonb_build_object('lastHour', errors_last_hour, 'norm', round(errors_hourly_norm, 2), 'spike', errors_last_hour > greatest(3, errors_hourly_norm * 2)),
      'paymentRejections24h', (select count(*) from private.request_logs where status = 402 and created_at > now() - interval '24 hours'),
      'refunds24h', (select count(*) from private.top_up_refunds where created_at > now() - interval '24 hours'),
      'stuckJobs', (select count(*) from public.homework_jobs where status = 'running' and updated_at < now() - interval '5 minutes')
    )
  );
end;
$$;

revoke all on function public.admin_dashboard_v2(date, date) from public, anon;
grant execute on function public.admin_dashboard_v2(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Финансы
-- ---------------------------------------------------------------------------

-- Лента платежей: пополнения (успешные / с возвратом) и отказы оплаты
-- решения, когда баланса не хватило (402 в журнале запросов).
create or replace function public.admin_finance_payments(
  p_status text default 'all',
  p_from date default null,
  p_to date default null,
  p_search text default '',
  p_page integer default 1,
  p_page_size integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  period_to date := coalesce(p_to, private.msk_day(now()));
  period_from date := coalesce(p_from, period_to - 29);
  from_ts timestamptz := (period_from::timestamp at time zone 'Europe/Moscow');
  to_ts timestamptz := ((period_to + 1)::timestamp at time zone 'Europe/Moscow');
  safe_size integer := greatest(1, least(coalesce(p_page_size, 50), 5000));
  safe_page integer := greatest(1, coalesce(p_page, 1));
  search text := trim(coalesce(p_search, ''));
begin
  perform private.require_admin('admin');

  return (
    with feed as (
      select
        t.id::text as id, 'top_up' as type, t.user_id, u.email, t.amount,
        case
          when coalesce((select sum(r.amount) from private.top_up_refunds r where r.top_up_id = t.id), 0) >= t.amount then 'refunded'
          when exists (select 1 from private.top_up_refunds r where r.top_up_id = t.id) then 'partially_refunded'
          else 'succeeded'
        end as status,
        case t.source when 'admin' then 'ручное подтверждение' else 'провайдер' end as method,
        t.provider_reference as reference,
        null::text as reason,
        coalesce((select sum(r.amount) from private.top_up_refunds r where r.top_up_id = t.id), 0) as refunded,
        t.created_at
      from private.verified_balance_top_ups t
      join auth.users u on u.id = t.user_id
      where t.created_at >= from_ts and t.created_at < to_ts
      union all
      select
        r.id::text, 'refund', r.user_id, u.email, r.amount, 'refund', 'возврат', t.provider_reference, r.reason, r.amount, r.created_at
      from private.top_up_refunds r
      join private.verified_balance_top_ups t on t.id = r.top_up_id
      join auth.users u on u.id = r.user_id
      where r.created_at >= from_ts and r.created_at < to_ts
      union all
      select
        l.id::text, 'rejection', l.user_id, u.email, 0, 'failed', l.route, l.request_id,
        coalesce(l.error, 'Не хватило баланса'), 0, l.created_at
      from private.request_logs l
      left join auth.users u on u.id = l.user_id
      where l.status = 402 and l.created_at >= from_ts and l.created_at < to_ts
    ),
    filtered as (
      select * from feed
      where (p_status is null or p_status = 'all' or status = p_status or (p_status = 'failed' and type = 'rejection'))
        and (search = '' or coalesce(email, '') ilike '%' || search || '%' or coalesce(reference, '') ilike '%' || search || '%')
    )
    select jsonb_build_object(
      'total', (select count(*) from filtered),
      'page', safe_page,
      'pageSize', safe_size,
      'from', period_from,
      'to', period_to,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', id, 'type', type, 'userId', user_id, 'email', email, 'amount', amount, 'status', status,
          'method', method, 'reference', reference, 'reason', reason, 'refunded', refunded, 'createdAt', created_at
        ) order by created_at desc)
        from (select * from filtered order by created_at desc limit safe_size offset (safe_page - 1) * safe_size) page_rows
      ), '[]'::jsonb)
    )
  );
end;
$$;

-- Ручной возврат пополнения: деньги уходят ученику вне сервиса, а с его
-- кошелька снимается та же сумма. Только владелец (выплаты).
create or replace function public.admin_finance_refund(p_top_up_id uuid, p_amount integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin('owner');
  top_up private.verified_balance_top_ups%rowtype;
  already integer;
  current_balance integer;
  entry_id uuid;
  refund_id uuid;
  normalized_reason text := trim(coalesce(p_reason, ''));
begin
  if char_length(normalized_reason) not between 3 and 300 then
    raise exception 'refund reason must contain 3 to 300 characters' using errcode = '22023';
  end if;
  select * into top_up from private.verified_balance_top_ups where id = p_top_up_id for update;
  if top_up.id is null then
    raise exception 'top up not found' using errcode = 'P0002';
  end if;
  select coalesce(sum(amount), 0) into already from private.top_up_refunds where top_up_id = p_top_up_id;
  if p_amount is null or p_amount < 1 or p_amount > top_up.amount - already then
    raise exception 'refund amount exceeds the refundable rest' using errcode = '22023';
  end if;

  select balance into current_balance from public.wallet_accounts where user_id = top_up.user_id for update;
  if current_balance is null or current_balance < p_amount then
    raise exception 'balance is lower than the refund' using errcode = '22023';
  end if;

  update public.wallet_accounts set balance = balance - p_amount, updated_at = now() where user_id = top_up.user_id;
  insert into public.wallet_entries (user_id, amount, kind, description, idempotency_key)
  values (top_up.user_id, -p_amount, 'debit', left('Возврат пополнения: ' || normalized_reason, 160), 'top-up-refund:' || gen_random_uuid()::text)
  returning id into entry_id;

  insert into private.top_up_refunds (top_up_id, user_id, actor_id, amount, reason, wallet_entry_id)
  values (p_top_up_id, top_up.user_id, actor, p_amount, normalized_reason, entry_id)
  returning id into refund_id;

  perform private.audit('payment_refunded', top_up.user_id,
    jsonb_build_object('topUpId', p_top_up_id, 'refundId', refund_id, 'reason', normalized_reason),
    jsonb_build_object('balance', current_balance, 'refunded', already),
    jsonb_build_object('balance', current_balance - p_amount, 'refunded', already + p_amount));

  return jsonb_build_object('refundId', refund_id, 'amount', p_amount);
end;
$$;

-- Зависшие резервы решения: списание есть, решения нет, возврата нет,
-- а задача закрыта или заброшена. Это «платёж в pending» нашего кошелька.
create or replace function private.stuck_reservations()
returns table (user_id uuid, email text, idempotency_key text, amount integer, created_at timestamptz, job_status text)
language sql
stable
security definer
set search_path = ''
as $$
  select e.user_id, u.email, e.idempotency_key, -e.amount, e.created_at, j.status
  from public.wallet_entries e
  join auth.users u on u.id = e.user_id
  left join public.homework_jobs j on j.user_id = e.user_id and j.idempotency_key = e.idempotency_key
  where e.kind = 'debit'
    and e.idempotency_key like 'solution-%'
    and e.created_at < now() - interval '10 minutes'
    and e.created_at > now() - interval '30 days'
    and not exists (select 1 from public.wallet_entries r where r.user_id = e.user_id and r.idempotency_key = left(e.idempotency_key || ':refund', 160))
    and not exists (select 1 from public.homework_solution_access a where a.user_id = e.user_id and a.idempotency_key = e.idempotency_key)
    and coalesce(j.status, 'failed') <> 'running';
$$;

revoke all on function private.stuck_reservations() from public, anon, authenticated;

create or replace function public.admin_finance_recheck_reservation(p_user_id uuid, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  reserved public.wallet_entries%rowtype;
  refund_key text := left(p_idempotency_key || ':refund', 160);
  resulting integer;
begin
  perform private.require_admin('admin');

  select * into reserved from public.wallet_entries
  where user_id = p_user_id and idempotency_key = p_idempotency_key and kind = 'debit' for update;
  if reserved.id is null then
    return jsonb_build_object('result', 'no_reservation');
  end if;
  if exists (select 1 from public.homework_solution_access where user_id = p_user_id and idempotency_key = p_idempotency_key) then
    return jsonb_build_object('result', 'delivered');
  end if;
  if exists (select 1 from public.wallet_entries where user_id = p_user_id and idempotency_key = refund_key) then
    return jsonb_build_object('result', 'already_refunded');
  end if;
  if exists (select 1 from public.homework_jobs where user_id = p_user_id and idempotency_key = p_idempotency_key and status = 'running' and updated_at > now() - interval '5 minutes') then
    return jsonb_build_object('result', 'still_running');
  end if;

  update public.wallet_accounts set balance = balance - reserved.amount, updated_at = now()
  where user_id = p_user_id returning balance into resulting;
  insert into public.wallet_entries (user_id, amount, kind, description, idempotency_key)
  values (p_user_id, -reserved.amount, 'credit', 'Возврат: решение не выдано (сверка)', refund_key);

  perform private.audit('reservation_refunded', p_user_id,
    jsonb_build_object('idempotencyKey', p_idempotency_key, 'amount', -reserved.amount),
    null, jsonb_build_object('balance', resulting));
  return jsonb_build_object('result', 'refunded', 'amount', -reserved.amount, 'balance', resulting);
end;
$$;

-- Сверка: пополнения против зачислений и кошельки против книги операций.
create or replace function public.admin_finance_reconciliation()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin('admin');
  return jsonb_build_object(
    'topUpsWithoutEntry', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'userId', t.user_id, 'email', u.email, 'amount', t.amount, 'reference', t.provider_reference, 'createdAt', t.created_at))
      from private.verified_balance_top_ups t
      join auth.users u on u.id = t.user_id
      left join public.wallet_entries e on e.id = t.wallet_entry_id
      where e.id is null or e.amount <> t.amount or e.user_id <> t.user_id
    ), '[]'::jsonb),
    'entriesWithoutTopUp', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'userId', e.user_id, 'email', u.email, 'amount', e.amount, 'key', e.idempotency_key, 'createdAt', e.created_at))
      from public.wallet_entries e
      join auth.users u on u.id = e.user_id
      where e.idempotency_key like 'verified-top-up:%'
        and not exists (select 1 from private.verified_balance_top_ups t where t.wallet_entry_id = e.id)
    ), '[]'::jsonb),
    'walletMismatches', coalesce((
      select jsonb_agg(jsonb_build_object('userId', w.user_id, 'email', u.email, 'balance', w.balance, 'ledger', l.total, 'difference', w.balance - l.total))
      from public.wallet_accounts w
      join auth.users u on u.id = w.user_id
      join lateral (select coalesce(sum(amount), 0)::integer as total from public.wallet_entries e where e.user_id = w.user_id) l on true
      where w.balance <> l.total
    ), '[]'::jsonb),
    'stuckReservations', coalesce((
      select jsonb_agg(jsonb_build_object('userId', s.user_id, 'email', s.email, 'key', s.idempotency_key, 'amount', s.amount, 'createdAt', s.created_at, 'jobStatus', s.job_status) order by s.created_at desc)
      from private.stuck_reservations() s
    ), '[]'::jsonb),
    'checkedAt', now()
  );
end;
$$;

-- Отчёт по выручке: по дням/неделям/месяцам и по тарифу плательщика.
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
  where private.msk_day(created_at) between period_from and period_to;
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
        where private.msk_day(t.created_at) between period_from and period_to
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
        where c.user_id in (select distinct user_id from private.verified_balance_top_ups where private.msk_day(created_at) between period_from and period_to)
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

revoke all on function public.admin_finance_payments(text, date, date, text, integer, integer) from public, anon;
grant execute on function public.admin_finance_payments(text, date, date, text, integer, integer) to authenticated;
revoke all on function public.admin_finance_refund(uuid, integer, text) from public, anon;
grant execute on function public.admin_finance_refund(uuid, integer, text) to authenticated;
revoke all on function public.admin_finance_recheck_reservation(uuid, text) from public, anon;
grant execute on function public.admin_finance_recheck_reservation(uuid, text) to authenticated;
revoke all on function public.admin_finance_reconciliation() from public, anon;
grant execute on function public.admin_finance_reconciliation() to authenticated;
revoke all on function public.admin_finance_report(date, date, text) from public, anon;
grant execute on function public.admin_finance_report(date, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Мониторинг: ошибки
-- ---------------------------------------------------------------------------

create or replace function public.admin_errors_list(
  p_status text default null,
  p_kind text default null,
  p_severity text default null,
  p_route text default null,
  p_search text default '',
  p_page integer default 1,
  p_page_size integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_size integer := greatest(1, least(coalesce(p_page_size, 50), 500));
  safe_page integer := greatest(1, coalesce(p_page, 1));
  search text := trim(coalesce(p_search, ''));
begin
  perform private.require_admin('admin');
  return (
    with filtered as (
      select * from private.error_groups g
      where (p_status is null or p_status = 'all' or g.status = p_status or (p_status = 'open' and g.status in ('new', 'in_progress')))
        and (p_kind is null or g.kind = p_kind)
        and (p_severity is null or g.severity = p_severity)
        and (p_route is null or g.route = p_route)
        and (search = '' or g.title ilike '%' || search || '%' or g.fingerprint = search)
    )
    select jsonb_build_object(
      'total', (select count(*) from filtered),
      'page', safe_page,
      'pageSize', safe_size,
      'routes', (select coalesce(jsonb_agg(distinct route), '[]'::jsonb) from private.error_groups where route is not null),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'fingerprint', g.fingerprint, 'kind', g.kind, 'severity', g.severity, 'route', g.route, 'title', g.title,
          'status', g.status, 'occurrences', g.occurrences, 'usersAffected', g.users_affected,
          'firstSeenAt', g.first_seen_at, 'lastSeenAt', g.last_seen_at,
          'trend', (
            select jsonb_agg((select count(*) from private.error_events e where e.fingerprint = g.fingerprint
              and e.created_at >= (private.msk_day(now()) - k)::timestamp at time zone 'Europe/Moscow'
              and e.created_at < (private.msk_day(now()) - k + 1)::timestamp at time zone 'Europe/Moscow') order by k desc)
            from generate_series(0, 6) k
          ),
          'lastHour', (select count(*) from private.error_events e where e.fingerprint = g.fingerprint and e.created_at > now() - interval '1 hour')
        ) order by g.last_seen_at desc)
        from (select * from filtered order by last_seen_at desc limit safe_size offset (safe_page - 1) * safe_size) g
      ), '[]'::jsonb)
    )
  );
end;
$$;

create or replace function public.admin_error_detail(p_fingerprint text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin('admin');
  return jsonb_build_object(
    'group', (select to_jsonb(g) from private.error_groups g where g.fingerprint = p_fingerprint),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'message', e.message, 'stack', e.stack, 'requestId', e.request_id, 'userId', e.user_id,
        'email', u.email, 'guestId', e.guest_id, 'ip', e.ip, 'input', e.input, 'environment', e.environment,
        'route', e.route, 'createdAt', e.created_at
      ) order by e.created_at desc)
      from (select * from private.error_events where fingerprint = p_fingerprint order by created_at desc limit 50) e
      left join auth.users u on u.id = e.user_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_error_set_status(p_fingerprint text, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin('admin');
  previous text;
begin
  if p_status not in ('new', 'in_progress', 'resolved', 'ignored') then
    raise exception 'invalid error status' using errcode = '22023';
  end if;
  select status into previous from private.error_groups where fingerprint = p_fingerprint for update;
  if previous is null then
    raise exception 'error group not found' using errcode = 'P0002';
  end if;
  update private.error_groups
  set status = p_status,
      resolved_at = case when p_status = 'resolved' then now() else null end,
      resolved_by = case when p_status = 'resolved' then actor else null end
  where fingerprint = p_fingerprint;
  perform private.audit('error_status_changed', null, jsonb_build_object('fingerprint', p_fingerprint),
    jsonb_build_object('status', previous), jsonb_build_object('status', p_status));
  return jsonb_build_object('fingerprint', p_fingerprint, 'status', p_status);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Мониторинг: метрики качества
-- ---------------------------------------------------------------------------

create or replace function public.admin_quality(p_from date default null, p_to date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  period_to date := coalesce(p_to, private.msk_day(now()));
  period_from date := coalesce(p_from, period_to - 29);
  from_ts timestamptz := (period_from::timestamp at time zone 'Europe/Moscow');
  to_ts timestamptz := ((period_to + 1)::timestamp at time zone 'Europe/Moscow');
begin
  perform private.require_admin('admin');
  return jsonb_build_object(
    'from', period_from,
    'to', period_to,
    'bySubject', coalesce((
      select jsonb_agg(jsonb_build_object(
        'subject', s.subject, 'total', s.total, 'solved', s.solved, 'failed', s.failed, 'truncated', s.truncated,
        'truncatedShare', case when s.total > 0 then round(100.0 * s.truncated / s.total, 1) else 0 end,
        'failedShare', case when s.total > 0 then round(100.0 * s.failed / s.total, 1) else 0 end,
        'share', round(100.0 * s.total / nullif(s.grand_total, 0), 1),
        'helpful', r.helpful, 'notHelpful', r.not_helpful,
        'helpfulShare', case when coalesce(r.helpful, 0) + coalesce(r.not_helpful, 0) > 0
          then round(100.0 * r.helpful / (r.helpful + r.not_helpful), 1) end,
        'p50', s.p50, 'p95', s.p95
      ) order by s.total desc)
      from (
        select coalesce(nullif(subject, ''), 'Без предмета') as subject,
          count(*) as total,
          sum(count(*)) over () as grand_total,
          count(*) filter (where outcome = 'solved') as solved,
          count(*) filter (where outcome = 'failed') as failed,
          count(*) filter (where truncated) as truncated,
          round(percentile_cont(0.5) within group (order by seconds)::numeric, 1) as p50,
          round(percentile_cont(0.95) within group (order by seconds)::numeric, 1) as p95
        from private.solution_costs
        where created_at >= from_ts and created_at < to_ts
        group by 1
      ) s
      left join (
        select coalesce(nullif(subject, ''), 'Без предмета') as subject,
          count(*) filter (where helpful) as helpful, count(*) filter (where not helpful) as not_helpful
        from private.solution_ratings where created_at >= from_ts and created_at < to_ts group by 1
      ) r on r.subject = s.subject
    ), '[]'::jsonb),
    'latency', (
      select jsonb_build_object(
        'p50', round(percentile_cont(0.5) within group (order by seconds)::numeric, 1),
        'p95', round(percentile_cont(0.95) within group (order by seconds)::numeric, 1),
        'p99', round(percentile_cont(0.99) within group (order by seconds)::numeric, 1),
        'count', count(*)
      )
      from private.solution_costs where outcome = 'solved' and created_at >= from_ts and created_at < to_ts
    ),
    'chatLatency', (
      select jsonb_build_object(
        'p50', round((percentile_cont(0.5) within group (order by duration_ms) / 1000)::numeric, 1),
        'p95', round((percentile_cont(0.95) within group (order by duration_ms) / 1000)::numeric, 1),
        'p99', round((percentile_cont(0.99) within group (order by duration_ms) / 1000)::numeric, 1),
        'count', count(*)
      )
      from public.chat_generations where status = 'succeeded' and duration_ms is not null and created_at >= from_ts and created_at < to_ts
    ),
    'answerLength', coalesce((
      select jsonb_agg(jsonb_build_object('bucket', bucket, 'count', total) order by bucket)
      from (
        select least(floor(answer_chars / 500) * 500, 6000)::integer as bucket, count(*) as total
        from private.solution_logs
        where outcome = 'solved' and created_at >= from_ts and created_at < to_ts
        group by 1
      ) b
    ), '[]'::jsonb),
    'diagrams', jsonb_build_object(
      'withDiagram', (select count(*) from private.solution_costs where has_diagram and created_at >= from_ts and created_at < to_ts),
      'total', (select count(*) from private.solution_costs where created_at >= from_ts and created_at < to_ts),
      'complaints', (select count(*) from public.support_conversations where category = 'wrong_solution' and created_at >= from_ts and created_at < to_ts),
      'notHelpful', (select count(*) from private.solution_ratings where not helpful and created_at >= from_ts and created_at < to_ts)
    ),
    'rateLimit', jsonb_build_object(
      'hits', (select count(*) from private.request_logs where status = 429 and created_at >= from_ts and created_at < to_ts),
      'users', (select count(distinct coalesce(user_id::text, guest_id::text, ip)) from private.request_logs where status = 429 and created_at >= from_ts and created_at < to_ts),
      'byRoute', coalesce((
        select jsonb_object_agg(route, total) from (
          select route, count(*) as total from private.request_logs where status = 429 and created_at >= from_ts and created_at < to_ts group by route
        ) r
      ), '{}'::jsonb)
    ),
    'chatTruncated', jsonb_build_object(
      'total', (select count(*) from public.chat_generations where created_at >= from_ts and created_at < to_ts),
      'failed', (select count(*) from public.chat_generations where status = 'failed' and created_at >= from_ts and created_at < to_ts)
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Мониторинг: логи
-- ---------------------------------------------------------------------------

create or replace function public.admin_logs_search(
  p_kind text default 'requests',
  p_query text default '',
  p_request_id text default null,
  p_user_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_page integer default 1,
  p_page_size integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_size integer := greatest(1, least(coalesce(p_page_size, 100), 1000));
  safe_page integer := greatest(1, coalesce(p_page, 1));
  query text := trim(coalesce(p_query, ''));
  request_filter text := nullif(trim(coalesce(p_request_id, '')), '');
  from_ts timestamptz := coalesce(p_from, now() - interval '30 days');
  to_ts timestamptz := coalesce(p_to, now() + interval '1 minute');
begin
  perform private.require_admin('admin');

  if p_kind = 'solutions' then
    return (
      with filtered as (
        select l.* from private.solution_logs l
        where l.created_at between from_ts and to_ts
          and (request_filter is null or l.request_id = request_filter or l.idempotency_key = request_filter)
          and (p_user_id is null or l.user_id = p_user_id)
          and (query = '' or l.condition ilike '%' || query || '%' or l.task ilike '%' || query || '%'
            or coalesce(l.error, '') ilike '%' || query || '%' or l.subject ilike '%' || query || '%')
      )
      select jsonb_build_object(
        'total', (select count(*) from filtered),
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', l.id, 'requestId', l.request_id, 'key', l.idempotency_key, 'userId', l.user_id, 'email', u.email,
            'subject', l.subject, 'task', l.task, 'outcome', l.outcome, 'status', l.status, 'error', l.error,
            'models', l.models, 'seconds', l.seconds, 'costKopecks', l.cost_kopecks, 'createdAt', l.created_at,
            'preview', left(l.condition, 160)
          ) order by l.created_at desc)
          from (select * from filtered order by created_at desc limit safe_size offset (safe_page - 1) * safe_size) l
          left join auth.users u on u.id = l.user_id
        ), '[]'::jsonb)
      )
    );
  end if;

  return (
    with filtered as (
      select l.* from private.request_logs l
      where l.created_at between from_ts and to_ts
        and (request_filter is null or l.request_id = request_filter)
        and (p_user_id is null or l.user_id = p_user_id)
        and (query = '' or l.route ilike '%' || query || '%' or coalesce(l.error, '') ilike '%' || query || '%'
          or coalesce(l.ip, '') = query or l.status::text = query)
    )
    select jsonb_build_object(
      'total', (select count(*) from filtered),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', l.id, 'requestId', l.request_id, 'route', l.route, 'method', l.method, 'status', l.status,
          'userId', l.user_id, 'email', u.email, 'guestId', l.guest_id, 'ip', l.ip, 'userAgent', l.user_agent,
          'durationMs', l.duration_ms, 'bytesIn', l.bytes_in, 'error', l.error, 'createdAt', l.created_at
        ) order by l.created_at desc)
        from (select * from filtered order by created_at desc limit safe_size offset (safe_page - 1) * safe_size) l
        left join auth.users u on u.id = l.user_id
      ), '[]'::jsonb)
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Health: внешние зависимости и очередь
-- ---------------------------------------------------------------------------

create table if not exists private.health_checks (
  service text primary key,
  ok boolean not null,
  status text not null,
  latency_ms integer,
  detail text,
  checked_at timestamptz not null default now(),
  last_ok_at timestamptz,
  down_since timestamptz
);

create table if not exists private.health_history (
  id bigint generated always as identity primary key,
  service text not null,
  ok boolean not null,
  latency_ms integer,
  checked_at timestamptz not null default now()
);

create index if not exists health_history_service_idx on private.health_history (service, checked_at desc);

alter table private.health_checks enable row level security;
alter table private.health_history enable row level security;
revoke all on table private.health_checks, private.health_history from public, anon, authenticated;

create or replace function public.admin_health()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin('support');
  return jsonb_build_object(
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
        'service', h.service, 'ok', h.ok, 'status', h.status, 'latencyMs', h.latency_ms, 'detail', h.detail,
        'checkedAt', h.checked_at, 'lastOkAt', h.last_ok_at, 'downSince', h.down_since,
        'uptime24h', (
          select round(100.0 * count(*) filter (where ok) / nullif(count(*), 0), 2)
          from private.health_history x where x.service = h.service and x.checked_at > now() - interval '24 hours'
        ),
        'uptime7d', (
          select round(100.0 * count(*) filter (where ok) / nullif(count(*), 0), 2)
          from private.health_history x where x.service = h.service and x.checked_at > now() - interval '7 days'
        )
      ) order by h.service)
      from private.health_checks h
    ), '[]'::jsonb),
    'database', jsonb_build_object(
      'ok', true,
      'now', now(),
      'sizeBytes', pg_database_size(current_database()),
      'connections', (select count(*) from pg_stat_activity)
    ),
    'storage', jsonb_build_object(
      'buckets', (select count(*) from storage.buckets),
      'objects', (select count(*) from storage.objects),
      'bytes', (select coalesce(sum((metadata ->> 'size')::bigint), 0) from storage.objects)
    ),
    'queue', jsonb_build_object(
      'queued', (select count(*) from public.homework_jobs where status = 'queued'),
      'running', (select count(*) from public.homework_jobs where status = 'running'),
      'stuck', (select count(*) from public.homework_jobs where status = 'running' and updated_at < now() - interval '5 minutes'),
      'staleQueued', (select count(*) from public.homework_jobs where status = 'queued' and created_at < now() - interval '20 minutes'),
      'failedLastHour', (select count(*) from public.homework_jobs where status = 'failed' and updated_at > now() - interval '1 hour'),
      'doneLastHour', (select count(*) from public.homework_jobs where status = 'done' and updated_at > now() - interval '1 hour'),
      'chatReserved', (select count(*) from public.chat_generations where status = 'reserved'),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object('key', j.idempotency_key, 'userId', j.user_id, 'email', u.email, 'subject', j.subject,
          'status', j.status, 'stage', j.stage, 'createdAt', j.created_at, 'updatedAt', j.updated_at) order by j.created_at)
        from public.homework_jobs j left join auth.users u on u.id = j.user_id
        where j.status in ('queued', 'running')
      ), '[]'::jsonb)
    ),
    'cron', coalesce((
      select jsonb_agg(jsonb_build_object(
        'job', j.jobname, 'schedule', j.schedule, 'active', j.active,
        'lastRun', (select jsonb_build_object('status', r.status, 'startedAt', r.start_time, 'message', left(r.return_message, 200))
          from cron.job_run_details r where r.jobid = j.jobid order by r.start_time desc limit 1)
      ) order by j.jobname)
      from cron.job j
    ), '[]'::jsonb)
  );
end;
$$;

-- Закрыть зависшую задачу из админки: срок уже вышел, а вкладка не пришла.
create or replace function public.admin_expire_stuck_jobs()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_count integer;
  after_count integer;
begin
  perform private.require_admin('admin');
  select count(*) into before_count from public.homework_jobs where status in ('queued', 'running');
  perform private.expire_stale_homework_jobs();
  select count(*) into after_count from public.homework_jobs where status in ('queued', 'running');
  perform private.audit('jobs_expired', null, jsonb_build_object('closed', before_count - after_count));
  return jsonb_build_object('closed', before_count - after_count);
end;
$$;

revoke all on function public.admin_errors_list(text, text, text, text, text, integer, integer) from public, anon;
grant execute on function public.admin_errors_list(text, text, text, text, text, integer, integer) to authenticated;
revoke all on function public.admin_error_detail(text) from public, anon;
grant execute on function public.admin_error_detail(text) to authenticated;
revoke all on function public.admin_error_set_status(text, text) from public, anon;
grant execute on function public.admin_error_set_status(text, text) to authenticated;
revoke all on function public.admin_quality(date, date) from public, anon;
grant execute on function public.admin_quality(date, date) to authenticated;
revoke all on function public.admin_logs_search(text, text, text, uuid, timestamptz, timestamptz, integer, integer) from public, anon;
grant execute on function public.admin_logs_search(text, text, text, uuid, timestamptz, timestamptz, integer, integer) to authenticated;
revoke all on function public.admin_health() from public, anon;
grant execute on function public.admin_health() to authenticated;
revoke all on function public.admin_expire_stuck_jobs() from public, anon;
grant execute on function public.admin_expire_stuck_jobs() to authenticated;

-- Лента ошибок в реальном времени: админка слушает вставки в группы.
-- Таблица в private, поэтому в Realtime уходит только сигнал через
-- публичную таблицу-колокольчик без содержимого.
create table if not exists public.admin_signals (
  id bigint generated always as identity primary key,
  kind text not null,
  created_at timestamptz not null default now()
);

alter table public.admin_signals enable row level security;
revoke all on table public.admin_signals from public, anon, authenticated;
grant select on table public.admin_signals to authenticated;

drop policy if exists admin_signals_agent on public.admin_signals;
create policy admin_signals_agent on public.admin_signals for select to authenticated
  using ((select public.is_support_agent()));

do $$
begin
  alter publication supabase_realtime add table public.admin_signals;
exception
  when duplicate_object then null;
end;
$$;

create or replace function private.signal_error_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.admin_signals (kind) values ('error');
  return new;
end;
$$;

revoke all on function private.signal_error_event() from public, anon, authenticated;
drop trigger if exists error_events_signal on private.error_events;
create trigger error_events_signal after insert on private.error_events
  for each row execute function private.signal_error_event();
