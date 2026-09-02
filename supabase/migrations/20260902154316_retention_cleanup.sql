-- Уборка данных, у которых теперь есть заявленный срок.
--
-- Политика данных до этого говорила про «сроки, необходимые для безопасности
-- и обязательного учёта», то есть ни про что. Две таблицы при этом росли
-- бесконечно: события активности и строки очереди задач — их не удалял никто.
-- Сроки ниже и есть то, что теперь написано в политике.

create or replace function private.purge_expired_records()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed_events integer;
  removed_jobs integer;
  removed_guest_solutions integer;
  removed_guest_grants integer;
begin
  -- Событие активности нужно ради недавней картины: кто заходил, куда смотрел.
  -- Через три месяца это уже не картина, а балласт с адресами страниц.
  with purged as (
    delete from private.user_activity_events
    where created_at < now() - interval '90 days'
    returning 1
  )
  select count(*)::integer into removed_events from purged;

  -- Закрытая задача перестаёт показываться через двое суток; строка нужна
  -- ещё месяц на случай разбора спора об оплате, дальше — нет.
  with purged as (
    delete from public.homework_jobs
    where status in ('done', 'failed', 'canceled')
      and updated_at < now() - interval '30 days'
    returning 1
  )
  select count(*)::integer into removed_jobs from purged;

  -- Решение гостя живёт неделю: дольше метка браузера всё равно не переживает.
  -- Раньше уборка шла лениво, только при сохранении следующего решения.
  with purged as (
    delete from private.guest_generated_solutions
    where created_at < now() - interval '7 days'
    returning 1
  )
  select count(*)::integer into removed_guest_solutions from purged;

  -- Метка бесплатного решения вместе с хэшем адреса: полгода — предел, после
  -- которого ограничение уже ничего не защищает.
  with purged as (
    delete from private.guest_solution_grants
    where created_at < now() - interval '180 days'
    returning 1
  )
  select count(*)::integer into removed_guest_grants from purged;

  return jsonb_build_object(
    'activityEvents', removed_events,
    'jobs', removed_jobs,
    'guestSolutions', removed_guest_solutions,
    'guestGrants', removed_guest_grants
  );
end;
$$;

revoke all on function private.purge_expired_records() from public, anon, authenticated;

comment on function private.purge_expired_records() is
  'Ежедневная уборка: события активности 90 дней, закрытые задачи 30 дней, решения гостей 7 дней, метки бесплатного решения 180 дней.';
