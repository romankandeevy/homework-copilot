alter table public.wallet_accounts
  alter column balance set default 20;

comment on column public.wallet_accounts.balance is
  'Balance in whole Russian rubles. One stored unit equals one ruble.';

comment on column public.wallet_entries.amount is
  'Wallet operation amount in whole Russian rubles.';

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_name text;
  profile_grade smallint;
begin
  profile_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'Ученик');
  profile_name := left(profile_name, 80);

  if coalesce(new.raw_user_meta_data ->> 'grade', '') ~ '^[1-9]$|^1[01]$' then
    profile_grade := (new.raw_user_meta_data ->> 'grade')::smallint;
  else
    profile_grade := 8;
  end if;

  insert into public.profiles (id, full_name, grade)
  values (new.id, profile_name, profile_grade);

  insert into public.wallet_accounts (user_id, balance)
  values (new.id, 20);

  insert into public.wallet_entries (user_id, amount, kind, description, idempotency_key)
  values (new.id, 20, 'credit', 'Стартовые 20 ₽', 'welcome-credit');

  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

with required_top_up as (
  select user_id, 20 - balance as amount
  from public.wallet_accounts
  where balance < 20
), inserted_top_up as (
  insert into public.wallet_entries (user_id, amount, kind, description, idempotency_key)
  select user_id, amount, 'credit', 'Подарок к рублёвому балансу', 'ruble-launch-credit'
  from required_top_up
  on conflict (user_id, idempotency_key) do nothing
  returning user_id, amount
)
update public.wallet_accounts as account
set balance = account.balance + top_up.amount
from inserted_top_up as top_up
where account.user_id = top_up.user_id;
