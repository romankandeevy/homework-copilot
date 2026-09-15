-- Аудит админки 15 сентября 2026: статистика без исключений, агрегаты раз в
-- 5 минут, ежедневная сводка по настройкам, очистка статистики, предметы в
-- фокусе.
--
-- 1. Служебные аккаунты больше нигде не вычёркиваются из статистики.
--    12 сентября их отсекли: ручные пополнения владельца самому себе
--    читались как выручка. 15 сентября владелец открыл дашборд и не нашёл
--    своих задач: из 60 решений за 30 дней 59 были с его аккаунта, и
--    дашборд показывал одно. Решение владельца: только реальные данные, без
--    исключений. private.is_staff остаётся правом (тестовый платёж
--    Робокассы, отметка в списке пользователей), а не фильтром статистики.
--
-- 2. Агрегаты дашборда пересчитываются раз в 5 минут, а не в 10: админка
--    обновляется сама не реже раза в 5 минут, и цифрам незачем отставать.
--
-- 3. Ежедневная сводка настраивается: что в ней, в какие часы и по каким
--    дням, за вчера целиком или за сегодня до момента отправки. Раньше был
--    один час и зашитый состав. Предпросмотр и «Отправить сейчас» - из
--    админки. Прежний ключ daily_summary_hour принимается и дальше: его
--    сохраняет уже выкаченная админка, и он становится часом сводки.
--
-- 4. Очистка статистики - только владельцу: задачи и журнал решений,
--    оценки, ошибки, журнал запросов, активность - за период, целиком или
--    только своего аккаунта. Деньги (кошельки, пополнения, возвраты,
--    заказы) не удаляются никогда. Сначала подсчёт без удаления, потом
--    удаление; каждое удаление - в журнале действий.
--
-- 5. Предметы в фокусе на вкладке «Качество» выбирает владелец: ключ
--    quality_focus_subjects, пустой список - выбор автоматический.
--
-- 6. Выручка - только настоящие деньги. Раз служебные больше не
--    вычитаются, в «Заработано» попали бы ручные зачисления владельца
--    самому себе (source = 'admin') и тестовые оплаты Робокассы
--    (robokassa-test:). Теперь выручка - боевые оплаты провайдера, ручные
--    зачисления - отдельной строкой. «Отработано» не считает возврат
--    пополнения и ручные списания: это не работа сервиса. Налог НПД и
--    комиссия Робокассы считаются по ставкам из настроек (money_rates).

-- ---------------------------------------------------------------------------
-- 1. Статистика без исключений, выручка - только настоящие деньги
-- ---------------------------------------------------------------------------

-- Ставки для налога и комиссии. НПД с физлиц - 4 %, с вычетом 10 000 ₽ -
-- 3 %, пока вычет не израсходован (422-ФЗ, npd.nalog.ru). Налог берётся с
-- полной суммы пополнения в момент оплаты, комиссия базу не уменьшает.
-- Комиссия Робокассы для самозанятых по карте на тарифе «Базовый» - 3,9 %;
-- точную ставку владелец видит в кабинете и меняет в настройках.
create or replace function private.money_rates()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  stored jsonb;
  tax numeric := 4;
  fee numeric := 3.9;
  deduction boolean := false;
begin
  select value into stored from private.app_settings where key = 'money_rates';
  if jsonb_typeof(stored) = 'object' then
    if jsonb_typeof(stored -> 'taxPercent') = 'number' then tax := (stored ->> 'taxPercent')::numeric; end if;
    if jsonb_typeof(stored -> 'feePercent') = 'number' then fee := (stored ->> 'feePercent')::numeric; end if;
    if jsonb_typeof(stored -> 'deduction') = 'boolean' then deduction := (stored ->> 'deduction')::boolean; end if;
  end if;
  return jsonb_build_object(
    'taxPercent', tax,
    'feePercent', fee,
    'deduction', deduction,
    -- Вычет снижает ставку с физлиц на один пункт: 4 % становится 3 %.
    'effectiveTaxPercent', greatest(tax - case when deduction then 1 else 0 end, 0)
  );
end;
$$;

revoke all on function private.money_rates() from public, anon, authenticated;


create or replace function private.dashboard_counts(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with money as (
    select
      coalesce((select sum(amount) from private.verified_balance_top_ups
        where source = 'provider' and provider_reference not like 'robokassa-test:%' and created_at >= p_from and created_at < p_to), 0) as gross,
      coalesce((select sum(amount) from private.top_up_refunds
        where created_at >= p_from and created_at < p_to), 0) as refunds,
      private.money_rates() as rates
  )
  select jsonb_build_object(
    'solved', (select count(*) from private.solution_costs where outcome = 'solved' and created_at >= p_from and created_at < p_to),
    'failed', (select count(*) from private.solution_costs where outcome = 'failed' and created_at >= p_from and created_at < p_to),
    -- Пришло: боевые оплаты провайдера минус возвраты пополнений.
    'revenue', m.gross - m.refunds,
    'grossRevenue', m.gross,
    'refunds', m.refunds,
    -- Комиссия - с каждого платежа, налог - с того, что осталось у сервиса.
    'fee', round(m.gross * (m.rates ->> 'feePercent')::numeric / 100),
    'tax', round(greatest(m.gross - m.refunds, 0) * (m.rates ->> 'effectiveTaxPercent')::numeric / 100),
    -- Ручные зачисления - не выручка: денег провайдер не приносил.
    'manualTopUps', coalesce((select sum(amount) from private.verified_balance_top_ups
        where source = 'admin' and created_at >= p_from and created_at < p_to), 0),
    'topUps', (select count(*) from private.verified_balance_top_ups
        where source = 'provider' and provider_reference not like 'robokassa-test:%' and created_at >= p_from and created_at < p_to),
    'payers', (select count(distinct user_id) from private.verified_balance_top_ups
        where source = 'provider' and provider_reference not like 'robokassa-test:%' and created_at >= p_from and created_at < p_to),
    'firstPayers', (select count(*) from private.verified_balance_top_ups t
        where t.source = 'provider' and t.provider_reference not like 'robokassa-test:%'
          and t.created_at >= p_from and t.created_at < p_to
          and not exists (select 1 from private.verified_balance_top_ups e
            where e.user_id = t.user_id and e.source = 'provider' and e.provider_reference not like 'robokassa-test:%' and e.created_at < t.created_at)),
    -- Отработано: списания за решения и чат минус возвраты за неудачные
    -- решения. Возврат пополнения и ручное списание - не работа сервиса.
    'consumption', coalesce((select sum(-e.amount) from public.wallet_entries e
        where e.kind = 'debit' and e.created_at >= p_from and e.created_at < p_to
          and e.idempotency_key not like 'top-up-refund:%' and e.idempotency_key not like 'admin:%'), 0)
      - coalesce((select sum(e.amount) from public.wallet_entries e
        where e.kind = 'credit' and e.idempotency_key like '%:refund' and e.created_at >= p_from and e.created_at < p_to), 0),
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
  )
  from money m;
$$;


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
      100.0 * (select count(*) from regs r where exists (select 1 from private.verified_balance_top_ups t where t.user_id = r.id and t.source = 'provider' and t.provider_reference not like 'robokassa-test:%'))
      / (select count(*) from regs), 1) end
  );
$$;


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
        where source = 'provider' and provider_reference not like 'robokassa-test:%' and created_at >= day_start and created_at < day_end),
      (select count(*) from private.verified_balance_top_ups
        where source = 'provider' and provider_reference not like 'robokassa-test:%' and created_at >= day_start and created_at < day_end),
      (select count(*) from private.verified_balance_top_ups t
        where t.source = 'provider' and t.provider_reference not like 'robokassa-test:%'
          and t.created_at >= day_start and t.created_at < day_end
          and not exists (select 1 from private.verified_balance_top_ups e
            where e.user_id = t.user_id and e.source = 'provider' and e.provider_reference not like 'robokassa-test:%' and e.created_at < t.created_at)),
      (select coalesce(sum(amount), 0) from private.top_up_refunds
        where created_at >= day_start and created_at < day_end),
      (select coalesce(sum(-amount), 0) from public.wallet_entries where kind = 'debit' and created_at >= day_start and created_at < day_end
        and idempotency_key not like 'top-up-refund:%' and idempotency_key not like 'admin:%')
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
    'money', jsonb_build_object(
      'allTimeRevenue', coalesce((select sum(t.amount) from private.verified_balance_top_ups t where t.source = 'provider' and t.provider_reference not like 'robokassa-test:%'), 0)
        - coalesce((select sum(r.amount) from private.top_up_refunds r), 0),
      'payersAllTime', (select count(distinct t.user_id) from private.verified_balance_top_ups t where t.source = 'provider' and t.provider_reference not like 'robokassa-test:%'),
      'firstPaymentAt', (select min(t.created_at) from private.verified_balance_top_ups t where t.source = 'provider' and t.provider_reference not like 'robokassa-test:%'),
      'walletLiability', coalesce((select sum(w.balance) from public.wallet_accounts w), 0),
      'walletsWithMoney', (select count(*) from public.wallet_accounts w where w.balance > 0),
      'manualAllTime', coalesce((select sum(t.amount) from private.verified_balance_top_ups t where t.source = 'admin'), 0),
      'rates', private.money_rates()
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
  where source = 'provider' and provider_reference not like 'robokassa-test:%' and private.msk_day(created_at) between period_from and period_to;
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
        where t.source = 'provider' and t.provider_reference not like 'robokassa-test:%'
          and private.msk_day(t.created_at) between period_from and period_to
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
          where source = 'provider' and provider_reference not like 'robokassa-test:%' and private.msk_day(created_at) between period_from and period_to)
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


create or replace function public.admin_signal_counts()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  role_name text;
  sla integer := private.setting_int('support_sla_minutes', 30);
begin
  perform private.require_admin('support');
  role_name := private.current_admin_role();
  return jsonb_build_object(
    'pendingTickets', (select count(*) from public.support_conversations where status = 'pending_owner'),
    'overdueTickets', (select count(*) from public.support_conversations
      where status = 'pending_owner' and last_user_message_at < now() - make_interval(mins => sla)),
    'openFlags', case when private.admin_role_rank(role_name) >= 2 then (select count(*) from private.fraud_flags where status = 'open') else 0 end,
    'openErrors', case when private.admin_role_rank(role_name) >= 2 then (select count(*) from private.error_groups where status = 'new') else 0 end,
    'online', (select count(*) from public.profiles where last_seen_at > now() - interval '10 minutes')
  );
end;
$$;


create or replace function public.admin_users_stats()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin('support');

  return jsonb_build_object(
    'students', (select count(*) from public.profiles p),
    'new7d', (select count(*) from public.profiles p
      where p.created_at > now() - interval '7 days'),
    'payers', (select count(distinct t.user_id) from private.verified_balance_top_ups t where t.source = 'provider' and t.provider_reference not like 'robokassa-test:%'),
    'paidKopecks',
      coalesce((select sum(t.amount) from private.verified_balance_top_ups t where t.source = 'provider' and t.provider_reference not like 'robokassa-test:%'), 0)
      - coalesce((select sum(r.amount) from private.top_up_refunds r), 0),
    'online', (select count(*) from public.profiles p
      where p.last_seen_at > now() - interval '10 minutes'),
    'balanceCeiling', coalesce((select max(w.balance) from public.wallet_accounts w), 0)
  );
end;
$$;

-- Пересчёт всей истории: прежние дни посчитаны без служебных аккаунтов.
select private.refresh_daily_metrics(
  coalesce((select private.msk_day(min(created_at)) from public.profiles), private.msk_day(now())),
  private.msk_day(now())
);

-- ---------------------------------------------------------------------------
-- 2. Агрегаты раз в 5 минут
-- ---------------------------------------------------------------------------

select cron.unschedule('refresh-daily-metrics')
where exists (select 1 from cron.job where jobname = 'refresh-daily-metrics');
select cron.schedule('refresh-daily-metrics', '*/5 * * * *', $job$ select private.refresh_recent_metrics(); $job$);

-- ---------------------------------------------------------------------------
-- 3. Ежедневная сводка по настройкам
-- ---------------------------------------------------------------------------

-- Настройки сводки: часы (МСК), дни недели (1 - понедельник), период и
-- блоки. Неверное - исключение с понятным текстом: его читает админка.
create or replace function private.normalize_daily_summary(p_value jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  known text[] := array['revenue', 'consumption', 'llm_cost', 'registrations', 'active', 'solved', 'subjects', 'speed', 'errors', 'fraud', 'support', 'wallets'];
  hours jsonb;
  days jsonb;
  blocks jsonb;
  period text := coalesce(p_value ->> 'period', 'yesterday');
begin
  if p_value is null or jsonb_typeof(p_value) <> 'object' then
    raise exception 'Настройки сводки должны быть объектом.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_value -> 'hours', 'null'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_value -> 'days', 'null'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_value -> 'blocks', 'null'::jsonb)) <> 'array' then
    raise exception 'В настройках сводки нужны списки часов, дней и блоков.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_value -> 'hours') e
    where jsonb_typeof(e) <> 'number' or (e #>> '{}')::numeric not in (select generate_series(0, 23))
  ) then
    raise exception 'Час сводки - целое число от 0 до 23.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_value -> 'days') e
    where jsonb_typeof(e) <> 'number' or (e #>> '{}')::numeric not in (select generate_series(1, 7))
  ) then
    raise exception 'День недели сводки - число от 1 (понедельник) до 7 (воскресенье).' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_value -> 'blocks') e
    where jsonb_typeof(e) <> 'string' or not ((e #>> '{}') = any(known))
  ) then
    raise exception 'В сводке неизвестный блок.' using errcode = '22023';
  end if;
  if period not in ('yesterday', 'today') then
    raise exception 'Период сводки - вчера или сегодня.' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(h order by h), '[]'::jsonb) into hours
  from (select distinct (e #>> '{}')::integer as h from jsonb_array_elements(p_value -> 'hours') e) x;
  select coalesce(jsonb_agg(d order by d), '[]'::jsonb) into days
  from (select distinct (e #>> '{}')::integer as d from jsonb_array_elements(p_value -> 'days') e) x;
  -- Блоки - в порядке сводки, а не в порядке нажатия.
  select coalesce(jsonb_agg(k.block order by k.position), '[]'::jsonb) into blocks
  from unnest(known) with ordinality as k(block, position)
  where k.block in (select jsonb_array_elements_text(p_value -> 'blocks'));

  if jsonb_array_length(hours) = 0 or jsonb_array_length(hours) > 6 then
    raise exception 'Сводка уходит от одного до шести раз в день.' using errcode = '22023';
  end if;
  if jsonb_array_length(days) = 0 then
    raise exception 'Выбери хотя бы один день недели.' using errcode = '22023';
  end if;
  if jsonb_array_length(blocks) = 0 then
    raise exception 'В сводке должен быть хотя бы один блок.' using errcode = '22023';
  end if;

  return jsonb_build_object('hours', hours, 'days', days, 'period', period, 'blocks', blocks);
end;
$$;

revoke all on function private.normalize_daily_summary(jsonb) from public, anon, authenticated;

-- Действующие настройки. Нет своих - прежний час и прежний состав.
create or replace function private.daily_summary_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  stored jsonb;
begin
  select value into stored from private.app_settings where key = 'daily_summary';
  if stored is not null then
    begin
      return private.normalize_daily_summary(stored);
    exception when others then
      null;
    end;
  end if;
  return jsonb_build_object(
    'hours', jsonb_build_array(least(greatest(private.setting_int('daily_summary_hour', 9), 0), 23)),
    'days', '[1, 2, 3, 4, 5, 6, 7]'::jsonb,
    'period', 'yesterday',
    'blocks', '["revenue", "llm_cost", "registrations", "active", "solved", "errors", "fraud", "support"]'::jsonb
  );
end;
$$;

revoke all on function private.daily_summary_config() from public, anon, authenticated;

-- Текст сводки за день по выбранным блокам.
create or replace function private.build_daily_summary(p_day date, p_config jsonb, p_title text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  m private.daily_metrics%rowtype;
  blocks text[] := array(select jsonb_array_elements_text(p_config -> 'blocks'));
  lines text[] := array[p_title];
  subjects text;
  seconds numeric;
  tasks bigint;
begin
  select * into m from private.daily_metrics where day = p_day;

  if 'revenue' = any(blocks) then
    lines := lines || format('Пришло денег: %s (пополнений: %s)',
      private.format_rub(coalesce(m.revenue_kopecks - m.refunds_kopecks, 0)), coalesce(m.top_ups, 0));
  end if;
  if 'consumption' = any(blocks) then
    lines := lines || format('Списано с кошельков за решения и чат: %s', private.format_rub(coalesce(m.consumption_kopecks, 0)));
  end if;
  if 'llm_cost' = any(blocks) then
    lines := lines || format('Расход на модели: %s', private.format_rub(coalesce(m.solution_cost_kopecks + m.chat_cost_kopecks, 0)));
  end if;
  if 'registrations' = any(blocks) then
    lines := lines || format('Регистрации: %s', coalesce(m.registrations, 0));
  end if;
  if 'active' = any(blocks) then
    lines := lines || format('Активных: %s', coalesce(m.active_users, 0));
  end if;
  if 'solved' = any(blocks) then
    lines := lines || format('Задач решено: %s, не решено: %s', coalesce(m.solved, 0), coalesce(m.failed, 0));
  end if;
  if 'subjects' = any(blocks) then
    select string_agg(s.subject || ' ' || (s.solved + s.failed), ', ' order by s.solved + s.failed desc, s.subject)
    into subjects
    from (
      select * from private.daily_subject_metrics
      where day = p_day and solved + failed > 0
      order by solved + failed desc, subject
      limit 5
    ) s;
    lines := lines || ('Предметы: ' || coalesce(subjects, 'задач не было'));
  end if;
  if 'speed' = any(blocks) then
    select sum(seconds_total), sum(solved + failed) into seconds, tasks
    from private.daily_subject_metrics where day = p_day;
    lines := lines || case
      when coalesce(tasks, 0) > 0 then format('Среднее время решения: %s с', round(seconds / tasks))
      else 'Среднее время решения: задач не было'
    end;
  end if;
  if 'errors' = any(blocks) then
    lines := lines || format('Ошибок: %s', coalesce(m.errors, 0));
  end if;
  if 'fraud' = any(blocks) then
    lines := lines || format('Открытых флагов фрода: %s', (select count(*) from private.fraud_flags where status = 'open'));
  end if;
  if 'support' = any(blocks) then
    lines := lines || format('Обращений ждут ответа: %s', (select count(*) from public.support_conversations where status = 'pending_owner'));
  end if;
  if 'wallets' = any(blocks) then
    lines := lines || format('На кошельках учеников: %s', private.format_rub(coalesce((select sum(balance) from public.wallet_accounts), 0)));
  end if;

  return array_to_string(lines, E'\n');
end;
$$;

revoke all on function private.build_daily_summary(date, jsonb, text) from public, anon, authenticated;

-- За какой день сводка и как она называется.
create or replace function private.daily_summary_title(p_day date, p_config jsonb, p_hour integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_config ->> 'period' = 'today'
      then format('Сводка за сегодня, %s, к %s:00', to_char(p_day, 'DD.MM.YYYY'), lpad(p_hour::text, 2, '0'))
    else format('Сводка за %s', to_char(p_day, 'DD.MM.YYYY'))
  end;
$$;

revoke all on function private.daily_summary_title(date, jsonb, integer) from public, anon, authenticated;

drop function if exists private.enqueue_daily_summary();

-- Одна сводка на час: повторный вызов в тот же час гасится ключом.
create or replace function private.enqueue_daily_summary(p_hour integer, p_config jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := private.msk_day(now());
  target_day date := case when p_config ->> 'period' = 'today' then today else today - 1 end;
  dedupe text := 'daily_summary:' || today::text || ':' || p_hour::text;
begin
  if exists (select 1 from private.admin_notifications where dedupe_key = dedupe) then
    return;
  end if;
  perform private.refresh_daily_metrics(target_day, target_day);
  perform private.notify_admin('daily_summary',
    private.build_daily_summary(target_day, p_config, private.daily_summary_title(target_day, p_config, p_hour)),
    jsonb_build_object('day', target_day, 'hour', p_hour, 'period', p_config ->> 'period'),
    dedupe);
end;
$$;

revoke all on function private.enqueue_daily_summary(integer, jsonb) from public, anon, authenticated;

create or replace function private.dispatch_admin_cron()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  token text := encode(extensions.gen_random_bytes(24), 'hex');
  summary jsonb := private.daily_summary_config();
  now_msk timestamp := now() at time zone 'Europe/Moscow';
  current_hour integer := extract(hour from now_msk)::integer;
  current_day integer := extract(isodow from now_msk)::integer;
begin
  delete from private.cron_tokens where created_at < now() - interval '1 hour';
  insert into private.cron_tokens (token_hash) values (encode(extensions.digest(token, 'sha256'), 'hex'));

  perform private.check_error_alerts();
  -- Сводка - в часы и дни из настроек.
  if (summary -> 'hours') @> to_jsonb(current_hour) and (summary -> 'days') @> to_jsonb(current_day) then
    perform private.enqueue_daily_summary(current_hour, summary);
  end if;

  perform net.http_post(
    url := 'https://homework-copilot-taupe.vercel.app/api/admin',
    body := jsonb_build_object('action', 'cron', 'token', token),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    timeout_milliseconds := 55000
  );
end;
$$;

revoke all on function private.dispatch_admin_cron() from public, anon, authenticated;

-- Предпросмотр: текст, который уйдёт, для сохранённых или ещё не
-- сохранённых настроек.
create or replace function public.admin_daily_summary_preview(p_config jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg jsonb;
  today date := private.msk_day(now());
  target_day date;
  first_hour integer;
begin
  perform private.require_admin('admin');
  cfg := case when p_config is null then private.daily_summary_config() else private.normalize_daily_summary(p_config) end;
  target_day := case when cfg ->> 'period' = 'today' then today else today - 1 end;
  first_hour := (cfg -> 'hours' ->> 0)::integer;
  perform private.refresh_daily_metrics(target_day, target_day);
  return jsonb_build_object(
    'config', cfg,
    'day', target_day,
    'text', private.build_daily_summary(target_day, cfg, private.daily_summary_title(target_day, cfg, first_hour))
  );
end;
$$;

revoke all on function public.admin_daily_summary_preview(jsonb) from public, anon;
grant execute on function public.admin_daily_summary_preview(jsonb) to authenticated;

-- «Отправить сейчас»: та же сводка вне расписания, в каналы из правил.
create or replace function public.admin_daily_summary_send_now()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin('admin');
  cfg jsonb := private.daily_summary_config();
  today date := private.msk_day(now());
  target_day date;
  rule private.admin_notification_rules%rowtype;
begin
  select * into rule from private.admin_notification_rules where event = 'daily_summary';
  if rule.event is null or not (rule.telegram or rule.email) then
    raise exception 'Сводка выключена в обоих каналах: включи Telegram или почту в «Правилах».' using errcode = '22023';
  end if;
  target_day := case when cfg ->> 'period' = 'today' then today else today - 1 end;
  perform private.refresh_daily_metrics(target_day, target_day);
  perform private.notify_admin('daily_summary',
    private.build_daily_summary(target_day, cfg,
      'Сводка по запросу из админки, ' || to_char(now() at time zone 'Europe/Moscow', 'DD.MM.YYYY HH24:MI')
      || case when cfg ->> 'period' = 'today' then ' (за сегодня)' else ' (за вчера)' end),
    jsonb_build_object('day', target_day, 'manual', true),
    'daily_summary:manual:' || (extract(epoch from now()) * 1000)::bigint::text);
  perform private.audit('daily_summary_sent', actor, jsonb_build_object('day', target_day));
  return jsonb_build_object('queued', true, 'day', target_day);
end;
$$;

revoke all on function public.admin_daily_summary_send_now() from public, anon;
grant execute on function public.admin_daily_summary_send_now() to authenticated;

create or replace function public.admin_notifications_overview()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  summary jsonb := private.daily_summary_config();
begin
  perform private.require_admin('admin');
  return jsonb_build_object(
    'rules', coalesce((
      select jsonb_agg(jsonb_build_object('event', event, 'title', title, 'telegram', telegram, 'email', email) order by title)
      from private.admin_notification_rules
    ), '[]'::jsonb),
    'emails', coalesce((select value from private.app_settings where key = 'notify_emails'), '[]'::jsonb),
    -- Прежнее поле читает уже выкаченная админка: первый час сводки.
    'dailySummaryHour', (summary -> 'hours' ->> 0)::integer,
    'dailySummary', summary,
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', n.id, 'event', n.event, 'title', n.title, 'body', n.body, 'createdAt', n.created_at,
        'telegramSentAt', n.telegram_sent_at, 'emailSentAt', n.email_sent_at, 'wantTelegram', n.want_telegram,
        'wantEmail', n.want_email, 'attempts', n.attempts, 'lastError', n.last_error
      ) order by n.created_at desc)
      from (select * from private.admin_notifications order by created_at desc limit 50) n
    ), '[]'::jsonb),
    'lastCron', (
      select jsonb_build_object('status', r.status, 'startedAt', r.start_time, 'message', left(r.return_message, 200))
      from cron.job_run_details r join cron.job j on j.jobid = r.jobid
      where j.jobname = 'admin-cron' order by r.start_time desc limit 1
    ),
    'lastDelivery', (select max(greatest(telegram_sent_at, email_sent_at)) from private.admin_notifications)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Настройки: сводка и предметы в фокусе
-- ---------------------------------------------------------------------------

create or replace function public.admin_setting_save(p_key text, p_value jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin('admin');
  previous jsonb;
  stored jsonb := p_value;
begin
  if p_key not in ('site_banner', 'support_sla_minutes', 'error_alert_users', 'error_alert_window_minutes', 'error_spike_hourly',
    'notify_emails', 'daily_summary_hour', 'daily_summary', 'quality_focus_subjects', 'money_rates') then
    raise exception 'unknown setting' using errcode = '22023';
  end if;
  if p_key = 'site_banner' and (jsonb_typeof(p_value) <> 'object' or char_length(coalesce(p_value ->> 'text', '')) > 300) then
    raise exception 'invalid banner' using errcode = '22023';
  end if;
  if p_key in ('support_sla_minutes', 'error_alert_users', 'error_alert_window_minutes', 'error_spike_hourly', 'daily_summary_hour')
    and (jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric < 0 or (p_value #>> '{}')::numeric > 10000) then
    raise exception 'invalid numeric setting' using errcode = '22023';
  end if;
  if p_key = 'daily_summary_hour' and (p_value #>> '{}')::numeric not in (select generate_series(0, 23)) then
    raise exception 'Час сводки - целое число от 0 до 23.' using errcode = '22023';
  end if;
  if p_key = 'notify_emails' and jsonb_typeof(p_value) <> 'array' then
    raise exception 'emails must be a list' using errcode = '22023';
  end if;
  if p_key = 'daily_summary' then
    stored := private.normalize_daily_summary(p_value);
  end if;
  if p_key = 'money_rates' and (
    jsonb_typeof(p_value) <> 'object'
    or jsonb_typeof(p_value -> 'taxPercent') <> 'number' or (p_value ->> 'taxPercent')::numeric not between 0 and 20
    or jsonb_typeof(p_value -> 'feePercent') <> 'number' or (p_value ->> 'feePercent')::numeric not between 0 and 20
    or jsonb_typeof(p_value -> 'deduction') <> 'boolean'
  ) then
    raise exception 'Ставки: налог и комиссия - числа от 0 до 20 %%, вычет - да или нет.' using errcode = '22023';
  end if;
  if p_key = 'money_rates' then
    stored := jsonb_build_object('taxPercent', (p_value ->> 'taxPercent')::numeric, 'feePercent', (p_value ->> 'feePercent')::numeric, 'deduction', (p_value ->> 'deduction')::boolean);
  end if;
  if p_key = 'quality_focus_subjects' and (
    jsonb_typeof(p_value) <> 'array'
    or jsonb_array_length(p_value) > 14
    or exists (select 1 from jsonb_array_elements(p_value) e where jsonb_typeof(e) <> 'string' or char_length(e #>> '{}') not between 1 and 60)
  ) then
    raise exception 'Предметы в фокусе - список названий, не больше 14.' using errcode = '22023';
  end if;

  select value into previous from private.app_settings where key = p_key;
  insert into private.app_settings (key, value, updated_at, updated_by) values (p_key, stored, now(), actor)
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = actor;

  -- Два ключа сводки держим согласованными: прежняя админка сохраняет
  -- один час, новая - всё сразу.
  if p_key = 'daily_summary_hour' then
    insert into private.app_settings (key, value, updated_at, updated_by)
    values ('daily_summary', private.daily_summary_config() || jsonb_build_object('hours', jsonb_build_array((p_value #>> '{}')::integer)), now(), actor)
    on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = actor;
  elsif p_key = 'daily_summary' then
    insert into private.app_settings (key, value, updated_at, updated_by)
    values ('daily_summary_hour', to_jsonb((stored -> 'hours' ->> 0)::integer), now(), actor)
    on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = actor;
  end if;

  perform private.audit('setting_saved', null, jsonb_build_object('key', p_key), jsonb_build_object('value', previous), jsonb_build_object('value', stored));
  return jsonb_build_object('key', p_key, 'value', stored);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Очистка статистики
-- ---------------------------------------------------------------------------

create or replace function public.admin_stats_purge(
  p_scopes text[],
  p_from date,
  p_to date,
  p_only_mine boolean default false,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin('owner');
  target_user uuid := case when coalesce(p_only_mine, false) then actor end;
  from_ts timestamptz;
  to_ts timestamptz;
  -- Разделы и их таблицы. Денежных таблиц здесь нет и быть не может.
  tables jsonb := jsonb_build_object(
    'solutions', jsonb_build_array('solution_costs', 'solution_logs'),
    'ratings', jsonb_build_array('solution_ratings'),
    'requests', jsonb_build_array('request_logs'),
    'activity', jsonb_build_array('user_activity_events')
  );
  scope text;
  table_name text;
  n bigint;
  touched text[];
  counts jsonb := '{}'::jsonb;
  total bigint := 0;
begin
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Неверный период очистки.' using errcode = '22023';
  end if;
  if p_scopes is null or cardinality(p_scopes) = 0
    or not (p_scopes <@ array['solutions', 'ratings', 'errors', 'requests', 'activity']) then
    raise exception 'Выбери, что очищать: задачи, оценки, ошибки, запросы или активность.' using errcode = '22023';
  end if;
  from_ts := (p_from::timestamp at time zone 'Europe/Moscow');
  to_ts := ((p_to + 1)::timestamp at time zone 'Europe/Moscow');

  foreach scope in array p_scopes loop
    if scope = 'errors' then
      if p_dry_run then
        select count(*) into n from private.error_events
        where created_at >= from_ts and created_at < to_ts and (target_user is null or user_id = target_user);
      else
        with gone as (
          delete from private.error_events
          where created_at >= from_ts and created_at < to_ts and (target_user is null or user_id = target_user)
          returning fingerprint
        )
        select coalesce(array_agg(distinct fingerprint), '{}'), count(*) into touched, n from gone;
        -- Группа без единого события пропадает, у остальных пересчитан счёт.
        delete from private.error_groups g
        where g.fingerprint = any(touched)
          and not exists (select 1 from private.error_events e where e.fingerprint = g.fingerprint);
        update private.error_groups g
        set occurrences = s.n, first_seen_at = s.first_at, last_seen_at = s.last_at
        from (
          select fingerprint, count(*) as n, min(created_at) as first_at, max(created_at) as last_at
          from private.error_events where fingerprint = any(touched) group by fingerprint
        ) s
        where s.fingerprint = g.fingerprint;
      end if;
      counts := counts || jsonb_build_object('error_events', n);
      total := total + n;
      continue;
    end if;

    for table_name in select jsonb_array_elements_text(tables -> scope) loop
      if p_dry_run then
        execute format('select count(*) from private.%I where created_at >= $1 and created_at < $2 and ($3::uuid is null or user_id = $3)', table_name)
          into n using from_ts, to_ts, target_user;
      else
        execute format('with gone as (delete from private.%I where created_at >= $1 and created_at < $2 and ($3::uuid is null or user_id = $3) returning 1) select count(*) from gone', table_name)
          into n using from_ts, to_ts, target_user;
      end if;
      counts := counts || jsonb_build_object(table_name, n);
      total := total + n;
    end loop;

    -- Заходы по дням собираются из событий активности: их тоже снимаем.
    if scope = 'activity' and not p_dry_run then
      delete from private.daily_active_users
      where day between p_from and p_to and (target_user is null or user_id = target_user);
    end if;
  end loop;

  if not p_dry_run then
    perform private.refresh_daily_metrics(p_from, p_to);
    perform private.audit('stats_purged', target_user, jsonb_build_object(
      'scopes', to_jsonb(p_scopes), 'from', p_from, 'to', p_to, 'onlyMine', coalesce(p_only_mine, false), 'counts', counts, 'total', total
    ));
  end if;

  return jsonb_build_object(
    'dryRun', p_dry_run, 'from', p_from, 'to', p_to, 'onlyMine', coalesce(p_only_mine, false),
    'counts', counts, 'total', total
  );
end;
$$;

revoke all on function public.admin_stats_purge(text[], date, date, boolean, boolean) from public, anon;
grant execute on function public.admin_stats_purge(text[], date, date, boolean, boolean) to authenticated;

-- Журнал вкладки «Статистика» в настройках: очистки и ручные сводки.
create or replace function public.admin_settings_history(
  p_scope text,
  p_key text default null,
  p_limit integer default 8
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  events text[];
  key_field text;
  safe_limit integer := greatest(1, least(coalesce(p_limit, 8), 50));
  total integer;
begin
  perform private.require_admin('admin');

  events := case p_scope
    when 'plans' then array['plan_saved', 'plan_deleted', 'plan_disabled']
    when 'promo' then array['promo_saved', 'promo_generated', 'promo_deleted']
    when 'prompts' then array['prompt_saved', 'prompt_rolled_back', 'prompt_disabled', 'prompt_previewed']
    when 'subjects' then array['subjects_saved']
    when 'flags' then array['flag_saved']
    when 'site' then array['setting_saved']
    when 'admins' then array['admin_role_changed']
    when 'stats' then array['stats_purged', 'daily_summary_sent']
  end;
  if events is null then
    raise exception 'Неизвестный раздел истории.' using errcode = '22023';
  end if;

  -- По какому полю payload отбирать одну сущность: предмет у промптов,
  -- ключ у флагов и настроек, код у промокодов, идентификатор у тарифов.
  key_field := case p_scope
    when 'plans' then 'planId'
    when 'promo' then 'code'
    when 'prompts' then 'subjectId'
    when 'flags' then 'key'
    when 'site' then 'key'
  end;

  select count(*) into total
  from private.admin_audit_log l
  where l.event_type = any(events)
    and (p_key is null or key_field is null or l.payload ->> key_field = p_key);

  return jsonb_build_object(
    'total', total,
    'events', to_jsonb(events),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'event', l.event_type,
        'actorEmail', au.email,
        'actorRole', l.actor_role,
        'targetEmail', tu.email,
        'payload', l.payload,
        -- Текст промпта до 8000 знаков дважды на запись - истории он не
        -- нужен: вместо него длина, а сам текст лежит в версиях.
        'before', case
          when p_scope = 'prompts' and jsonb_typeof(l.before_value) = 'object'
            then (l.before_value - 'body') || jsonb_build_object('chars', char_length(l.before_value ->> 'body'))
          else l.before_value
        end,
        'after', case
          when p_scope = 'prompts' and jsonb_typeof(l.after_value) = 'object'
            then (l.after_value - 'body') || jsonb_build_object('chars', char_length(l.after_value ->> 'body'))
          else l.after_value
        end,
        'createdAt', l.created_at
      ) order by l.created_at desc)
      from (
        select *
        from private.admin_audit_log l
        where l.event_type = any(events)
          and (p_key is null or key_field is null or l.payload ->> key_field = p_key)
        order by l.created_at desc
        limit safe_limit
      ) l
      left join auth.users au on au.id = l.actor_id
      left join auth.users tu on tu.id = l.target_user_id
    ), '[]'::jsonb)
  );
end;
$$;
