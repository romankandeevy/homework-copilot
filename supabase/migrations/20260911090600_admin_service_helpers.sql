-- Служебная проверка для функции админки на Vercel: является ли аккаунт
-- администратором. Под администратором входить нельзя, а таблица ролей
-- лежит в private и через API не видна.

create or replace function public.is_admin_user(p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  return exists (select 1 from private.admin_users where user_id = p_user_id);
end;
$$;

revoke all on function public.is_admin_user(uuid) from public, anon, authenticated;
grant execute on function public.is_admin_user(uuid) to service_role;
