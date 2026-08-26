create or replace function private.reject_banned_profile_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_account_not_banned(new.id);
  return new;
end;
$$;

create or replace function private.reject_banned_schedule_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_account_not_banned(new.user_id);
  return new;
end;
$$;

revoke all on function private.reject_banned_profile_update() from public, anon, authenticated;
revoke all on function private.reject_banned_schedule_mutation() from public, anon, authenticated;

drop trigger if exists profiles_reject_banned_update on public.profiles;
create trigger profiles_reject_banned_update
  before update on public.profiles
  for each row execute function private.reject_banned_profile_update();

drop trigger if exists user_schedules_reject_banned_mutation on public.user_schedules;
create trigger user_schedules_reject_banned_mutation
  before insert or update on public.user_schedules
  for each row execute function private.reject_banned_schedule_mutation();
