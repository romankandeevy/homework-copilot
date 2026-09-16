-- Платёжные записи переживают удаление аккаунта (аудит 16 сентября, А3).
--
-- До этой миграции `user_id` у пополнений, возвратов и книги кошелька
-- ссылался на auth.users с `on delete cascade`. Ученик пополнил 1 000 ₽,
-- потратил 100 и удалил аккаунт - и пропадали записи пополнения и
-- возврата: «Пришло» и налоговая база НПД за прошлые месяцы уменьшались
-- задним числом, вернуть остаток через admin_finance_refund было не по чему.
-- Оферта (раздел 12) и политика данных обещают обратное: заказ и запись о
-- платеже сохраняются без связи с аккаунтом.
--
-- Что меняется:
--   * `user_id` в private.verified_balance_top_ups, private.top_up_refunds и
--     public.wallet_entries - `on delete set null`, `not null` снят. Выручка
--     и так считается по `amount` без связи с аккаунтом; политика
--     `wallet_entries_select_own` (`auth.uid() = user_id`) строку без
--     владельца никому не показывает.
--   * Описания операций в книге при удалении обезличиваются: в описании
--     списания бывает начало условия задачи.
--   * delete_my_account и admin_delete_user отказывают, пока заказ
--     пополнения моложе суток ждёт оплаты: деньги могут прийти через минуту.
--   * confirm_payment_order при удалённом аккаунте ставит уведомление
--     владельцу: деньги пришли, зачислить некуда.
--   * my_account_deletion_check - что предупредить перед удалением: сколько
--     на балансе внесённых денег и нет ли платежа в пути.
--   * Лента платежей показывает пополнения удалённых аккаунтов, возврат по
--     ним проходит без списания с кошелька (кошелька уже нет).

-- ---------------------------------------------------------------------------
-- 1. Внешние ключи
-- ---------------------------------------------------------------------------

-- Имена ограничений не угадываем: снимаем каждый внешний ключ `user_id` на
-- auth.users у трёх таблиц, какое бы имя он ни носил.
do $$
declare
  target record;
begin
  for target in
    select c.conname, n.nspname, t.relname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = t.oid and a.attnum = any (c.conkey)
    where c.contype = 'f'
      and c.confrelid = 'auth.users'::regclass
      and a.attname = 'user_id'
      and ((n.nspname = 'public' and t.relname = 'wallet_entries')
        or (n.nspname = 'private' and t.relname = 'verified_balance_top_ups')
        or (n.nspname = 'private' and t.relname = 'top_up_refunds'))
  loop
    execute format('alter table %I.%I drop constraint %I', target.nspname, target.relname, target.conname);
  end loop;
end;
$$;

alter table public.wallet_entries alter column user_id drop not null;
alter table private.verified_balance_top_ups alter column user_id drop not null;
alter table private.top_up_refunds alter column user_id drop not null;

alter table public.wallet_entries
  add constraint wallet_entries_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;
alter table private.verified_balance_top_ups
  add constraint verified_balance_top_ups_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;
alter table private.top_up_refunds
  add constraint top_up_refunds_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 2. Правило уведомления о платеже, который надо разбирать руками
-- ---------------------------------------------------------------------------

insert into private.admin_notification_rules (event, title, telegram, email) values
  ('payment_incident', 'Сбой оплаты: разобрать вручную', true, true)
on conflict (event) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Подтверждение оплаты
-- ---------------------------------------------------------------------------

create or replace function public.confirm_payment_order(
  p_inv_id integer,
  p_amount integer,
  p_is_test boolean,
  p_via text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  payment private.payment_orders%rowtype;
  credit jsonb;
begin
  if p_via is null or p_via not in ('result', 'reconcile', 'status') then
    raise exception 'invalid payment source' using errcode = '22023';
  end if;

  select * into payment
  from private.payment_orders
  where inv_id = p_inv_id
  for update;

  if not found then
    raise exception 'payment order not found' using errcode = 'P0002';
  end if;

  if payment.is_test <> coalesce(p_is_test, false) then
    raise exception 'payment mode mismatch' using errcode = '22023';
  end if;

  if payment.amount <> p_amount then
    raise exception 'payment amount mismatch' using errcode = '22023';
  end if;

  if payment.status = 'paid' then
    return jsonb_build_object('applied', false, 'status', 'paid', 'invId', payment.inv_id);
  end if;

  -- Отменённый или просроченный заказ тоже принимается: подпись верна,
  -- значит, деньги пришли, а своё «отменён» мы могли поставить раньше,
  -- чем Робокасса провела платёж.
  if payment.user_id is not null then
    credit := private.credit_provider_top_up(
      payment.user_id,
      payment.amount,
      case when payment.is_test then 'robokassa-test:' else 'robokassa:' end || payment.inv_id::text
    );
  else
    -- Аккаунт удалён, пока ученик платил: зачислять некуда. Заказ всё
    -- равно отмечается оплаченным, а владелец узнаёт об этом сразу - деньги
    -- возвращаются вручную.
    perform private.notify_admin('payment_incident',
      format('Оплачен %sзаказ №%s на %s, но аккаунт уже удалён: зачислить некуда. Верни деньги плательщику через кабинет Робокассы.',
        case when payment.is_test then 'тестовый ' else '' end,
        payment.inv_id,
        private.format_rub(payment.amount)),
      jsonb_build_object('invId', payment.inv_id, 'amount', payment.amount, 'isTest', payment.is_test, 'via', p_via),
      'payment_unassigned:' || payment.inv_id::text);
  end if;

  update private.payment_orders
  set status = 'paid',
      paid_at = now(),
      closed_at = now(),
      paid_via = p_via,
      top_up_id = (credit ->> 'topUpId')::uuid,
      provider_payload = coalesce(p_payload, '{}'::jsonb)
  where inv_id = payment.inv_id;

  return jsonb_build_object(
    'applied', coalesce((credit ->> 'applied')::boolean, false),
    'status', 'paid',
    'invId', payment.inv_id,
    'unassigned', payment.user_id is null
  );
end;
$function$;

revoke all on function public.confirm_payment_order(integer, integer, boolean, text, jsonb) from public, anon, authenticated;
grant execute on function public.confirm_payment_order(integer, integer, boolean, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Удаление аккаунта
-- ---------------------------------------------------------------------------

-- Платёж в пути: заказ ждёт оплаты меньше суток. Старше - ученик ушёл со
-- страницы оплаты, и ждать трое суток до закрытия заказа сроком ради права
-- на удаление было бы нечестно; поздняя оплата всё равно не потеряется -
-- confirm_payment_order поставит уведомление владельцу.
create or replace function private.has_payment_in_flight(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.payment_orders o
    where o.user_id = p_user_id
      and o.status = 'pending'
      and o.created_at > now() - interval '24 hours'
  );
$$;

revoke all on function private.has_payment_in_flight(uuid) from public, anon, authenticated;

-- То же для сервера админки: он удаляет файлы чата до вызова
-- admin_delete_user и должен узнать об отказе раньше, чем сотрёт файлы.
create or replace function public.account_has_payment_in_flight(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_payment_in_flight(p_user_id);
$$;

revoke all on function public.account_has_payment_in_flight(uuid) from public, anon, authenticated;
grant execute on function public.account_has_payment_in_flight(uuid) to service_role;

-- Книга кошелька остаётся без связи с аккаунтом, но описание списания
-- бывает началом условия задачи. Пополнения и возвраты описаны без личных
-- данных, их не трогаем.
create or replace function private.anonymize_wallet_entries(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.wallet_entries e
  set description = case when e.kind = 'debit' then 'Списание' else 'Зачисление' end
  where e.user_id = p_user_id
    and e.idempotency_key not like 'verified-top-up:%'
    and e.idempotency_key not like 'top-up-refund:%';
$$;

revoke all on function private.anonymize_wallet_entries(uuid) from public, anon, authenticated;

-- Перед удалением: что предупредить. Внесённые деньги - подтверждённые
-- пополнения (кроме тестовых) минус возвраты, но не больше остатка
-- баланса: ровно столько вернёт возврат по оферте, раздел 12.
create or replace function public.my_account_deletion_check()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  balance integer;
  paid bigint;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  select w.balance into balance from public.wallet_accounts w where w.user_id = current_user_id;

  paid := coalesce((
    select sum(t.amount) from private.verified_balance_top_ups t
    where t.user_id = current_user_id
      and t.provider_reference not like 'robokassa-test:%'
  ), 0) - coalesce((
    select sum(r.amount) from private.top_up_refunds r
    where r.user_id = current_user_id
  ), 0);

  return jsonb_build_object(
    'balanceKopecks', coalesce(balance, 0),
    'refundableKopecks', greatest(0, least(coalesce(balance, 0)::bigint, paid)),
    'paymentPending', private.has_payment_in_flight(current_user_id)
  );
end;
$$;

revoke all on function public.my_account_deletion_check() from public, anon, authenticated;
grant execute on function public.my_account_deletion_check() to authenticated;

create or replace function public.delete_my_account()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  removed_solutions integer := 0;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  -- Владелец не может удалить себя из интерфейса ученика: вместе с ним
  -- пропадёт доступ к админке, а вернуть его будет неоткуда.
  if exists (select 1 from private.admin_users where user_id = current_user_id) then
    raise exception 'admin account cannot be deleted from the app' using errcode = 'P0001';
  end if;

  -- Платёж в пути: деньги могут прийти через минуту после удаления.
  if private.has_payment_in_flight(current_user_id) then
    raise exception 'payment order pending' using errcode = 'P0001';
  end if;

  -- Ссылки `on delete restrict`: без этого удаление упало бы на внешнем ключе.
  delete from private.support_feature_credits
  where user_id = current_user_id or actor_id = current_user_id;

  delete from private.admin_audit_log where actor_id = current_user_id;

  -- Личные решения этого ученика. Каскад снял бы только доступы, а сам текст
  -- решения с условием задачи остался бы в общей таблице без владельца.
  with purged as (
    delete from public.homework_solutions
    where created_by = current_user_id
      and not exists (
        select 1 from public.homework_solution_access access
        where access.solution_id = public.homework_solutions.id
          and access.user_id <> current_user_id
      )
    returning 1
  )
  select count(*)::integer into removed_solutions from purged;

  -- Книга, пополнения, возвраты и заказы остаются без связи с аккаунтом
  -- (on delete set null): по ним выполняется возврат и ведётся учёт.
  perform private.anonymize_wallet_entries(current_user_id);

  delete from auth.users where id = current_user_id;

  return jsonb_build_object('deleted', true, 'solutions', removed_solutions);
end;
$$;

revoke all on function public.delete_my_account() from public, anon, authenticated;
grant execute on function public.delete_my_account() to authenticated;

comment on function public.delete_my_account() is
  'Удаление собственного аккаунта: отказ при платеже в пути, снимает ссылки on delete restrict и удаляет строку auth.users. Платёжные записи остаются без связи с аккаунтом.';

create or replace function public.admin_delete_user(
  p_user_id uuid,
  p_confirm text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_id uuid := private.require_admin('owner');
  target_email text;
  target_phone text;
  expected text;
  given text;
  removed_solutions integer := 0;
begin
  if p_user_id is null then
    raise exception 'user required' using errcode = '22023';
  end if;

  if p_user_id = admin_id then
    raise exception 'cannot delete own account' using errcode = '22023';
  end if;

  if exists (select 1 from private.admin_users au where au.user_id = p_user_id) then
    raise exception 'admin account cannot be deleted' using errcode = '22023';
  end if;

  select nullif(lower(u.email), ''), nullif(u.phone, '') into target_email, target_phone
  from auth.users u
  where u.id = p_user_id
  for update;

  if not found then
    raise exception 'user not found' using errcode = 'P0002';
  end if;

  if target_email is not null then
    expected := target_email;
    given := regexp_replace(lower(coalesce(p_confirm, '')), '\s', '', 'g');
  else
    expected := regexp_replace(coalesce(target_phone, ''), '\D', '', 'g');
    given := regexp_replace(coalesce(p_confirm, ''), '\D', '', 'g');
  end if;

  if expected = '' or given <> expected then
    raise exception 'confirmation does not match' using errcode = '22023';
  end if;

  -- Платёж в пути: деньги могут прийти через минуту после удаления.
  if private.has_payment_in_flight(p_user_id) then
    raise exception 'payment order pending' using errcode = '22023';
  end if;

  -- Ссылки `on delete restrict`: без этого удаление упало бы на внешнем ключе.
  delete from private.support_feature_credits sfc
  where sfc.user_id = p_user_id or sfc.actor_id = p_user_id;

  delete from private.admin_audit_log aal
  where aal.actor_id = p_user_id;

  -- Личные решения этого ученика: каскад снял бы только доступы, а текст
  -- решения с условием остался бы в общей таблице без владельца.
  with purged as (
    delete from public.homework_solutions hs
    where hs.created_by = p_user_id
      and not exists (
        select 1 from public.homework_solution_access access
        where access.solution_id = hs.id
          and access.user_id <> p_user_id
      )
    returning 1
  )
  select count(*)::integer into removed_solutions from purged;

  -- Журнал пишется до удаления: target_user_id станет null каскадом
  -- (on delete set null), а почта и номер останутся в payload.
  insert into private.admin_audit_log (actor_id, target_user_id, event_type, payload)
  values (
    admin_id,
    p_user_id,
    'user_deleted',
    jsonb_build_object(
      'email', target_email,
      'phone', target_phone,
      'reason', nullif(left(trim(coalesce(p_reason, '')), 300), ''),
      'solutions', removed_solutions,
      'balance', (select w.balance from public.wallet_accounts w where w.user_id = p_user_id)
    )
  );

  -- Книга, пополнения, возвраты и заказы остаются без связи с аккаунтом.
  perform private.anonymize_wallet_entries(p_user_id);

  delete from auth.users u where u.id = p_user_id;

  return jsonb_build_object('deleted', true, 'email', target_email, 'phone', target_phone, 'solutions', removed_solutions);
end;
$$;

revoke all on function public.admin_delete_user(uuid, text, text) from public, anon;
grant execute on function public.admin_delete_user(uuid, text, text) to authenticated;

comment on function public.admin_delete_user(uuid, text, text) is
  'Удаление аккаунта владельцем из админки: подтверждение почтой или номером, отказ при платеже в пути, журнал, каскад от auth.users. Платёжные записи остаются без связи с аккаунтом. Файлы чата убирает сервер админки до вызова.';

-- ---------------------------------------------------------------------------
-- 5. Финансы: пополнения удалённых аккаунтов
-- ---------------------------------------------------------------------------

-- Лента платежей: пополнения (успешные / с возвратом) и отказы оплаты
-- решения, когда баланса не хватило (402 в журнале запросов). Пополнение
-- и возврат удалённого аккаунта остаются в ленте с подписью вместо почты.
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
        t.id::text as id, 'top_up' as type, t.user_id,
        case when t.user_id is null then 'аккаунт удалён' else u.email end as email,
        t.amount,
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
      left join auth.users u on u.id = t.user_id
      where t.created_at >= from_ts and t.created_at < to_ts
      union all
      select
        r.id::text, 'refund', r.user_id,
        case when r.user_id is null then 'аккаунт удалён' else u.email end,
        r.amount, 'refund', 'возврат', t.provider_reference, r.reason, r.amount, r.created_at
      from private.top_up_refunds r
      join private.verified_balance_top_ups t on t.id = r.top_up_id
      left join auth.users u on u.id = r.user_id
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
-- кошелька снимается та же сумма. Только владелец (выплаты). У удалённого
-- аккаунта кошелька нет: возврат записывается без списания, в пределах
-- ещё не возвращённой части пополнения.
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

  if top_up.user_id is not null then
    select balance into current_balance from public.wallet_accounts where user_id = top_up.user_id for update;
    if current_balance is null or current_balance < p_amount then
      raise exception 'balance is lower than the refund' using errcode = '22023';
    end if;

    update public.wallet_accounts set balance = balance - p_amount, updated_at = now() where user_id = top_up.user_id;
    insert into public.wallet_entries (user_id, amount, kind, description, idempotency_key)
    values (top_up.user_id, -p_amount, 'debit', left('Возврат пополнения: ' || normalized_reason, 160), 'top-up-refund:' || gen_random_uuid()::text)
    returning id into entry_id;
  end if;

  insert into private.top_up_refunds (top_up_id, user_id, actor_id, amount, reason, wallet_entry_id)
  values (p_top_up_id, top_up.user_id, actor, p_amount, normalized_reason, entry_id)
  returning id into refund_id;

  perform private.audit('payment_refunded', top_up.user_id,
    jsonb_build_object('topUpId', p_top_up_id, 'refundId', refund_id, 'reason', normalized_reason, 'accountDeleted', top_up.user_id is null),
    jsonb_build_object('balance', current_balance, 'refunded', already),
    jsonb_build_object('balance', current_balance - p_amount, 'refunded', already + p_amount));

  return jsonb_build_object('refundId', refund_id, 'amount', p_amount);
end;
$$;

revoke all on function public.admin_finance_payments(text, date, date, text, integer, integer) from public, anon;
grant execute on function public.admin_finance_payments(text, date, date, text, integer, integer) to authenticated;
revoke all on function public.admin_finance_refund(uuid, integer, text) from public, anon;
grant execute on function public.admin_finance_refund(uuid, integer, text) to authenticated;
