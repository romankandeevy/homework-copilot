-- Счётчики для меню админки: сколько обращений ждут ответа и просрочены,
-- сколько флагов фрода и ошибок не разобрано, кто онлайн. Один лёгкий
-- запрос вместо дашборда при каждом событии Realtime.

create or replace function public.admin_signal_counts()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  role_name text;
  sla integer := private.setting_int('support_sla_minutes', 30);
begin
  perform private.require_admin('support');
  role_name := private.current_admin_role();
  return jsonb_build_object(
    'pendingTickets', (select count(*) from public.support_conversations where status = 'pending_owner'),
    'overdueTickets', (select count(*) from public.support_conversations
      where status = 'pending_owner' and last_user_message_at < now() - make_interval(mins => sla)),
    'openFlags', case when private.admin_role_rank(role_name) >= 2 then (select count(*) from private.fraud_flags where status = 'open') else 0 end,
    'openErrors', case when private.admin_role_rank(role_name) >= 2 then (select count(*) from private.error_groups where status = 'new') else 0 end,
    'online', (select count(*) from public.profiles where last_seen_at > now() - interval '10 minutes')
  );
end;
$$;

revoke all on function public.admin_signal_counts() from public, anon;
grant execute on function public.admin_signal_counts() to authenticated;
