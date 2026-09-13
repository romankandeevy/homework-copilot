-- Реферальная награда для тех, кто вошёл по номеру телефона.
--
-- Награду выдают три триггера (20260913100000, 20260913100010), и все
-- смотрят только на `email_confirmed_at`. У аккаунта, созданного кодом из
-- СМС, почты нет вовсе: подтверждён телефон (`phone_confirmed_at`), а
-- `email_confirmed_at` навсегда пуст. Такое приглашение висело бы в
-- pending, а кошелёк обещал бы другу «+5 ₽ придут, как только подтвердишь».
--
-- Как идёт вход по телефону: `signInWithOtp` создаёт строку в auth.users
-- сразу, с неподтверждённым телефоном, - кошелёк и привязка приглашения
-- появляются уже тогда. Телефон подтверждается кодом из СМС
-- (`verifyOtp`), и Supabase проставляет `phone_confirmed_at` обновлением.
-- Этот момент и считается подтверждённой регистрацией - так же, как ввод
-- кода из письма для почты. Пока кода нет, награды нет: номер без СМС
-- ничего не приносит.
--
-- private.reward_referral_signup ищет только приглашения в статусе
-- pending, так что два подтверждения (почта и телефон) второй раз не
-- заплатят.

create or replace function private.reward_referral_after_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.email_confirmed_at is not null or new.phone_confirmed_at is not null then
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
  if (old.email_confirmed_at is null and new.email_confirmed_at is not null)
    or (old.phone_confirmed_at is null and new.phone_confirmed_at is not null) then
    perform private.reward_referral_signup(new.id);
  end if;
  return new;
end;
$function$;

create or replace function private.reward_referral_after_bind()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if exists (
    select 1 from auth.users
    where id = new.invitee_user_id
      and (email_confirmed_at is not null or phone_confirmed_at is not null)
  ) then
    perform private.reward_referral_signup(new.invitee_user_id);
  end if;
  return new;
end;
$function$;

revoke all on function private.reward_referral_after_signup() from public, anon, authenticated;
revoke all on function private.reward_referral_after_confirmation() from public, anon, authenticated;
revoke all on function private.reward_referral_after_bind() from public, anon, authenticated;

-- Триггер подтверждения теперь слушает и телефон. Имя прежнее: `zz` держит
-- его последним среди триггеров auth.users.
drop trigger if exists on_auth_user_zz_reward_referral_confirmed on auth.users;
create trigger on_auth_user_zz_reward_referral_confirmed
after update of email_confirmed_at, phone_confirmed_at on auth.users
for each row execute function private.reward_referral_after_confirmation();
