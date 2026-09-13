-- Удаление аккаунта из админки.
--
-- До 13 сентября удалить ученика мог только он сам (delete_my_account) или
-- владелец командой в базе: в админке кнопки не было, хотя политика данных
-- обещает удаление по запросу. Удаляет только роль owner (право `delete`
-- в get_admin_context), со вторым фактором - это проверяет require_admin.
--
-- Порядок тот же, что у delete_my_account: снимаем ссылки on delete
-- restrict, личные решения без чужих доступов, пишем журнал и удаляем
-- строку auth.users - остальное уходит каскадом. Файлы вложений чата живут
-- в хранилище: их убирает сервер админки (server/admin.ts) до вызова этой
-- функции, база их удалить не может.
--
-- Подтверждение: p_confirm должен совпасть с почтой аккаунта (без учёта
-- регистра и пробелов) или, у аккаунта без почты, с номером телефона
-- цифрами. Случайный вызов по чужому id ничего не удалит.
--
-- Переменная администратора названа admin_id, а не actor_id: в WHERE по
-- таблицам с колонкой actor_id plpgsql не отличил бы одно от другого.

create or replace function public.admin_delete_user(
  p_user_id uuid,
  p_confirm text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_id uuid := private.require_admin('owner');
  target_email text;
  target_phone text;
  expected text;
  given text;
  removed_solutions integer := 0;
begin
  if p_user_id is null then
    raise exception 'user required' using errcode = '22023';
  end if;

  if p_user_id = admin_id then
    raise exception 'cannot delete own account' using errcode = '22023';
  end if;

  if exists (select 1 from private.admin_users au where au.user_id = p_user_id) then
    raise exception 'admin account cannot be deleted' using errcode = '22023';
  end if;

  select nullif(lower(u.email), ''), nullif(u.phone, '') into target_email, target_phone
  from auth.users u
  where u.id = p_user_id
  for update;

  if not found then
    raise exception 'user not found' using errcode = 'P0002';
  end if;

  if target_email is not null then
    expected := target_email;
    given := regexp_replace(lower(coalesce(p_confirm, '')), '\s', '', 'g');
  else
    expected := regexp_replace(coalesce(target_phone, ''), '\D', '', 'g');
    given := regexp_replace(coalesce(p_confirm, ''), '\D', '', 'g');
  end if;

  if expected = '' or given <> expected then
    raise exception 'confirmation does not match' using errcode = '22023';
  end if;

  -- Ссылки `on delete restrict`: без этого удаление упало бы на внешнем ключе.
  delete from private.support_feature_credits sfc
  where sfc.user_id = p_user_id or sfc.actor_id = p_user_id;

  delete from private.admin_audit_log aal
  where aal.actor_id = p_user_id;

  -- Личные решения этого ученика: каскад снял бы только доступы, а текст
  -- решения с условием остался бы в общей таблице без владельца.
  with purged as (
    delete from public.homework_solutions hs
    where hs.created_by = p_user_id
      and not exists (
        select 1 from public.homework_solution_access access
        where access.solution_id = hs.id
          and access.user_id <> p_user_id
      )
    returning 1
  )
  select count(*)::integer into removed_solutions from purged;

  -- Журнал пишется до удаления: target_user_id станет null каскадом
  -- (on delete set null), а почта и номер останутся в payload.
  insert into private.admin_audit_log (actor_id, target_user_id, event_type, payload)
  values (
    admin_id,
    p_user_id,
    'user_deleted',
    jsonb_build_object(
      'email', target_email,
      'phone', target_phone,
      'reason', nullif(left(trim(coalesce(p_reason, '')), 300), ''),
      'solutions', removed_solutions
    )
  );

  delete from auth.users u where u.id = p_user_id;

  return jsonb_build_object('deleted', true, 'email', target_email, 'phone', target_phone, 'solutions', removed_solutions);
end;
$$;

revoke all on function public.admin_delete_user(uuid, text, text) from public, anon;
grant execute on function public.admin_delete_user(uuid, text, text) to authenticated;

comment on function public.admin_delete_user(uuid, text, text) is
  'Удаление аккаунта владельцем из админки: подтверждение почтой или номером, журнал, каскад от auth.users. Файлы чата убирает сервер админки до вызова.';
