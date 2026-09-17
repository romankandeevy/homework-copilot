-- Предохранитель бесплатных решений гостя на весь сервис (аудит 16 сентября, В1).
--
-- Право на бесплатное решение считается по метке браузера и хэшу адреса
-- (не больше трёх за сутки с адреса). Адрес до 16 сентября прокси брал из
-- первого элемента `x-forwarded-for`, который пишет сам клиент: скрипт с
-- новой меткой и случайным адресом получал решение без предела - три-четыре
-- вызова модели за наш счёт. Прокси теперь берёт адрес от платформы
-- (supabase/functions/api/proxyIdentity.ts), но предел на адрес всё равно
-- обходится пулом адресов. Этот предел не зависит от адреса вовсе: сколько
-- выдач за последний час на весь сервис.
--
-- Порог - `private.app_settings`, ключ `guest_claims_hourly`, по умолчанию
-- 60. Живой трафик гостей сейчас - единицы в час. Поменять:
--   update private.app_settings set value = '120'::jsonb, updated_at = now()
--   where key = 'guest_claims_hourly';
-- 0 выключает бесплатные решения гостя совсем. В админке ключ пока не
-- редактируется: admin_setting_save держит свой список ключей.
--
-- Срабатывание - строка в ленте ошибок и событие `guest_limit_hit` в очередь
-- уведомлений владельцу (Telegram и почта), не чаще раза в час. Гость
-- получает тот же отказ, что после своей бесплатной задачи.

insert into private.app_settings (key, value)
values ('guest_claims_hourly', '60'::jsonb)
on conflict (key) do nothing;

insert into private.admin_notification_rules (event, title, telegram, email)
values ('guest_limit_hit', 'Сработал предел бесплатных решений гостя', true, true)
on conflict (event) do nothing;

create index if not exists guest_solution_grants_created_idx
  on private.guest_solution_grants (created_at desc);

create or replace function private.guest_claims_hourly_limit()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select case
        when jsonb_typeof(s.value) = 'number' then greatest(0, least((s.value #>> '{}')::numeric, 100000))::integer
      end
      from private.app_settings s
      where s.key = 'guest_claims_hourly'
    ),
    60
  );
$$;

revoke all on function private.guest_claims_hourly_limit() from public, anon, authenticated;

create or replace function public.claim_guest_solution(
  p_guest_id uuid,
  p_idempotency_key text,
  p_ip_hash text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  normalized_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  existing private.guest_solution_grants%rowtype;
  recent_from_address integer;
  hourly_limit integer := private.guest_claims_hourly_limit();
  granted_last_hour integer;
begin
  if p_guest_id is null or normalized_key is null or char_length(normalized_key) > 120 then
    return false;
  end if;

  select * into existing
  from private.guest_solution_grants
  where guest_id = p_guest_id
  for update;

  if found then
    -- Повтор того же запроса - та же попытка, а не новая.
    return existing.idempotency_key is not distinct from normalized_key;
  end if;

  if p_ip_hash is not null then
    select count(*) into recent_from_address
    from private.guest_solution_grants
    where ip_hash = p_ip_hash
      and created_at > now() - interval '24 hours';

    if recent_from_address >= 3 then
      return false;
    end if;
  end if;

  -- Общий предел на сервис. Замок сериализует параллельные выдачи, иначе
  -- пачка одновременных запросов прошла бы мимо счётчика.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('guest_claims_hourly', 0));

  select count(*) into granted_last_hour
  from private.guest_solution_grants
  where created_at > now() - interval '1 hour';

  if granted_last_hour >= hourly_limit then
    -- Событие - раз в час: отказов при атаке тысячи, лента и очередь
    -- уведомлений не должны расти вместе с ними.
    if not exists (
      select 1 from private.error_events e
      where e.fingerprint = private.error_fingerprint('api', 'solve', 'guest free solution hourly limit reached')
        and e.created_at > now() - interval '1 hour'
    ) then
      perform private.record_error(
        'api', 'warning', 'solve', 'guest free solution hourly limit reached', null, null,
        null, null, null, null,
        jsonb_build_object('granted', granted_last_hour, 'limit', hourly_limit)
      );
      perform private.notify_admin(
        'guest_limit_hit',
        format(
          'За последний час выдано %s бесплатных решений гостям - это предел (%s). Новые гости получают отказ «Бесплатное решение уже использовано». Если это не атака - подними guest_claims_hourly в private.app_settings.',
          granted_last_hour,
          hourly_limit
        ),
        jsonb_build_object('granted', granted_last_hour, 'limit', hourly_limit),
        'guest_limit_hit:' || to_char(date_trunc('hour', now()), 'YYYY-MM-DD"T"HH24')
      );
    end if;
    return false;
  end if;

  insert into private.guest_solution_grants (guest_id, idempotency_key, ip_hash, consumed_at)
  values (p_guest_id, normalized_key, p_ip_hash, now());

  return true;
end;
$function$;

revoke all on function public.claim_guest_solution(uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_guest_solution(uuid, text, text) to service_role;
