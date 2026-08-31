-- Первое решение без аккаунта и реферальная награда в момент регистрации.
--
-- Две связанные правки одного барьера. Разбор интерфейса показал: самая
-- дорогая граница на сайте — требование завести аккаунт до того, как человек
-- увидел хоть одно решение. Ниже она снимается с двух сторон:
--
--   1. Гостю выдаётся ровно одно бесплатное решение — за счёт тех же
--      приветственных денег, только выданных авансом и без формы регистрации.
--   2. Реферальная награда больше не ждёт первого пополнения: она приходит,
--      как только приглашённый подтвердил регистрацию. Пригласить друга
--      теперь имеет смысл сразу, а не когда-нибудь потом.

-- ---------------------------------------------------------------------------
-- Блок 1. Реферальная награда при регистрации.
--
-- Награда выдаётся один раз на приглашение и только приглашению в статусе
-- `pending`, поэтому путь через `admin_record_verified_top_up` остаётся
-- рабочим и не может заплатить второй раз: он тоже ищет только `pending`.
--
-- Момент выдачи — подтверждённая почта, а не сама строка в `auth.users`.
-- Регистрация без подтверждения не закончена, и платить за неё значит
-- платить за любой введённый адрес.
-- ---------------------------------------------------------------------------

-- Награда больше не привязана к пополнению, поэтому `qualifying_top_up_id`
-- у выданного приглашения может быть пустым. Прежнее ограничение требовало
-- его обязательно и не давало отметить приглашение выданным.
alter table public.referral_invites
  drop constraint if exists referral_invites_reward_state;

alter table public.referral_invites
  add constraint referral_invites_reward_state check (
    (status = 'pending' and qualifying_top_up_id is null and rewarded_at is null)
    or (
      status = 'rewarded'
      and rewarded_at is not null
      and referrer_wallet_entry_id is not null
      and invitee_wallet_entry_id is not null
    )
  );

create or replace function private.reward_referral_signup(p_invitee_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  referral public.referral_invites%rowtype;
  referrer_entry_id uuid;
  invitee_entry_id uuid;
begin
  select * into referral
  from public.referral_invites
  where invitee_user_id = p_invitee_user_id
    and status = 'pending'
  for update;

  if not found then
    return false;
  end if;

  -- Кошелёк приглашённого создаёт handle_new_user. Если счёта нет у любой
  -- из сторон, награду не выдаём: запись в истории без счёта была бы враньём.
  if not exists (select 1 from public.wallet_accounts where user_id = referral.invitee_user_id)
    or not exists (select 1 from public.wallet_accounts where user_id = referral.referrer_user_id) then
    return false;
  end if;

  update public.wallet_accounts
  set balance = balance + referral.referrer_reward_amount,
      updated_at = now()
  where user_id = referral.referrer_user_id;

  insert into public.wallet_entries (user_id, amount, kind, description, idempotency_key)
  values (
    referral.referrer_user_id,
    referral.referrer_reward_amount,
    'credit',
    'Бонус за приглашённого друга',
    'referral-referrer:' || referral.id::text
  )
  returning id into referrer_entry_id;

  update public.wallet_accounts
  set balance = balance + referral.invitee_reward_amount,
      updated_at = now()
  where user_id = referral.invitee_user_id;

  insert into public.wallet_entries (user_id, amount, kind, description, idempotency_key)
  values (
    referral.invitee_user_id,
    referral.invitee_reward_amount,
    'credit',
    'Бонус за регистрацию по приглашению',
    'referral-invitee:' || referral.id::text
  )
  returning id into invitee_entry_id;

  update public.referral_invites
  set status = 'rewarded',
      referrer_wallet_entry_id = referrer_entry_id,
      invitee_wallet_entry_id = invitee_entry_id,
      rewarded_at = now()
  where id = referral.id;

  return true;
end;
$function$;

revoke all on function private.reward_referral_signup(uuid) from public, anon, authenticated;

-- Вход через Google подтверждает почту сразу, поэтому награда выдаётся уже
-- на вставке строки. Регистрация по почте подтверждается кодом позже —
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

-- Имя триггера начинается с `zz`, чтобы он сработал последним: приглашение
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

-- Приглашения, которые ждали пополнения по старому правилу, теперь его
-- не ждут: по новому правилу они уже заработаны.
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

-- ---------------------------------------------------------------------------
-- Блок 2. Одно бесплатное решение гостю.
--
-- Гость не заводит аккаунт, поэтому у него нет кошелька и нечего резервировать.
-- Вместо баланса считается сам факт: один разбор на браузер. Ключ
-- идемпотентности хранится рядом, чтобы повтор того же запроса не сжигал
-- вторую попытку, а `release_guest_solution` возвращал попытку, если решение
-- так и не выдали.
--
-- Хэш адреса — грубый предохранитель от очистки хранилища в цикле. Сам адрес
-- не хранится: в таблице только необратимый хэш, который считает сервер.
-- ---------------------------------------------------------------------------

create table if not exists private.guest_solution_grants (
  guest_id uuid primary key,
  idempotency_key text,
  ip_hash text,
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);

create index if not exists guest_solution_grants_ip_hash_created_at_idx
  on private.guest_solution_grants (ip_hash, created_at desc);

comment on table private.guest_solution_grants is
  'Одно бесплатное решение на браузер до регистрации. Адрес хранится только хэшем.';

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
begin
  if p_guest_id is null or normalized_key is null or char_length(normalized_key) > 120 then
    return false;
  end if;

  select * into existing
  from private.guest_solution_grants
  where guest_id = p_guest_id
  for update;

  if found then
    -- Повтор того же запроса — та же попытка, а не новая.
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

  insert into private.guest_solution_grants (guest_id, idempotency_key, ip_hash, consumed_at)
  values (p_guest_id, normalized_key, p_ip_hash, now());

  return true;
end;
$function$;

create or replace function public.release_guest_solution(
  p_guest_id uuid,
  p_idempotency_key text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  released integer;
begin
  if p_guest_id is null then
    return false;
  end if;

  delete from private.guest_solution_grants
  where guest_id = p_guest_id
    and idempotency_key is not distinct from nullif(trim(coalesce(p_idempotency_key, '')), '');

  get diagnostics released = row_count;
  return released > 0;
end;
$function$;

revoke all on function public.claim_guest_solution(uuid, text, text) from public, anon, authenticated;
revoke all on function public.release_guest_solution(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_guest_solution(uuid, text, text) to service_role;
grant execute on function public.release_guest_solution(uuid, text) to service_role;
