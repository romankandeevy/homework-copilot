-- Финансы v2: сверка без ложных срабатываний, план исправления, история баланса.
--
-- Разбор 12 сентября (только чтение, прод):
--
-- 1. «Зависшие резервы решений» - 12 списаний по 5 ₽ за 25 августа - 4 сентября.
--    Одиннадцать - на аккаунте из private.admin_users, одно - на втором
--    аккаунте владельца. Ни одно не проверяемо старой проверкой честно:
--    - история решений до 4 сентября 19:19 UTC удалена вне миграций и без
--      аудита: самая ранняя строка homework_solutions, homework_solution_access
--      и homework_jobs - 4 сентября 19:19-19:21; счётчики удалений Postgres -
--      13 решений, 12 доступов, 7 записей каталога, 145 задач очереди;
--    - семь из двенадцати списаний сделаны самой complete_homework_solution
--      (описание «Решение задачи № N · 5 ₽»): она списывает и выдаёт доступ в
--      одной транзакции, значит решение было выдано и позже удалено вместе с
--      доступом (внешний ключ on delete cascade);
--    - пять - резервы решателя без записи очереди: очередь за те дни удалена,
--      проверить нечем.
--    С 4 сентября 19:19 каждое списание за решение закончилось доступом или
--    возвратом - ни одного настоящего зависшего резерва.
--    Старая проверка читала отсутствие удалённых строк как «не выдано».
--
-- 2. «Баланс не сходится» (+80 и +180 ₽) - два тестовых аккаунта e2e от
--    30 августа, заведённые после перевода в копейки. Реальных пополнений,
--    возвратов, бонусов и записей аудита у них нет; баланс поставлен прямым
--    изменением wallet_accounts мимо книги операций. Утечки нет.
--
-- Что меняется:
-- - private.solution_reservation_reason - причина по одному списанию; ей
--   пользуются сверка, перепроверка и исправление, поэтому они не расходятся.
-- - Резерв считается зависшим только при доказанном «не выдано»: нет
--   решения ни под каким ключом, нет возврата, задача не идёт, история
--   очереди на тот момент есть. Остальное уходит в «проверить вручную».
-- - admin_finance_fix_reconciliation: план (dry run) и возврат только по
--   доказанным резервам, идемпотентно ключом '<key>:refund', с аудитом.
-- - admin_finance_align_wallet: привести баланс одного пользователя к сумме
--   его операций, с подтверждением прежних цифр и аудитом. Только владелец.
-- - admin_user_balance_history: баланс по дням из книги операций.
-- - private.reconciliation_problem_counts для дашборда.

-- ---------------------------------------------------------------------------
-- 1. Причина по одному списанию за решение
-- ---------------------------------------------------------------------------
--
-- refunded            возврат есть (ключ '<key>:refund' или любой '<key>:...')
-- same_key            доступ или личное решение с тем же ключом
-- charged_by_complete списание сделала complete_homework_solution - она
--                     списывает и выдаёт доступ в одной транзакции
-- job_active          задача в очереди или решается
-- job_done            задача закрыта как решённая, а доступа с этим ключом нет
-- other_key           рядом по времени выдано решение под другим ключом
-- history_missing     записи очереди нет, а история очереди начинается позже
-- not_delivered       доказано: решения нет, возврата нет, задача не идёт

create or replace function private.solution_reservation_reason(
  p_user_id uuid,
  p_key text,
  p_created_at timestamptz,
  p_description text
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1 from public.wallet_entries r
      where r.user_id = p_user_id
        and r.kind = 'credit'
        and (r.idempotency_key = left(p_key || ':refund', 160)
          or left(r.idempotency_key, char_length(p_key) + 1) = p_key || ':')
    ) then 'refunded'
    when exists (select 1 from public.homework_solution_access a where a.user_id = p_user_id and a.idempotency_key = p_key)
      or exists (select 1 from private.user_generated_homework_solutions p where p.user_id = p_user_id and p.idempotency_key = p_key)
      then 'same_key'
    when coalesce(p_description, '') ~ '^Решение задачи (№ \S+ |по фото )?· [0-9]+(,[0-9]{2})? ₽$'
      then 'charged_by_complete'
    when exists (select 1 from public.homework_jobs j where j.user_id = p_user_id and j.idempotency_key = p_key and j.status in ('queued', 'running'))
      then 'job_active'
    when exists (select 1 from public.homework_jobs j where j.user_id = p_user_id and j.idempotency_key = p_key and j.status = 'done')
      then 'job_done'
    when exists (
        select 1 from public.homework_solution_access a
        where a.user_id = p_user_id and a.idempotency_key <> p_key
          and a.purchased_at between p_created_at - interval '1 minute' and p_created_at + interval '30 minutes')
      or exists (
        select 1 from public.homework_solutions h
        where h.created_by = p_user_id
          and h.created_at between p_created_at - interval '1 minute' and p_created_at + interval '30 minutes')
      or exists (
        select 1 from private.user_generated_homework_solutions p
        where p.user_id = p_user_id and p.idempotency_key <> p_key
          and p.created_at between p_created_at - interval '1 minute' and p_created_at + interval '30 minutes')
      then 'other_key'
    when not exists (select 1 from public.homework_jobs j where j.user_id = p_user_id and j.idempotency_key = p_key)
      and p_created_at < coalesce((select min(j.created_at) from public.homework_jobs j), 'infinity'::timestamptz)
      then 'history_missing'
    else 'not_delivered'
  end;
$$;

revoke all on function private.solution_reservation_reason(uuid, text, timestamptz, text) from public, anon, authenticated;

-- Все списания за решение за 30 дней старше 10 минут с причиной и вердиктом:
-- refunded / delivered / running / review / stuck.
create or replace function private.solution_reservation_verdicts()
returns table (
  user_id uuid,
  email text,
  idempotency_key text,
  amount integer,
  created_at timestamptz,
  description text,
  job_status text,
  reason text,
  verdict text,
  is_staff boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select x.user_id, x.email, x.idempotency_key, x.amount, x.created_at, x.description, x.job_status, x.reason,
    case x.reason
      when 'refunded' then 'refunded'
      when 'same_key' then 'delivered'
      when 'charged_by_complete' then 'delivered'
      when 'job_active' then 'running'
      when 'not_delivered' then 'stuck'
      else 'review'
    end,
    private.is_staff(x.user_id)
  from (
    select e.user_id, u.email, e.idempotency_key, -e.amount as amount, e.created_at, e.description,
      (select j.status from public.homework_jobs j where j.user_id = e.user_id and j.idempotency_key = e.idempotency_key limit 1) as job_status,
      private.solution_reservation_reason(e.user_id, e.idempotency_key, e.created_at, e.description) as reason
    from public.wallet_entries e
    join auth.users u on u.id = e.user_id
    where e.kind = 'debit'
      and e.idempotency_key like 'solution-%'
      and e.created_at < now() - interval '10 minutes'
      and e.created_at > now() - interval '30 days'
  ) x;
$$;

revoke all on function private.solution_reservation_verdicts() from public, anon, authenticated;

-- Прежняя сигнатура: её читает дашборд. Теперь - только доказанные.
create or replace function private.stuck_reservations()
returns table (user_id uuid, email text, idempotency_key text, amount integer, created_at timestamptz, job_status text)
language sql
stable
security definer
set search_path = ''
as $$
  select v.user_id, v.email, v.idempotency_key, v.amount, v.created_at, v.job_status
  from private.solution_reservation_verdicts() v
  where v.verdict = 'stuck';
$$;

revoke all on function private.stuck_reservations() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Кошельки против книги операций
-- ---------------------------------------------------------------------------
--
-- cause: edited_after_last_entry - баланс менялся позже последней операции
-- (прямое изменение wallet_accounts), outside_ledger - момент не виден.

create or replace function private.wallet_mismatches()
returns table (
  user_id uuid,
  email text,
  balance integer,
  ledger bigint,
  difference bigint,
  entries integer,
  last_entry_at timestamptz,
  wallet_updated_at timestamptz,
  registered_at timestamptz,
  top_ups integer,
  audit_events integer,
  is_staff boolean,
  cause text
)
language sql
stable
security definer
set search_path = ''
as $$
  select w.user_id, u.email, w.balance, l.total, w.balance - l.total, l.entries, l.last_at, w.updated_at, u.created_at,
    (select count(*)::integer from private.verified_balance_top_ups t where t.user_id = w.user_id),
    (select count(*)::integer from private.admin_audit_log a where a.target_user_id = w.user_id),
    private.is_staff(w.user_id),
    case when l.last_at is not null and w.updated_at > l.last_at + interval '2 seconds' then 'edited_after_last_entry' else 'outside_ledger' end
  from public.wallet_accounts w
  join auth.users u on u.id = w.user_id
  join lateral (
    select coalesce(sum(e.amount), 0)::bigint as total, count(*)::integer as entries, max(e.created_at) as last_at
    from public.wallet_entries e where e.user_id = w.user_id
  ) l on true
  where w.balance <> l.total;
$$;

revoke all on function private.wallet_mismatches() from public, anon, authenticated;

create or replace function private.top_ups_without_entry()
returns table (id uuid, user_id uuid, email text, amount integer, reference text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.user_id, u.email, t.amount, t.provider_reference, t.created_at
  from private.verified_balance_top_ups t
  join auth.users u on u.id = t.user_id
  left join public.wallet_entries e on e.id = t.wallet_entry_id
  where e.id is null or e.amount <> t.amount or e.user_id <> t.user_id;
$$;

revoke all on function private.top_ups_without_entry() from public, anon, authenticated;

create or replace function private.entries_without_top_up()
returns table (id uuid, user_id uuid, email text, amount integer, idempotency_key text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.user_id, u.email, e.amount, e.idempotency_key, e.created_at
  from public.wallet_entries e
  join auth.users u on u.id = e.user_id
  where e.idempotency_key like 'verified-top-up:%'
    and not exists (select 1 from private.verified_balance_top_ups t where t.wallet_entry_id = e.id);
$$;

revoke all on function private.entries_without_top_up() from public, anon, authenticated;

-- Счётчики для тревоги на дашборде - по той же логике, что и сверка.
create or replace function private.reconciliation_problem_counts()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'stuckReservations', (select count(*) from private.solution_reservation_verdicts() v where v.verdict = 'stuck'),
    'walletMismatches', (select count(*) from private.wallet_mismatches()),
    'topUpsWithoutEntry', (select count(*) from private.top_ups_without_entry()),
    'entriesWithoutTopUp', (select count(*) from private.entries_without_top_up()),
    'reservationsToReview', (select count(*) from private.solution_reservation_verdicts() v where v.verdict = 'review')
  );
$$;

revoke all on function private.reconciliation_problem_counts() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Сверка
-- ---------------------------------------------------------------------------

create or replace function public.admin_finance_reconciliation()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin('admin');
  return (
    with v as (select * from private.solution_reservation_verdicts())
    select jsonb_build_object(
      'topUpsWithoutEntry', coalesce((
        select jsonb_agg(jsonb_build_object('id', t.id, 'userId', t.user_id, 'email', t.email, 'amount', t.amount, 'reference', t.reference, 'createdAt', t.created_at) order by t.created_at desc)
        from private.top_ups_without_entry() t
      ), '[]'::jsonb),
      'entriesWithoutTopUp', coalesce((
        select jsonb_agg(jsonb_build_object('id', e.id, 'userId', e.user_id, 'email', e.email, 'amount', e.amount, 'key', e.idempotency_key, 'createdAt', e.created_at) order by e.created_at desc)
        from private.entries_without_top_up() e
      ), '[]'::jsonb),
      'walletMismatches', coalesce((
        select jsonb_agg(jsonb_build_object(
          'userId', m.user_id, 'email', m.email, 'balance', m.balance, 'ledger', m.ledger, 'difference', m.difference,
          'entries', m.entries, 'lastEntryAt', m.last_entry_at, 'walletUpdatedAt', m.wallet_updated_at, 'registeredAt', m.registered_at,
          'topUps', m.top_ups, 'auditEvents', m.audit_events, 'isStaff', m.is_staff, 'cause', m.cause
        ) order by abs(m.difference) desc)
        from private.wallet_mismatches() m
      ), '[]'::jsonb),
      'stuckReservations', coalesce((
        select jsonb_agg(jsonb_build_object(
          'userId', v.user_id, 'email', v.email, 'key', v.idempotency_key, 'amount', v.amount, 'createdAt', v.created_at,
          'jobStatus', v.job_status, 'description', v.description, 'reason', v.reason, 'isStaff', v.is_staff
        ) order by v.created_at desc)
        from v where v.verdict = 'stuck'
      ), '[]'::jsonb),
      'reservationsToReview', coalesce((
        select jsonb_agg(jsonb_build_object(
          'userId', v.user_id, 'email', v.email, 'key', v.idempotency_key, 'amount', v.amount, 'createdAt', v.created_at,
          'jobStatus', v.job_status, 'description', v.description, 'reason', v.reason, 'isStaff', v.is_staff
        ) order by v.created_at desc)
        from v where v.verdict = 'review'
      ), '[]'::jsonb),
      'deliveredWithoutAccess', jsonb_build_object(
        'count', (select count(*) from v where v.reason = 'charged_by_complete'),
        'amount', coalesce((select sum(v.amount) from v where v.reason = 'charged_by_complete'), 0)
      ),
      'historyFrom', (select min(j.created_at) from public.homework_jobs j),
      'checkedAt', now()
    )
  );
end;
$$;

revoke all on function public.admin_finance_reconciliation() from public, anon;
grant execute on function public.admin_finance_reconciliation() to authenticated;

-- Перепроверка одного резерва - по той же причине, что и сверка. Возврат
-- только при доказанном «не выдано».
create or replace function public.admin_finance_recheck_reservation(p_user_id uuid, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  reserved public.wallet_entries%rowtype;
  refund_key text := left(p_idempotency_key || ':refund', 160);
  verdict_reason text;
  before_balance integer;
  resulting integer;
  entry_id uuid;
begin
  perform private.require_admin('admin');

  select * into reserved from public.wallet_entries
  where user_id = p_user_id and idempotency_key = p_idempotency_key and kind = 'debit' for update;
  if reserved.id is null then
    return jsonb_build_object('result', 'no_reservation');
  end if;

  select balance into before_balance from public.wallet_accounts where user_id = p_user_id for update;
  verdict_reason := private.solution_reservation_reason(p_user_id, p_idempotency_key, reserved.created_at, reserved.description);

  if verdict_reason = 'refunded' then
    return jsonb_build_object('result', 'already_refunded');
  elsif verdict_reason in ('same_key', 'charged_by_complete') then
    return jsonb_build_object('result', 'delivered', 'reason', verdict_reason);
  elsif verdict_reason = 'job_active' then
    return jsonb_build_object('result', 'still_running');
  elsif verdict_reason <> 'not_delivered' then
    return jsonb_build_object('result', 'needs_review', 'reason', verdict_reason);
  end if;

  insert into public.wallet_entries (user_id, amount, kind, description, idempotency_key)
  values (p_user_id, -reserved.amount, 'credit', 'Возврат: решение не выдано (сверка)', refund_key)
  on conflict (user_id, idempotency_key) do nothing
  returning id into entry_id;
  if entry_id is null then
    return jsonb_build_object('result', 'already_refunded');
  end if;

  update public.wallet_accounts set balance = balance - reserved.amount, updated_at = now()
  where user_id = p_user_id returning balance into resulting;

  perform private.audit('reservation_refunded', p_user_id,
    jsonb_build_object('idempotencyKey', p_idempotency_key, 'amount', -reserved.amount, 'source', 'recheck', 'walletEntryId', entry_id),
    jsonb_build_object('balance', before_balance), jsonb_build_object('balance', resulting));
  return jsonb_build_object('result', 'refunded', 'amount', -reserved.amount, 'balance', resulting);
end;
$$;

revoke all on function public.admin_finance_recheck_reservation(uuid, text) from public, anon;
grant execute on function public.admin_finance_recheck_reservation(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Исправление: план и возврат по доказанным резервам
-- ---------------------------------------------------------------------------
--
-- p_dry_run = true (по умолчанию) - только план. Без него нужны число и сумма
-- из показанного плана: если за это время план изменился, ничего не
-- возвращается, и интерфейс просит проверить заново.

create or replace function public.admin_finance_fix_reconciliation(
  p_dry_run boolean default true,
  p_expected_count integer default null,
  p_expected_total integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin('admin');
  item record;
  reserved public.wallet_entries%rowtype;
  current_reason text;
  before_balance integer;
  after_balance integer;
  entry_id uuid;
  plan_count integer;
  plan_total bigint;
  done jsonb := '[]'::jsonb;
  skipped jsonb := '[]'::jsonb;
  refunded_count integer := 0;
  refunded_total bigint := 0;
begin
  if coalesce(p_dry_run, true) then
    return (
      with v as materialized (
        select * from private.solution_reservation_verdicts() x where x.verdict in ('stuck', 'review')
      )
      select jsonb_build_object(
        'dryRun', true,
        'count', (select count(*) from v where v.verdict = 'stuck'),
        'total', coalesce((select sum(v.amount) from v where v.verdict = 'stuck'), 0),
        'users', (select count(distinct v.user_id) from v where v.verdict = 'stuck'),
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'userId', v.user_id, 'email', v.email, 'key', v.idempotency_key, 'amount', v.amount, 'createdAt', v.created_at,
            'jobStatus', v.job_status, 'description', v.description, 'reason', v.reason, 'isStaff', v.is_staff,
            'balance', (select w.balance from public.wallet_accounts w where w.user_id = v.user_id)
          ) order by v.email, v.created_at)
          from v where v.verdict = 'stuck'
        ), '[]'::jsonb),
        'review', coalesce((
          select jsonb_agg(jsonb_build_object(
            'userId', v.user_id, 'email', v.email, 'key', v.idempotency_key, 'amount', v.amount, 'createdAt', v.created_at,
            'jobStatus', v.job_status, 'description', v.description, 'reason', v.reason, 'isStaff', v.is_staff
          ) order by v.email, v.created_at)
          from v where v.verdict = 'review'
        ), '[]'::jsonb),
        'reviewTotal', coalesce((select sum(v.amount) from v where v.verdict = 'review'), 0),
        'walletMismatches', (select count(*) from private.wallet_mismatches()),
        'checkedAt', now()
      )
    );
  end if;

  select count(*), coalesce(sum(x.amount), 0) into plan_count, plan_total
  from private.solution_reservation_verdicts() x where x.verdict = 'stuck';

  if p_expected_count is null or p_expected_total is null
    or p_expected_count <> plan_count or p_expected_total <> plan_total then
    raise exception 'reconciliation plan changed' using errcode = '40001';
  end if;

  for item in select * from private.solution_reservation_verdicts() x where x.verdict = 'stuck' order by x.created_at loop
    select * into reserved from public.wallet_entries
    where user_id = item.user_id and idempotency_key = item.idempotency_key and kind = 'debit' for update;
    if reserved.id is null then
      skipped := skipped || jsonb_build_object('key', item.idempotency_key, 'userId', item.user_id, 'result', 'no_reservation');
      continue;
    end if;

    select balance into before_balance from public.wallet_accounts where user_id = item.user_id for update;
    -- Причина пересчитывается под блокировкой: план мог устареть за миллисекунды.
    current_reason := private.solution_reservation_reason(item.user_id, item.idempotency_key, reserved.created_at, reserved.description);
    if current_reason <> 'not_delivered' then
      skipped := skipped || jsonb_build_object('key', item.idempotency_key, 'userId', item.user_id, 'result', current_reason);
      continue;
    end if;

    insert into public.wallet_entries (user_id, amount, kind, description, idempotency_key)
    values (item.user_id, -reserved.amount, 'credit', 'Возврат: решение не выдано (сверка)', left(item.idempotency_key || ':refund', 160))
    on conflict (user_id, idempotency_key) do nothing
    returning id into entry_id;
    if entry_id is null then
      skipped := skipped || jsonb_build_object('key', item.idempotency_key, 'userId', item.user_id, 'result', 'refunded');
      continue;
    end if;

    update public.wallet_accounts set balance = balance - reserved.amount, updated_at = now()
    where user_id = item.user_id returning balance into after_balance;

    perform private.audit('reservation_refunded', item.user_id,
      jsonb_build_object('idempotencyKey', item.idempotency_key, 'amount', -reserved.amount, 'source', 'auto_fix', 'walletEntryId', entry_id),
      jsonb_build_object('balance', before_balance), jsonb_build_object('balance', after_balance));

    refunded_count := refunded_count + 1;
    refunded_total := refunded_total - reserved.amount;
    done := done || jsonb_build_object('key', item.idempotency_key, 'userId', item.user_id, 'email', item.email, 'amount', -reserved.amount, 'balance', after_balance);
  end loop;

  perform private.audit('reconciliation_fixed', null,
    jsonb_build_object('refunded', refunded_count, 'amount', refunded_total, 'skipped', jsonb_array_length(skipped), 'planCount', plan_count, 'planTotal', plan_total, 'actor', actor));

  return jsonb_build_object('dryRun', false, 'refunded', refunded_count, 'amount', refunded_total, 'items', done, 'skipped', skipped);
end;
$$;

revoke all on function public.admin_finance_fix_reconciliation(boolean, integer, integer) from public, anon;
grant execute on function public.admin_finance_fix_reconciliation(boolean, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Привести баланс одного пользователя к сумме операций
-- ---------------------------------------------------------------------------

create or replace function public.admin_finance_align_wallet(
  p_user_id uuid,
  p_expected_balance integer,
  p_expected_ledger integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin('owner');
  normalized_reason text := trim(coalesce(p_reason, ''));
  current_balance integer;
  ledger bigint;
begin
  if char_length(normalized_reason) not between 3 and 300 then
    raise exception 'align reason must contain 3 to 300 characters' using errcode = '22023';
  end if;

  select balance into current_balance from public.wallet_accounts where user_id = p_user_id for update;
  if current_balance is null then
    raise exception 'wallet not found' using errcode = 'P0002';
  end if;
  select coalesce(sum(amount), 0) into ledger from public.wallet_entries where user_id = p_user_id;

  if current_balance = ledger then
    return jsonb_build_object('result', 'already_aligned', 'balance', current_balance);
  end if;
  if current_balance <> p_expected_balance or ledger <> p_expected_ledger then
    raise exception 'wallet changed since check' using errcode = '40001';
  end if;
  if ledger < 0 or ledger > 2147483647 then
    raise exception 'ledger total is out of range' using errcode = '22023';
  end if;

  update public.wallet_accounts set balance = ledger::integer, updated_at = now() where user_id = p_user_id;

  perform private.audit('wallet_aligned', p_user_id,
    jsonb_build_object('reason', normalized_reason, 'difference', current_balance - ledger, 'actor', actor),
    jsonb_build_object('balance', current_balance), jsonb_build_object('balance', ledger));

  return jsonb_build_object('result', 'aligned', 'previous', current_balance, 'balance', ledger, 'difference', current_balance - ledger);
end;
$$;

revoke all on function public.admin_finance_align_wallet(uuid, integer, integer, text) from public, anon;
grant execute on function public.admin_finance_align_wallet(uuid, integer, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. История баланса по дням (по Москве) из книги операций
-- ---------------------------------------------------------------------------

create or replace function public.admin_user_balance_history(p_user_id uuid, p_days integer default 90)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_days integer := greatest(7, least(coalesce(p_days, 90), 366));
  today date := private.msk_day(now());
  first_day date;
  from_day date;
  opening bigint;
begin
  perform private.require_admin('support');

  select private.msk_day(min(created_at)) into first_day from public.wallet_entries where user_id = p_user_id;
  if first_day is null then
    return jsonb_build_object(
      'from', null, 'to', today, 'points', '[]'::jsonb,
      'balance', (select balance from public.wallet_accounts where user_id = p_user_id),
      'ledger', 0
    );
  end if;

  from_day := greatest(first_day, today - (safe_days - 1));
  select coalesce(sum(amount), 0) into opening
  from public.wallet_entries
  where user_id = p_user_id and created_at < (from_day::timestamp at time zone 'Europe/Moscow');

  return jsonb_build_object(
    'from', from_day,
    'to', today,
    'balance', (select balance from public.wallet_accounts where user_id = p_user_id),
    'ledger', (select coalesce(sum(amount), 0) from public.wallet_entries where user_id = p_user_id),
    'points', coalesce((
      select jsonb_agg(jsonb_build_object('date', s.day, 'balance', s.balance, 'credit', s.credit, 'debit', s.debit, 'operations', s.operations) order by s.day)
      from (
        select d.day,
          opening + sum(coalesce(p.net, 0)) over (order by d.day) as balance,
          coalesce(p.credit, 0) as credit,
          coalesce(p.debit, 0) as debit,
          coalesce(p.operations, 0) as operations
        from (select g::date as day from generate_series(from_day::timestamp, today::timestamp, interval '1 day') g) d
        left join (
          select private.msk_day(e.created_at) as day,
            sum(e.amount) as net,
            coalesce(sum(e.amount) filter (where e.amount > 0), 0) as credit,
            coalesce(sum(-e.amount) filter (where e.amount < 0), 0) as debit,
            count(*) as operations
          from public.wallet_entries e
          where e.user_id = p_user_id and e.created_at >= (from_day::timestamp at time zone 'Europe/Moscow')
          group by 1
        ) p on p.day = d.day
      ) s
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_user_balance_history(uuid, integer) from public, anon;
grant execute on function public.admin_user_balance_history(uuid, integer) to authenticated;
