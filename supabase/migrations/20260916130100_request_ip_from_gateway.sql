-- Адрес запроса к базе - от шлюза, а не от клиента (аудит 16 сентября, В3).
--
-- `private.request_ip()` читала `x-client-ip`, потом первый элемент
-- `x-forwarded-for`. Оба пишет сам клиент: любой скрипт с anon-ключом звал
-- `report_client_error` с новым `x-client-ip` на каждый запрос - предел
-- 30 в минуту с адреса не работал, лента ошибок и тревоги в Telegram
-- заваливались; ученик писал себе любые адреса в `user_devices`, на которых
-- стоит антифрод; администратор подменял свой адрес в аудите.
--
-- `x-client-ip` к базе не ходит ни от кого из наших: функции на Vercel
-- передают адрес параметром `p_ip` служебной ролью, а подпись прокси
-- проверяется на Vercel, в базу она не доходит. Отличить «наш прокси» от
-- чужого скрипта база не может - поэтому заголовок больше не читается вовсе.
--
-- Что ставит платформа: `*.supabase.co` стоит за Cloudflare, и
-- `cf-connecting-ip` Cloudflare перезаписывает адресом подключившегося;
-- в `x-forwarded-for` шлюз дописывает настоящий адрес последним (на запрос с
-- подделкой приходит `подделка, настоящий`). `x-real-ip` шлюз не обещает.
-- Берём `cf-connecting-ip`, иначе последний элемент `x-forwarded-for`. Тот же
-- выбор в прокси: supabase/functions/api/proxyIdentity.ts.
--
-- `report_client_error`: размер `p_message`, `p_stack`, `p_route` и
-- `p_environment` ограничен, и кроме предела с адреса есть общий - 300
-- сообщений в минуту на весь сервис. Живой поток ошибок браузера - единицы.

create or replace function private.request_ip()
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  headers jsonb;
  candidate text;
  forwarded text[];
begin
  begin
    headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    return null;
  end;
  if headers is null then
    return null;
  end if;

  candidate := nullif(trim(coalesce(headers ->> 'cf-connecting-ip', '')), '');
  if candidate is null then
    forwarded := string_to_array(coalesce(headers ->> 'x-forwarded-for', ''), ',');
    if coalesce(array_length(forwarded, 1), 0) > 0 then
      candidate := nullif(trim(forwarded[array_length(forwarded, 1)]), '');
    end if;
  end if;

  -- Только то, что похоже на адрес: мусор в журнал и антифрод не пишем.
  if candidate is null or candidate !~ '^[0-9A-Fa-f:.]{2,64}$' then
    return null;
  end if;
  return candidate;
end;
$$;

revoke all on function private.request_ip() from public, anon, authenticated;

create or replace function public.report_client_error(
  p_message text,
  p_stack text default null,
  p_route text default null,
  p_environment jsonb default null,
  p_guest_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_ip text := private.request_ip();
  recent integer;
  recent_total integer;
  environment jsonb;
begin
  -- Общий предел на сервис: без него пул адресов снова обходит предел с адреса.
  select count(*) into recent_total
  from private.error_events e
  where e.kind = 'frontend'
    and e.created_at > now() - interval '1 minute';
  if recent_total >= 300 then
    return;
  end if;

  select count(*) into recent
  from private.error_events e
  where e.kind = 'frontend'
    and e.ip is not distinct from caller_ip
    and e.created_at > now() - interval '1 minute';
  if recent >= 30 then
    return;
  end if;

  -- Окружение из браузера - маленький объект: адрес страницы, размер окна,
  -- язык, сборка. Всё, что больше 2 КБ или не объект, не храним.
  environment := case
    when p_environment is not null
      and jsonb_typeof(p_environment) = 'object'
      and pg_catalog.octet_length(p_environment::text) <= 2000
    then p_environment
    else '{}'::jsonb
  end;

  perform private.record_error(
    'frontend',
    'error',
    left(coalesce(p_route, ''), 120),
    left(p_message, 1000),
    left(p_stack, 8000),
    null,
    (select auth.uid()),
    case when (select auth.uid()) is null then p_guest_id end,
    caller_ip,
    null,
    environment || jsonb_build_object('userAgent', private.request_user_agent())
  );
end;
$$;

revoke all on function public.report_client_error(text, text, text, jsonb, uuid) from public;
grant execute on function public.report_client_error(text, text, text, jsonb, uuid) to anon, authenticated;
