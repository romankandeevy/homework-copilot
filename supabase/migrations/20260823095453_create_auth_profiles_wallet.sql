create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default 'Ученик',
  grade smallint not null default 8,
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_full_name_length check (char_length(full_name) between 1 and 80),
  constraint profiles_grade_range check (grade between 1 and 11),
  constraint profiles_avatar_path_length check (avatar_path is null or char_length(avatar_path) <= 512)
);

create table public.wallet_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance integer not null default 4,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wallet_accounts_non_negative_balance check (balance >= 0)
);

create table public.wallet_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount integer not null,
  kind text not null,
  description text not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  constraint wallet_entries_non_zero_amount check (amount <> 0),
  constraint wallet_entries_kind check (kind in ('credit', 'debit')),
  constraint wallet_entries_sign_matches_kind check (
    (kind = 'credit' and amount > 0) or (kind = 'debit' and amount < 0)
  ),
  constraint wallet_entries_description_length check (char_length(description) between 1 and 160),
  constraint wallet_entries_idempotency_length check (char_length(idempotency_key) between 8 and 160),
  unique (user_id, idempotency_key)
);

create index wallet_entries_user_created_idx
  on public.wallet_entries (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.wallet_accounts enable row level security;
alter table public.wallet_entries enable row level security;

revoke all on public.profiles from anon, authenticated;
revoke all on public.wallet_accounts from anon, authenticated;
revoke all on public.wallet_entries from anon, authenticated;

grant select on public.profiles to authenticated;
grant insert (id, full_name, grade, avatar_path) on public.profiles to authenticated;
grant update (full_name, grade, avatar_path) on public.profiles to authenticated;
grant select on public.wallet_accounts to authenticated;
grant select on public.wallet_entries to authenticated;

create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = id);

create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "wallet_accounts_select_own"
  on public.wallet_accounts for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "wallet_entries_select_own"
  on public.wallet_entries for select
  to authenticated
  using ((select auth.uid()) = user_id);

create function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function private.set_updated_at() from public, anon, authenticated;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

create trigger wallet_accounts_set_updated_at
  before update on public.wallet_accounts
  for each row execute function private.set_updated_at();

create function private.handle_new_user()
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
  values (new.id, 4);

  insert into public.wallet_entries (user_id, amount, kind, description, idempotency_key)
  values (new.id, 4, 'credit', 'Стартовый баланс', 'welcome-credit');

  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create function public.spend_solution_credit(
  p_idempotency_key text,
  p_description text default 'Решение задачи'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid;
  resulting_balance integer;
begin
  current_user_id := (select auth.uid());

  if current_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if char_length(coalesce(p_idempotency_key, '')) not between 8 and 160 then
    raise exception 'invalid idempotency key' using errcode = '22023';
  end if;

  if char_length(coalesce(p_description, '')) not between 1 and 160 then
    raise exception 'invalid description' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.wallet_entries
    where user_id = current_user_id and idempotency_key = p_idempotency_key
  ) then
    select balance into resulting_balance
    from public.wallet_accounts where user_id = current_user_id;
    return resulting_balance;
  end if;

  update public.wallet_accounts
  set balance = balance - 1
  where user_id = current_user_id and balance >= 1
  returning balance into resulting_balance;

  if resulting_balance is null then
    raise exception 'insufficient balance' using errcode = 'P0001';
  end if;

  insert into public.wallet_entries (user_id, amount, kind, description, idempotency_key)
  values (current_user_id, -1, 'debit', p_description, p_idempotency_key);

  return resulting_balance;
exception
  when unique_violation then
    select balance into resulting_balance
    from public.wallet_accounts where user_id = current_user_id;
    return resulting_balance;
end;
$$;

revoke all on function public.spend_solution_credit(text, text) from public, anon, authenticated;
grant execute on function public.spend_solution_credit(text, text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-avatars',
  'profile-avatars',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "avatar_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "avatar_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "avatar_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "avatar_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
