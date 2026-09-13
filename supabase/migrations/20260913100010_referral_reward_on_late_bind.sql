-- Приглашение, привязанное уже после подтверждения почты, тоже награждается.
--
-- Регистрация через Google не передаёт токен приглашения в метаданных, и
-- триггер on_auth_user_bind_referral его не находит. Приглашение привязывает
-- позже клиент (bind_my_referral), когда почта уже подтверждена, а оба
-- триггера награды из 20260913100000 к этому моменту уже отработали. Такое
-- приглашение висело бы в pending навсегда: пригласивший не получал 10 ₽, а
-- другу кошелёк обещал «+5 ₽ придут, как только подтвердишь почту».
--
-- Триггер на вставку приглашения закрывает любой такой путь.
-- private.reward_referral_signup сама ничего не делает, если у стороны нет
-- кошелька (при регистрации приглашение привязывается раньше, чем создан
-- кошелёк, - тогда награду выдаст триггер zz) и если приглашение уже не
-- pending, так что второй раз заплатить не может.

create or replace function private.reward_referral_after_bind()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if exists (
    select 1 from auth.users
    where id = new.invitee_user_id
      and email_confirmed_at is not null
  ) then
    perform private.reward_referral_signup(new.invitee_user_id);
  end if;
  return new;
end;
$function$;

revoke all on function private.reward_referral_after_bind() from public, anon, authenticated;

drop trigger if exists referral_invites_reward_confirmed on public.referral_invites;
create trigger referral_invites_reward_confirmed
after insert on public.referral_invites
for each row execute function private.reward_referral_after_bind();
