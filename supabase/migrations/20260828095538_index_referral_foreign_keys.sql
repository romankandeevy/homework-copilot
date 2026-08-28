create index referral_invites_referral_code_idx
  on public.referral_invites (referral_code_id);

create index verified_balance_top_ups_actor_idx
  on private.verified_balance_top_ups (actor_id)
  where actor_id is not null;
