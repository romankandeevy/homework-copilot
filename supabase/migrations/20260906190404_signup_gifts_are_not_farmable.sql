-- Подарки за регистрацию перестают быть заработком.
--
-- Считаем, во что обходилась одна одноразовая почта до этой правки:
-- стартовые 20 ₽ новому аккаунту, +5 ₽ ему же как приглашённому и +10 ₽
-- пригласившему. Тридцать пять рублей за адрес, из них десять - прямо на
-- счёт того, кто это делает. Двадцать адресов - семьсот рублей подарков,
-- и никакой границы: почта подтверждается кодом, а одноразовых ящиков в
-- интернете сколько угодно.
--
-- Закрываем с двух сторон.
--
-- 1. Реферальная награда возвращается к первому пополнению. 31 августа её
--    перенесли на подтверждение почты - «чтобы приглашать имело смысл
--    сразу». Смысл появился и у самоприглашений: пригласить себя со второго
--    ящика стало операцией на десять рублей. Награда снова ждёт того
--    момента, который нельзя подделать бесплатно, - живого пополнения
--    баланса приглашённым. Путь выдачи при пополнении уже есть и работает
--    (admin_record_verified_top_up), трогать его не нужно.
--
-- 2. Стартовые 20 ₽ выдаются один раз на браузер. Клиент присылает при
--    регистрации свою метку - ту же, по которой гостю выдаётся бесплатное
--    решение. Метка уже ограничена по адресу: не больше трёх гостевых
--    выдач с одного IP за сутки. Аккаунт со знакомой меткой получает
--    доступ и профиль, но не деньги.
--
--    Метки нет вовсе (старый браузер, приватный режим, отключённое
--    хранилище) - деньги выдаются. Иначе честный ученик без localStorage
--    остался бы без стартового баланса, а это дороже, чем редкий обход.

create table if not exists private.welcome_grants (
  device_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists welcome_grants_created_at_idx
  on private.welcome_grants (created_at desc);

-- Метка браузера уже израсходовала стартовые деньги.
create or replace function private.welcome_credit_is_spent(p_device_id text)
returns boolean
language sql
stable
set search_path = ''
as $function$
  select exists (
    select 1 from private.welcome_grants where device_id = p_device_id
  );
$function$;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  profile_name text;
  profile_grade smallint;
  device_id text := nullif(trim(coalesce(new.raw_user_meta_data ->> 'device_id', '')), '');
  gives_welcome boolean := true;
begin
  profile_name := left(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 120);

  if coalesce(new.raw_user_meta_data ->> 'grade', '') ~ '^[1-9]$|^1[01]$' then
    profile_grade := (new.raw_user_meta_data ->> 'grade')::smallint;
  else
    profile_grade := 8;
  end if;

  -- Метка есть и уже получала подарок: аккаунт создаётся, деньги - нет.
  if device_id is not null and char_length(device_id) <= 64 then
    gives_welcome := not private.welcome_credit_is_spent(device_id);
  end if;

  insert into public.profiles (id, full_name, grade)
  values (new.id, profile_name, profile_grade);

  insert into public.wallet_accounts (user_id, balance)
  values (new.id, case when gives_welcome then 2000 else 0 end);

  if gives_welcome then
    insert into public.wallet_entries (user_id, amount, kind, description, idempotency_key)
    values (new.id, 2000, 'credit', 'Стартовые 20 ₽', 'welcome-credit');

    if device_id is not null and char_length(device_id) <= 64 then
      insert into private.welcome_grants (device_id, user_id)
      values (device_id, new.id)
      on conflict (device_id) do nothing;
    end if;
  end if;

  return new;
end;
$function$;

-- Реферальная награда больше не выдаётся по факту подтверждения почты.
-- Функция остаётся: её зовёт путь первого пополнения.
create or replace function private.reward_referral_after_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  -- Подтверждённая почта больше не считается поводом платить: одноразовый
  -- ящик подтверждается так же легко, как настоящий. Награду выдаёт первое
  -- пополнение приглашённого - оно стоит денег и потому не подделывается.
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
  return new;
end;
$function$;
