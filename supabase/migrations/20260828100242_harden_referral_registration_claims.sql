create table private.referral_registration_claims (
  token uuid primary key default gen_random_uuid(),
  referral_code_id uuid not null references public.referral_codes(id) on delete cascade,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  constraint referral_registration_claims_expiry check (expires_at > issued_at)
);

create index referral_registration_claims_code_idx
  on private.referral_registration_claims (referral_code_id);
create index referral_registration_claims_expiry_idx
  on private.referral_registration_claims (expires_at);

alter table private.referral_registration_claims enable row level security;
revoke all on private.referral_registration_claims from public, anon, authenticated;

create or replace function public.begin_referral_registration(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_code text := upper(trim(coalesce(p_code, '')));
  referral_code_id uuid;
  claim_token uuid;
  claim_expires_at timestamptz;
begin
  if normalized_code !~ '^[A-Z0-9]{10}$' then
    raise exception 'invalid referral code' using errcode = '22023';
  end if;

  select id into referral_code_id
  from public.referral_codes
  where code = normalized_code;

  if referral_code_id is null then
    raise exception 'referral code not found' using errcode = 'P0002';
  end if;

  delete from private.referral_registration_claims
  where expires_at < now() - interval '1 day';

  insert into private.referral_registration_claims (referral_code_id)
  values (referral_code_id)
  returning token, expires_at into claim_token, claim_expires_at;

  return jsonb_build_object(
    'claimToken', claim_token::text,
    'expiresAt', claim_expires_at
  );
end;
$$;

create or replace function private.bind_referral_from_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  raw_token text := lower(trim(coalesce(new.raw_user_meta_data ->> 'referral_claim_token', '')));
  claim_token uuid;
  claim_issued_at timestamptz;
  claim_expires_at timestamptz;
  matching_code_id uuid;
  referrer_user_id uuid;
begin
  if raw_token !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or new.created_at is null then
    return new;
  end if;

  claim_token := raw_token::uuid;

  select claim.issued_at, claim.expires_at, code.id, code.user_id
  into claim_issued_at, claim_expires_at, matching_code_id, referrer_user_id
  from private.referral_registration_claims claim
  join public.referral_codes code on code.id = claim.referral_code_id
  where claim.token = claim_token
  for update of claim;

  if not found
    or claim_issued_at > new.created_at
    or claim_expires_at < new.created_at
    or referrer_user_id = new.id then
    return new;
  end if;

  insert into public.referral_invites (
    referral_code_id,
    referrer_user_id,
    invitee_user_id
  ) values (
    matching_code_id,
    referrer_user_id,
    new.id
  )
  on conflict (invitee_user_id) do nothing;

  delete from private.referral_registration_claims
  where token = claim_token;

  return new;
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
  raw_token text := lower(trim(coalesce(p_code, '')));
  claim_token uuid;
  claim_issued_at timestamptz;
  claim_expires_at timestamptz;
  account_created_at timestamptz;
  matching_code_id uuid;
  referrer_user_id uuid;
  existing_invite public.referral_invites%rowtype;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  perform private.assert_account_not_banned(current_user_id);

  select * into existing_invite
  from public.referral_invites
  where invitee_user_id = current_user_id;

  if found then
    return jsonb_build_object(
      'bound', true,
      'status', existing_invite.status,
      'referrerRewardAmount', existing_invite.referrer_reward_amount,
      'inviteeRewardAmount', existing_invite.invitee_reward_amount
    );
  end if;

  if raw_token !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'invalid referral claim' using errcode = '22023';
  end if;

  claim_token := raw_token::uuid;

  select created_at into account_created_at
  from auth.users
  where id = current_user_id;

  select claim.issued_at, claim.expires_at, code.id, code.user_id
  into claim_issued_at, claim_expires_at, matching_code_id, referrer_user_id
  from private.referral_registration_claims claim
  join public.referral_codes code on code.id = claim.referral_code_id
  where claim.token = claim_token
  for update of claim;

  if not found then
    raise exception 'referral claim not found' using errcode = 'P0002';
  end if;

  if account_created_at is null
    or claim_issued_at > account_created_at
    or claim_expires_at < now() then
    raise exception 'referral is available only during registration' using errcode = '22023';
  end if;

  if exists (
    select 1 from private.verified_balance_top_ups
    where user_id = current_user_id
  ) then
    raise exception 'referral cannot be bound after a top up' using errcode = '22023';
  end if;

  if referrer_user_id = current_user_id then
    raise exception 'self referral is not allowed' using errcode = '22023';
  end if;

  insert into public.referral_invites (
    referral_code_id,
    referrer_user_id,
    invitee_user_id
  ) values (
    matching_code_id,
    referrer_user_id,
    current_user_id
  )
  returning * into existing_invite;

  delete from private.referral_registration_claims
  where token = claim_token;

  return jsonb_build_object(
    'bound', true,
    'status', existing_invite.status,
    'referrerRewardAmount', existing_invite.referrer_reward_amount,
    'inviteeRewardAmount', existing_invite.invitee_reward_amount
  );
end;
$$;

revoke all on function public.begin_referral_registration(text) from public;
revoke all on function public.bind_my_referral(text) from public, anon;
revoke all on function private.bind_referral_from_new_user() from public, anon, authenticated;

grant execute on function public.begin_referral_registration(text) to anon, authenticated;
grant execute on function public.bind_my_referral(text) to authenticated;

comment on table private.referral_registration_claims is
  'Single-use claims issued before account creation. They prevent existing accounts from attaching a referral after registration.';
