alter table public.wallet_accounts
  alter column balance set default 3;

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
  values (new.id, 3);

  insert into public.wallet_entries (user_id, amount, kind, description, idempotency_key)
  values (new.id, 3, 'credit', 'Стартовый баланс', 'welcome-credit');

  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;
