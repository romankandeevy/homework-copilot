-- Реферальная награда снова приходит при подтверждённой регистрации.
--
-- Решение владельца от 13 сентября. Правило возвращается к тому, что ввела
-- миграция 20260831090000: как только приглашённый зарегистрировался по
-- ссылке и подтвердил почту, пригласившему +10 ₽, приглашённому +5 ₽.
-- Пополнять баланс для этого не нужно.
--
-- 6 сентября (20260906190404) награду перенесли на первое пополнение:
-- самоприглашение со второго одноразового ящика приносило пригласившему
-- десять рублей. Эта дыра снова открыта, и это принято сознательно. Пока
-- оплата не подключена, пополнение делает только владелец вручную, так что
-- по правилу 6 сентября приглашение почти никогда не приносило награды.
-- Вторая половина той правки остаётся: стартовые 20 ₽ по-прежнему выдаются
-- один раз на метку браузера.
--
-- Функция выдачи `private.reward_referral_signup` и оба триггера живут с
-- 31 августа. 6 сентября обнулили только тела функций-триггеров - здесь
-- они возвращаются. Путь через `admin_record_verified_top_up` не трогаем:
-- он, как и эта функция, ищет только приглашения в статусе `pending` и
-- второй раз заплатить не может.

-- Вход через Google подтверждает почту сразу, поэтому награда выдаётся уже
-- на вставке строки. Регистрация по почте подтверждается кодом позже -
-- её ловит второй триггер.
create or replace function private.reward_referral_after_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.email_confirmed_at is not null then
    perform private.reward_referral_signup(new.id);
  end if;
  return new;
end;
$function$;

create or replace function private.reward_referral_after_confirmation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    perform private.reward_referral_signup(new.id);
  end if;
  return new;
end;
$function$;

revoke all on function private.reward_referral_after_signup() from public, anon, authenticated;
revoke all on function private.reward_referral_after_confirmation() from public, anon, authenticated;

-- Триггеры не удалялись, но пересоздаём их, чтобы миграция не зависела от
-- этого. Имя начинается с `zz`, чтобы триггер сработал последним: приглашение
-- привязывает `on_auth_user_bind_referral`, а кошелёк создаёт
-- `on_auth_user_created`, и оба должны отработать раньше награды.
drop trigger if exists on_auth_user_zz_reward_referral on auth.users;
create trigger on_auth_user_zz_reward_referral
after insert on auth.users
for each row execute function private.reward_referral_after_signup();

drop trigger if exists on_auth_user_zz_reward_referral_confirmed on auth.users;
create trigger on_auth_user_zz_reward_referral_confirmed
after update of email_confirmed_at on auth.users
for each row execute function private.reward_referral_after_confirmation();

-- Приглашения, которые с 6 сентября ждали пополнения, по новому правилу уже
-- заработаны, если приглашённый подтвердил почту. Так же поступила миграция
-- 31 августа. Сюда попадут и самоприглашения, сделанные за эту неделю.
do $backfill$
declare
  pending_invitee uuid;
begin
  for pending_invitee in
    select invite.invitee_user_id
    from public.referral_invites invite
    join auth.users u on u.id = invite.invitee_user_id
    where invite.status = 'pending'
      and u.email_confirmed_at is not null
  loop
    perform private.reward_referral_signup(pending_invitee);
  end loop;
end;
$backfill$;
