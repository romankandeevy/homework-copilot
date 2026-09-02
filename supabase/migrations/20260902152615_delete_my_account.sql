-- Удаление аккаунта самим пользователем.
--
-- Политика данных обещает удаление по запросу, но единственным способом был
-- адрес почты, которого у домена нет: MX-записи не заведено, письма никуда
-- не доходили. Право на удаление было записано и недоступно.
--
-- Данные уходят каскадом от `auth.users`: профиль, кошелёк с историей,
-- расписание, личные решения и доступы к ним, диалоги чата с сообщениями,
-- очередь задач, обращения в поддержку, согласия, реферальный код и связи.
-- Мешают этому две таблицы со ссылками `on delete restrict` — их строки
-- снимаем заранее.
--
-- Файлы вложений живут в хранилище, а не в базе: их удаляет клиент своим
-- правом на свою папку до вызова этой функции. Строка `storage.objects`
-- без файла осталась бы висеть, поэтому порядок именно такой.

create or replace function public.delete_my_account()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  removed_solutions integer := 0;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  -- Владелец не может удалить себя из интерфейса ученика: вместе с ним
  -- пропадёт доступ к админке, а вернуть его будет неоткуда.
  if exists (select 1 from private.admin_users where user_id = current_user_id) then
    raise exception 'admin account cannot be deleted from the app' using errcode = 'P0001';
  end if;

  -- Ссылки `on delete restrict`: без этого удаление упало бы на внешнем ключе.
  delete from private.support_feature_credits
  where user_id = current_user_id or actor_id = current_user_id;

  delete from private.admin_audit_log where actor_id = current_user_id;

  -- Личные решения этого ученика. Каскад снял бы только доступы, а сам текст
  -- решения с условием задачи остался бы в общей таблице без владельца.
  with purged as (
    delete from public.homework_solutions
    where created_by = current_user_id
      and not exists (
        select 1 from public.homework_solution_access access
        where access.solution_id = public.homework_solutions.id
          and access.user_id <> current_user_id
      )
    returning 1
  )
  select count(*)::integer into removed_solutions from purged;

  delete from auth.users where id = current_user_id;

  return jsonb_build_object('deleted', true, 'solutions', removed_solutions);
end;
$$;

revoke all on function public.delete_my_account() from public, anon, authenticated;
grant execute on function public.delete_my_account() to authenticated;

comment on function public.delete_my_account() is
  'Удаление собственного аккаунта: снимает ссылки on delete restrict и удаляет строку auth.users, остальное уходит каскадом.';
