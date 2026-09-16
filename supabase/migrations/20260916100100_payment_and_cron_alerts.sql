-- Мониторинг денежных и одиночных сбоев (аудит 16 сентября, Е1).
--
-- Что было не видно:
--   * Отказ базы по уведомлению Result (`robokassa_result_mismatch`) и
--     неверная подпись (`robokassa_result_rejected`) жили только в журнале
--     Vercel, который на Hobby хранится час.
--   * check_error_alerts тревожила, только когда ошибка задела больше пяти
--     человек за десять минут: весь пул моделей лежит, единственный ученик
--     получает 503 - тишина.
--   * Если pg_net не достукивается до Vercel, очередь уведомлений стоит, и
--     никто не проверял, когда cron в последний раз дошёл.
--
-- Что добавлено:
--   * report_payment_incident - сервер оплаты ставит уведомление владельцу
--     (правило payment_incident из 20260916100000).
--   * Отдельная ветка check_error_alerts для severity = 'critical' без
--     порога пользователей - не чаще раза в шесть часов на отпечаток, как и
--     прежние тревоги.
--   * Ключ `last_cron_ok_at` в private.app_settings: его ставит успешный
--     cron функции `/api/admin` (mark_admin_cron_ok). Проверка устаревания
--     идёт из задания pg_cron `refresh-daily-metrics`, то есть внутри базы и
--     без Vercel. Тревога - в private.admin_notifications (разошлётся, когда
--     cron оживёт, и видна в админке сразу) и, если владелец положил токен
--     бота в Supabase Vault, прямым net.http_post в Telegram.

-- ---------------------------------------------------------------------------
-- 1. Правила уведомлений
-- ---------------------------------------------------------------------------

insert into private.admin_notification_rules (event, title, telegram, email) values
  ('payment_incident', 'Сбой оплаты: разобрать вручную', true, true),
  ('error_critical', 'Критическая ошибка', true, false),
  ('cron_stale', 'Cron уведомлений не доходит до Vercel', true, true)
on conflict (event) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Сбой оплаты с сервера
-- ---------------------------------------------------------------------------

-- Текст собирается здесь, а не на сервере: сервер передаёт вид случая,
-- номер заказа и короткую причину. Ключи дедупликации держат шум:
--   result_mismatch  - одно уведомление на заказ;
--   result_rejected  - одно в час на все отказы подписи (адрес публичный,
--                      неверную подпись может прислать кто угодно);
--   reconcile_failed - одно на заказ.
create or replace function public.report_payment_incident(p_kind text, p_inv_id integer default null, p_detail text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  detail text := nullif(left(trim(coalesce(p_detail, '')), 300), '');
  order_label text := case when p_inv_id is null then 'без номера' else '№' || p_inv_id::text end;
begin
  if p_kind = 'result_mismatch' then
    perform private.notify_admin('payment_incident',
      format('Робокасса прислала Result по заказу %s, а база отказала: %s. Деньги могли прийти без зачисления - сверь заказ с кабинетом Робокассы.',
        order_label, coalesce(detail, 'причина не указана')),
      jsonb_build_object('kind', p_kind, 'invId', p_inv_id, 'detail', detail),
      'payment_incident:mismatch:' || coalesce(p_inv_id::text, to_char(now(), 'YYYYMMDDHH24')));
  elsif p_kind = 'result_rejected' then
    perform private.notify_admin('payment_incident',
      format('Уведомление Result отклонено (%s), заказ %s. Если это настоящий платёж - проверь пароль 2 и алгоритм подписи (ROBOKASSA_HASH) в кабинете и на Vercel.',
        coalesce(detail, 'неверная подпись'), order_label),
      jsonb_build_object('kind', p_kind, 'invId', p_inv_id, 'detail', detail),
      'payment_incident:rejected:' || to_char(now(), 'YYYYMMDDHH24'));
  elsif p_kind = 'reconcile_failed' then
    perform private.notify_admin('payment_incident',
      format('Заказ %s закрыт сроком: за трое суток сверка так и не получила от Робокассы ответа (%s). Проверь заказ в кабинете Робокассы.',
        order_label, coalesce(detail, 'ошибка')),
      jsonb_build_object('kind', p_kind, 'invId', p_inv_id, 'detail', detail),
      'payment_incident:reconcile:' || coalesce(p_inv_id::text, to_char(now(), 'YYYYMMDDHH24')));
  else
    raise exception 'unknown payment incident' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.report_payment_incident(text, integer, text) from public, anon, authenticated;
grant execute on function public.report_payment_incident(text, integer, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Тревоги по ошибкам
-- ---------------------------------------------------------------------------

-- Алерты по ошибкам: критическая ошибка - сразу, с первого случая; новая
-- ошибка задела больше N пользователей за окно; общий всплеск за час.
create or replace function private.check_error_alerts()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  alert_users integer := private.setting_int('error_alert_users', 5);
  alert_window integer := private.setting_int('error_alert_window_minutes', 10);
  spike integer := private.setting_int('error_spike_hourly', 20);
  row_record record;
  last_hour integer;
begin
  -- Критическая ошибка без порога пользователей: когда лежит весь пул
  -- моделей, единственный ученик с 503 - уже повод. От шума - та же
  -- отметка alerted_at, что у тревоги ниже: не чаще раза в шесть часов на
  -- отпечаток.
  for row_record in
    select g.fingerprint, g.title, g.route, g.kind, count(*) as events,
      count(distinct coalesce(e.user_id::text, e.guest_id::text, e.ip)) as users
    from private.error_groups g
    join private.error_events e on e.fingerprint = g.fingerprint
      and e.severity = 'critical'
      and e.created_at > now() - make_interval(mins => alert_window)
    where g.status in ('new', 'in_progress')
      and (g.alerted_at is null or g.alerted_at < now() - interval '6 hours')
    group by g.fingerprint, g.title, g.route, g.kind
  loop
    perform private.notify_admin('error_critical',
      format('%s · %s · %s раз за %s мин, пользователей: %s: %s', row_record.kind, coalesce(row_record.route, '-'), row_record.events, alert_window, row_record.users, row_record.title),
      jsonb_build_object('fingerprint', row_record.fingerprint, 'severity', 'critical'));
    update private.error_groups set alerted_at = now() where fingerprint = row_record.fingerprint;
  end loop;

  for row_record in
    select g.fingerprint, g.title, g.route, g.kind,
      count(distinct coalesce(e.user_id::text, e.guest_id::text, e.ip)) as users
    from private.error_groups g
    join private.error_events e on e.fingerprint = g.fingerprint and e.created_at > now() - make_interval(mins => alert_window)
    where g.status in ('new', 'in_progress')
      and (g.alerted_at is null or g.alerted_at < now() - interval '6 hours')
    group by g.fingerprint, g.title, g.route, g.kind
    having count(distinct coalesce(e.user_id::text, e.guest_id::text, e.ip)) > alert_users
  loop
    perform private.notify_admin('error_alert',
      format('%s · %s · %s пользователей за %s мин: %s', row_record.kind, coalesce(row_record.route, '-'), row_record.users, alert_window, row_record.title),
      jsonb_build_object('fingerprint', row_record.fingerprint));
    update private.error_groups set alerted_at = now() where fingerprint = row_record.fingerprint;
  end loop;

  select count(*) into last_hour from private.error_events where created_at > now() - interval '1 hour';
  if last_hour > spike then
    perform private.notify_admin('error_spike',
      format('За последний час %s ошибок (порог %s)', last_hour, spike),
      jsonb_build_object('count', last_hour),
      'error_spike:' || to_char(now(), 'YYYYMMDDHH24'));
  end if;
end;
$$;

revoke all on function private.check_error_alerts() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Живость cron уведомлений
-- ---------------------------------------------------------------------------

-- Успешный проход `/api/admin` (action = cron) отмечает время. Ключ не
-- настройка владельца: admin_setting_save его не принимает.
create or replace function public.mark_admin_cron_ok()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  insert into private.app_settings (key, value, updated_at, updated_by)
  values ('last_cron_ok_at', to_jsonb(now()), now(), null)
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = null;
end;
$$;

revoke all on function public.mark_admin_cron_ok() from public, anon, authenticated;
grant execute on function public.mark_admin_cron_ok() to service_role;

-- Запасной канал в Telegram мимо Vercel. Токен бота в базе открытым текстом
-- не лежит: функция читает его из Supabase Vault (секреты
-- `telegram_bot_token` и `telegram_owner_chat_id`), если владелец их туда
-- положил. Нет Vault или секретов - запасного канала нет, остаётся запись
-- в admin_notifications. Сбой отправки ничего не роняет.
create or replace function private.send_telegram_fallback(p_text text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  bot_token text;
  chat_id text;
begin
  if to_regclass('vault.decrypted_secrets') is null then
    return false;
  end if;
  execute $sql$select max(decrypted_secret) filter (where name = 'telegram_bot_token'),
                      max(decrypted_secret) filter (where name = 'telegram_owner_chat_id')
               from vault.decrypted_secrets
               where name in ('telegram_bot_token', 'telegram_owner_chat_id')$sql$
    into bot_token, chat_id;
  if coalesce(bot_token, '') = '' or coalesce(chat_id, '') = '' then
    return false;
  end if;
  perform net.http_post(
    url := 'https://api.telegram.org/bot' || bot_token || '/sendMessage',
    body := jsonb_build_object('chat_id', chat_id, 'text', left(p_text, 4000), 'disable_web_page_preview', true),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    timeout_milliseconds := 10000
  );
  return true;
exception when others then
  raise warning 'telegram fallback failed: %', sqlerrm;
  return false;
end;
$$;

revoke all on function private.send_telegram_fallback(text) from public, anon, authenticated;

-- Cron молчит дольше 10 минут (он ходит раз в минуту) - тревога, не чаще
-- раза в час. Пока ключа нет (сервер ещё не выкатан с mark_admin_cron_ok),
-- проверка молчит: иначе тревога пришла бы сразу после миграции.
create or replace function private.check_admin_cron_freshness()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  last_ok timestamptz;
  dedupe text := 'cron_stale:' || to_char(now(), 'YYYYMMDDHH24');
  message text;
begin
  select (value #>> '{}')::timestamptz into last_ok from private.app_settings where key = 'last_cron_ok_at';
  if last_ok is null or last_ok > now() - interval '10 minutes' then
    return;
  end if;
  if exists (select 1 from private.admin_notifications where dedupe_key = dedupe) then
    return;
  end if;

  message := format('Cron уведомлений не доходит до Vercel с %s МСК: очередь уведомлений, проверки сервисов и сверка заказов Робокассы стоят. Проверь выкатку на Vercel и задание admin-cron.',
    to_char(last_ok at time zone 'Europe/Moscow', 'DD.MM HH24:MI'));
  perform private.notify_admin('cron_stale', message, jsonb_build_object('lastOkAt', last_ok), dedupe);
  perform private.send_telegram_fallback('Homework Copilot · ' || message);
exception when others then
  -- Проверка идёт в одном задании с пересчётом агрегатов и не должна его ронять.
  raise warning 'admin cron freshness check failed: %', sqlerrm;
end;
$$;

revoke all on function private.check_admin_cron_freshness() from public, anon, authenticated;

-- Проверка - в задании агрегатов раз в 5 минут: оно идёт в самой базе и от
-- Vercel не зависит.
select cron.unschedule('refresh-daily-metrics')
where exists (select 1 from cron.job where jobname = 'refresh-daily-metrics');
select cron.schedule('refresh-daily-metrics', '*/5 * * * *', $job$ select private.check_admin_cron_freshness(), private.refresh_recent_metrics(); $job$);
