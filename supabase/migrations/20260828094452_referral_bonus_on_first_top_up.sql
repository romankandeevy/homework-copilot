create table public.referral_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  code text not null unique,
  created_at timestamptz not null default now(),
  constraint referral_codes_format check (code ~ '^[A-Z0-9]{10}$')
);

create table private.verified_balance_top_ups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  provider_reference text not null unique,
  amount integer not null check (amount between 1 and 1000000),
  wallet_entry_id uuid not null unique references public.wallet_entries(id) on delete cascade,
  source text not null check (source in ('admin', 'provider')),
  created_at timestamptz not null default now(),
  constraint verified_balance_top_ups_reference_length check (char_length(provider_reference) between 6 and 160)
);

create table public.referral_invites (
  id uuid primary key default gen_random_uuid(),
  referral_code_id uuid not null references public.referral_codes(id) on delete restrict,
  referrer_user_id uuid not null references auth.users(id) on delete cascade,
  invitee_user_id uuid not null unique references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'rewarded')),
  referrer_reward_amount integer not null default 10 check (referrer_reward_amount = 10),
  invitee_reward_amount integer not null default 5 check (invitee_reward_amount = 5),
  qualifying_top_up_id uuid unique references private.verified_balance_top_ups(id) on delete set null,
  referrer_wallet_entry_id uuid unique references public.wallet_entries(id) on delete set null,
  invitee_wallet_entry_id uuid unique references public.wallet_entries(id) on delete set null,
  created_at timestamptz not null default now(),
  rewarded_at timestamptz,
  constraint referral_invites_different_users check (referrer_user_id <> invitee_user_id),
  constraint referral_invites_reward_state check (
    (status = 'pending' and qualifying_top_up_id is null and rewarded_at is null)
    or
    (status = 'rewarded' and qualifying_top_up_id is not null and rewarded_at is not null
      and referrer_wallet_entry_id is not null and invitee_wallet_entry_id is not null)
  )
);

create index referral_invites_referrer_status_idx
  on public.referral_invites (referrer_user_id, status, created_at desc);
create index verified_balance_top_ups_user_created_idx
  on private.verified_balance_top_ups (user_id, created_at);

alter table public.referral_codes enable row level security;
alter table public.referral_invites enable row level security;
alter table private.verified_balance_top_ups enable row level security;

revoke all on public.referral_codes from public, anon, authenticated;
revoke all on public.referral_invites from public, anon, authenticated;
revoke all on private.verified_balance_top_ups from public, anon, authenticated;

create or replace function private.bind_referral_from_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_code text := upper(trim(coalesce(new.raw_user_meta_data ->> 'referral_code', '')));
  matching_code public.referral_codes%rowtype;
begin
  if normalized_code !~ '^[A-Z0-9]{10}$' then
    return new;
  end if;

  select * into matching_code
  from public.referral_codes
  where code = normalized_code;

  if not found or matching_code.user_id = new.id then
    return new;
  end if;

  insert into public.referral_invites (
    referral_code_id,
    referrer_user_id,
    invitee_user_id
  ) values (
    matching_code.id,
    matching_code.user_id,
    new.id
  )
  on conflict (invitee_user_id) do nothing;

  return new;
end;
$$;

revoke all on function private.bind_referral_from_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_bind_referral on auth.users;
create trigger on_auth_user_bind_referral
  after insert on auth.users
  for each row execute function private.bind_referral_from_new_user();

create or replace function public.get_my_referral()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  own_code text;
  candidate text;
  attempt integer;
  invited_count integer;
  pending_count integer;
  rewarded_count integer;
  earned_amount integer;
  joined_status text;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  perform private.assert_account_not_banned(current_user_id);

  select code into own_code
  from public.referral_codes
  where user_id = current_user_id;

  if own_code is null then
    for attempt in 1..12 loop
      candidate := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
      begin
        insert into public.referral_codes (user_id, code)
        values (current_user_id, candidate)
        on conflict (user_id) do nothing;
      exception when unique_violation then
        null;
      end;

      select code into own_code
      from public.referral_codes
      where user_id = current_user_id;

      exit when own_code is not null;
    end loop;
  end if;

  if own_code is null then
    raise exception 'could not create referral code' using errcode = 'P0001';
  end if;

  select
    count(*)::integer,
    count(*) filter (where status = 'pending')::integer,
    count(*) filter (where status = 'rewarded')::integer,
    coalesce(sum(referrer_reward_amount) filter (where status = 'rewarded'), 0)::integer
  into invited_count, pending_count, rewarded_count, earned_amount
  from public.referral_invites
  where referrer_user_id = current_user_id;

  select status into joined_status
  from public.referral_invites
  where invitee_user_id = current_user_id;

  return jsonb_build_object(
    'code', own_code,
    'invitedCount', invited_count,
    'pendingCount', pending_count,
    'rewardedCount', rewarded_count,
    'earnedAmount', earned_amount,
    'joinedViaReferral', joined_status is not null,
    'joinedRewardStatus', joined_status,
    'referrerRewardAmount', 10,
    'inviteeRewardAmount', 5
  );
end;
$$;

create or replace function public.bind_my_referral(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  normalized_code text := upper(trim(coalesce(p_code, '')));
  account_created_at timestamptz;
  matching_code public.referral_codes%rowtype;
  existing_invite public.referral_invites%rowtype;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  perform private.assert_account_not_banned(current_user_id);

  if normalized_code !~ '^[A-Z0-9]{10}$' then
    raise exception 'invalid referral code' using errcode = '22023';
  end if;

  select created_at into account_created_at
  from auth.users
  where id = current_user_id;

  if account_created_at is null or account_created_at < now() - interval '24 hours' then
    raise exception 'referral is available only during registration' using errcode = '22023';
  end if;

  select * into existing_invite
  from public.referral_invites
  where invitee_user_id = current_user_id;

  if found then
    select * into matching_code
    from public.referral_codes
    where id = existing_invite.referral_code_id;

    if matching_code.code <> normalized_code then
      raise exception 'another referral is already bound' using errcode = '23505';
    end if;

    return jsonb_build_object(
      'bound', true,
      'status', existing_invite.status,
      'referrerRewardAmount', existing_invite.referrer_reward_amount,
      'inviteeRewardAmount', existing_invite.invitee_reward_amount
    );
  end if;

  if exists (
    select 1 from private.verified_balance_top_ups
    where user_id = current_user_id
  ) then
    raise exception 'referral cannot be bound after a top up' using errcode = '22023';
  end if;

  select * into matching_code
  from public.referral_codes
  where code = normalized_code;

  if not found then
    raise exception 'referral code not found' using errcode = 'P0002';
  end if;

  if matching_code.user_id = current_user_id then
    raise exception 'self referral is not allowed' using errcode = '22023';
  end if;

  insert into public.referral_invites (
    referral_code_id,
    referrer_user_id,
    invitee_user_id
  ) values (
    matching_code.id,
    matching_code.user_id,
    current_user_id
  )
  returning * into existing_invite;

  return jsonb_build_object(
    'bound', true,
    'status', existing_invite.status,
    'referrerRewardAmount', existing_invite.referrer_reward_amount,
    'inviteeRewardAmount', existing_invite.invitee_reward_amount
  );
end;
$$;

create or replace function public.admin_record_verified_top_up(
  p_user_id uuid,
  p_amount integer,
  p_provider_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_admin();
  normalized_reference text := lower(trim(coalesce(p_provider_reference, '')));
  existing_top_up private.verified_balance_top_ups%rowtype;
  referral public.referral_invites%rowtype;
  top_up_id uuid := gen_random_uuid();
  top_up_entry_id uuid;
  referrer_entry_id uuid;
  invitee_entry_id uuid;
  current_balance integer;
  invitee_balance integer;
  referrer_balance integer;
  first_top_up boolean;
  referral_rewarded boolean := false;
begin
  if p_amount is null or p_amount not between 1 and 1000000 then
    raise exception 'top up amount must be between 1 and 1000000' using errcode = '22023';
  end if;

  if char_length(normalized_reference) not between 6 and 160
    or normalized_reference !~ '^[a-z0-9][a-z0-9._:/-]*$' then
    raise exception 'invalid provider reference' using errcode = '22023';
  end if;

  select * into existing_top_up
  from private.verified_balance_top_ups
  where provider_reference = normalized_reference;

  if found then
    if existing_top_up.user_id <> p_user_id or existing_top_up.amount <> p_amount then
      raise exception 'provider reference conflict' using errcode = '23505';
    end if;

    select balance into current_balance
    from public.wallet_accounts
    where user_id = p_user_id;

    return jsonb_build_object(
      'applied', false,
      'amount', existing_top_up.amount,
      'balance', current_balance,
      'referralRewarded', exists (
        select 1 from public.referral_invites
        where qualifying_top_up_id = existing_top_up.id and status = 'rewarded'
      ),
      'referrerRewardAmount', 10,
      'inviteeRewardAmount', 5
    );
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'user not found' using errcode = 'P0002';
  end if;

  select balance into current_balance
  from public.wallet_accounts
  where user_id = p_user_id
  for update;

  if current_balance is null then
    raise exception 'wallet not found' using errcode = 'P0002';
  end if;

  first_top_up := not exists (
    select 1 from private.verified_balance_top_ups
    where user_id = p_user_id
  );

  update public.wallet_accounts
  set balance = current_balance + p_amount,
      updated_at = now()
  where user_id = p_user_id
  returning balance into invitee_balance;

  insert into public.wallet_entries (
    user_id,
    amount,
    kind,
    description,
    idempotency_key
  ) values (
    p_user_id,
    p_amount,
    'credit',
    'Пополнение баланса',
    'verified-top-up:' || md5(normalized_reference)
  )
  returning id into top_up_entry_id;

  insert into private.verified_balance_top_ups (
    id,
    user_id,
    actor_id,
    provider_reference,
    amount,
    wallet_entry_id,
    source
  ) values (
    top_up_id,
    p_user_id,
    actor_id,
    normalized_reference,
    p_amount,
    top_up_entry_id,
    'admin'
  );

  if first_top_up then
    select * into referral
    from public.referral_invites
    where invitee_user_id = p_user_id
      and status = 'pending'
    for update;

    if found then
      select balance into referrer_balance
      from public.wallet_accounts
      where user_id = referral.referrer_user_id
      for update;

      if referrer_balance is null then
        raise exception 'referrer wallet not found' using errcode = 'P0002';
      end if;

      update public.wallet_accounts
      set balance = balance + referral.referrer_reward_amount,
          updated_at = now()
      where user_id = referral.referrer_user_id
      returning balance into referrer_balance;

      insert into public.wallet_entries (
        user_id,
        amount,
        kind,
        description,
        idempotency_key
      ) values (
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
      where user_id = referral.invitee_user_id
      returning balance into invitee_balance;

      insert into public.wallet_entries (
        user_id,
        amount,
        kind,
        description,
        idempotency_key
      ) values (
        referral.invitee_user_id,
        referral.invitee_reward_amount,
        'credit',
        'Бонус за регистрацию по приглашению',
        'referral-invitee:' || referral.id::text
      )
      returning id into invitee_entry_id;

      update public.referral_invites
      set status = 'rewarded',
          qualifying_top_up_id = top_up_id,
          referrer_wallet_entry_id = referrer_entry_id,
          invitee_wallet_entry_id = invitee_entry_id,
          rewarded_at = now()
      where id = referral.id;

      referral_rewarded := true;
    end if;
  end if;

  insert into private.admin_audit_log (actor_id, target_user_id, event_type, payload)
  values (
    actor_id,
    p_user_id,
    'balance_adjusted',
    jsonb_build_object(
      'kind', 'verified_top_up',
      'amount', p_amount,
      'balanceAfter', invitee_balance,
      'providerReference', normalized_reference,
      'referralRewarded', referral_rewarded,
      'referrerRewardAmount', case when referral_rewarded then 10 else 0 end,
      'inviteeRewardAmount', case when referral_rewarded then 5 else 0 end
    )
  );

  return jsonb_build_object(
    'applied', true,
    'amount', p_amount,
    'balance', invitee_balance,
    'referralRewarded', referral_rewarded,
    'referrerRewardAmount', case when referral_rewarded then 10 else 0 end,
    'inviteeRewardAmount', case when referral_rewarded then 5 else 0 end,
    'referrerBalance', case when referral_rewarded then referrer_balance else null end
  );
end;
$$;

revoke all on function public.get_my_referral() from public, anon;
revoke all on function public.bind_my_referral(text) from public, anon;
revoke all on function public.admin_record_verified_top_up(uuid, integer, text) from public, anon;

grant execute on function public.get_my_referral() to authenticated;
grant execute on function public.bind_my_referral(text) to authenticated;
grant execute on function public.admin_record_verified_top_up(uuid, integer, text) to authenticated;

comment on table public.referral_codes is
  'One opaque referral code per user. Direct client access is denied; authenticated RPCs expose only the owner summary.';
comment on table public.referral_invites is
  'Registration-only referral bindings. Both rewards are issued once after the invitee first verified balance top-up.';
comment on table private.verified_balance_top_ups is
  'Owner- or provider-verified top-ups used as the only referral reward trigger.';
