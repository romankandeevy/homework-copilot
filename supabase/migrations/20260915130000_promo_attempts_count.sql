-- Лимит попыток ввода промокода наконец считает неудачные попытки.
--
-- С 11 сентября redeem_promo_code писала попытку в private.promo_attempts и
-- сразу за этим поднимала исключение на неверном коде. Исключение откатывало
-- всю транзакцию вместе с записью о попытке, поэтому счётчик «не больше
-- десяти попыток в час» не рос никогда: неверные коды можно было перебирать
-- без ограничений. Случайные коды из пакета перебором не подобрать, а
-- простые вроде START20 - можно. Нашёл агент промокодов 15 сентября 2026,
-- владелец велел чинить.
--
-- Теперь на отказ по самому коду функция отвечает строкой
-- { ok: false, error: '<причина>' } и транзакция фиксируется вместе с
-- попыткой. Тексты причин те же, что были в исключениях, поэтому их
-- по-прежнему разбирает promoErrorMessage (src/account/BalancePage.tsx).
-- Исключениями остались только отказы до записи попытки: нет входа,
-- аккаунт заблокирован - там сохранять нечего.
--
-- Порядок выкатки: сначала сайт, который понимает оба ответа (он уже
-- умеет), потом эта миграция. Старый сайт принял бы { ok: false } за успех
-- и показал бы «Начислено 0 ₽».
--
-- Остальное - как в 20260914220000: проверка возраста аккаунта, начисление,
-- тариф, запись погашения.

create or replace function public.redeem_promo_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  normalized text := upper(trim(coalesce(p_code, '')));
  promo private.promo_codes%rowtype;
  used integer;
  entry_id uuid;
  resulting integer;
  plan_title text;
  account_created_at timestamptz;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  perform private.assert_account_not_banned(current_user_id);

  -- Перебор кодов: не больше десяти попыток в час на аккаунт. Одиннадцатая
  -- не пишется: предел уже достигнут, копить строки незачем.
  if (select count(*) from private.promo_attempts where user_id = current_user_id and created_at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('ok', false, 'error', 'promo attempts exceeded');
  end if;
  insert into private.promo_attempts (user_id, code) values (current_user_id, left(normalized, 40));

  -- Дальше ни одного raise: любой отказ должен оставить попытку в счётчике.
  select * into promo from private.promo_codes where code = normalized for update;
  if promo.code is null or not promo.active then
    return jsonb_build_object('ok', false, 'error', 'promo code not found');
  end if;
  if promo.starts_at is not null and promo.starts_at > now() then
    return jsonb_build_object('ok', false, 'error', 'promo code not started');
  end if;
  if promo.expires_at is not null and promo.expires_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'promo code expired');
  end if;
  if exists (select 1 from private.promo_redemptions where code = normalized and user_id = current_user_id) then
    return jsonb_build_object('ok', false, 'error', 'promo code already used');
  end if;
  if promo.new_users_days is not null then
    select created_at into account_created_at from auth.users where id = current_user_id;
    if account_created_at is null or account_created_at < now() - make_interval(days => promo.new_users_days) then
      return jsonb_build_object('ok', false, 'error', 'promo code for new accounts only');
    end if;
  end if;
  select count(*) into used from private.promo_redemptions where code = normalized;
  if promo.max_uses is not null and used >= promo.max_uses then
    return jsonb_build_object('ok', false, 'error', 'promo code exhausted');
  end if;

  if promo.kind = 'balance' then
    update public.wallet_accounts set balance = balance + promo.amount_kopecks, updated_at = now()
    where user_id = current_user_id returning balance into resulting;
    if resulting is null then
      -- Кошелька нет - начислять некуда, и это не ошибка ученика в коде:
      -- здесь исключение уместно, откатить попытку не жалко.
      raise exception 'wallet not found' using errcode = 'P0002';
    end if;
    insert into public.wallet_entries (user_id, amount, kind, description, idempotency_key)
    values (current_user_id, promo.amount_kopecks, 'credit', left('Промокод ' || normalized, 160), left('promo:' || normalized, 160))
    returning id into entry_id;
  else
    update private.user_plans set revoked_at = now() where user_id = current_user_id and revoked_at is null;
    insert into private.user_plans (user_id, plan_id, expires_at, source, note)
    values (current_user_id, promo.plan_id, now() + make_interval(days => promo.plan_days), 'promo', 'Промокод ' || normalized);
    select title into plan_title from private.plans where id = promo.plan_id;
  end if;

  insert into private.promo_redemptions (code, user_id, wallet_entry_id) values (normalized, current_user_id, entry_id);

  return jsonb_build_object(
    'ok', true,
    'kind', promo.kind,
    'amount', promo.amount_kopecks,
    'balance', resulting,
    'planTitle', plan_title,
    'planDays', promo.plan_days
  );
end;
$$;

revoke all on function public.redeem_promo_code(text) from public, anon;
grant execute on function public.redeem_promo_code(text) to authenticated;
