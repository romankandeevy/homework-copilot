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
    for attempt_counter in 1..12 loop
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

      exit when own_code is not null or attempt_counter = 12;
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
