-- Чат стоял сутки из-за нулевого возврата в книге кошелька.
--
-- Цепочка, разобранная 5 сентября по журналу cron:
--
--   1. 4 сентября в 19:21 генерация чата осталась в статусе `reserved`:
--      функция на Vercel не дошла до конца, закрыть строку было некому.
--   2. Уборщик `reap_stale_chat_generations` крутится раз в пять минут и
--      обязан такие строки закрывать с возвратом резерва. Но у этой строки
--      резерв был нулевой, а уборщик всё равно писал в `wallet_entries`
--      строку возврата на 0 - и падал на ограничении
--      `wallet_entries_non_zero_amount`. Каждые пять минут, сутки подряд.
--   3. Пока строка висит, `assert_chat_quota` считает её активной
--      генерацией, и любой следующий вопрос получает «Дождись, пока
--      закончится предыдущий ответ» - при живом провайдере и рабочих
--      моделях. По симптому это выглядело как поломка модели.
--
-- Чиним обе стороны. Уборщик перестаёт писать пустые строки в книгу:
-- нулевой резерв возвращать нечем, и запись о движении денег там, где
-- денег не двигали, - ложь в кошельке ученика. Плюс срок в проверке
-- квоты: даже если уборщик снова сломается, брошенная бронь перестаёт
-- запирать чат навсегда.

create or replace function private.reap_stale_chat_generations()
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  stale record;
  reaped integer := 0;
begin
  for stale in
    select * from public.chat_generations
    where status = 'reserved' and created_at < now() - interval '10 minutes'
    for update skip locked
  loop
    -- Деньги возвращаем только там, где они были зарезервированы.
    -- Нулевой возврат ломал вставку в книгу и вместе с ней весь уборщик.
    if coalesce(stale.reserved_kopecks, 0) > 0 then
      update public.wallet_accounts
      set balance = balance + stale.reserved_kopecks
      where user_id = stale.user_id;

      insert into public.wallet_entries (user_id, amount, kind, description, idempotency_key)
      values (stale.user_id, stale.reserved_kopecks, 'credit', 'Возврат резерва чата',
              left(stale.idempotency_key || ':settle', 160))
      on conflict do nothing;
    end if;

    update public.chat_generations
    set status = 'refunded',
        charged_kopecks = 0,
        error = coalesce(error, 'Генерация не завершилась'),
        finished_at = now()
    where id = stale.id;

    reaped := reaped + 1;
  end loop;

  return reaped;
end;
$function$;

-- Вторая линия: активной считается только свежая бронь.
--
-- Пять минут - потолок живой генерации с запасом: таймаут ответа модели
-- в `chat_settings` меньше. Уборщик закрывает строки через десять минут,
-- но чат перестаёт быть запертым уже через пять - раньше, чем ученик
-- успеет решить, что сервис сломан.
create or replace function private.assert_chat_quota(p_user_id uuid, p_image_count integer default 0)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  settings private.chat_settings%rowtype;
  used_minute integer;
  used_hour integer;
  spent_today integer;
  images_today integer;
  active_generations integer;
begin
  select * into settings from private.chat_settings where id;

  if not found or not settings.is_enabled then
    raise exception 'chat is disabled' using errcode = '53400';
  end if;

  perform private.assert_account_not_banned(p_user_id);

  select count(*) into used_minute
  from public.chat_generations
  where user_id = p_user_id and created_at > now() - interval '1 minute';

  if used_minute >= settings.max_messages_per_minute then
    raise exception 'chat rate limit per minute' using errcode = '53400';
  end if;

  select count(*) into used_hour
  from public.chat_generations
  where user_id = p_user_id and created_at > now() - interval '1 hour';

  if used_hour >= settings.max_messages_per_hour then
    raise exception 'chat rate limit per hour' using errcode = '53400';
  end if;

  -- Одна активная генерация на пользователя. Это и защита от спама,
  -- и защита от гонки: два параллельных резерва не пройдут. Активной
  -- считается только свежая бронь - брошенную закрывает срок.
  select count(*) into active_generations
  from public.chat_generations
  where user_id = p_user_id
    and status = 'reserved'
    and created_at > now() - interval '5 minutes';

  if active_generations >= settings.max_active_generations then
    raise exception 'chat generation already running' using errcode = '55006';
  end if;

  select coalesce(sum(charged_kopecks), 0) into spent_today
  from public.chat_generations
  where user_id = p_user_id
    and created_at > now() - interval '1 day'
    and status in ('succeeded', 'refunded');

  if spent_today >= settings.max_daily_spend_kopecks then
    raise exception 'chat daily spend limit' using errcode = '53400';
  end if;

  if p_image_count > 0 then
    select coalesce(sum(image_count), 0) into images_today
    from public.chat_generations
    where user_id = p_user_id and created_at > now() - interval '1 day';

    if images_today + p_image_count > settings.max_images_per_day then
      raise exception 'chat image quota exceeded' using errcode = '53400';
    end if;
  end if;
end;
$function$;

-- Зависшую строку закрывает сам исправленный уборщик - здесь, чтобы чат
-- ожил в момент применения миграции, а не через пять минут.
select private.reap_stale_chat_generations();
