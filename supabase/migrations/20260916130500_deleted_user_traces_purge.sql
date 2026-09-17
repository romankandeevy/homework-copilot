-- Следы удалённого аккаунта с понятным сроком (аудит 16 сентября, В11).
--
-- Удаление аккаунта (delete_my_account, admin_delete_user) стирает профиль,
-- кошелёк, решения и чат каскадом от auth.users, но два места оставались
-- без срока или с долгим сроком:
-- - `private.admin_audit_log`, событие `user_deleted`: почта и телефон
--   удалённого ученика в payload навсегда - плановой уборки у журнала нет;
-- - `private.solution_logs`: условие задачи, запрос и ответ модели живут
--   90 дней и после удаления аккаунта (внешнего ключа на пользователя нет).
--
-- Сами функции удаления здесь не меняются: их правят отдельно (аудит, А3).
-- Уборка идёт ночным заданием и не зависит от пути удаления:
-- - в журнале через 90 дней после удаления из payload убираются почта и
--   телефон; остаются факт удаления, кто удалил, причина и число решений -
--   этого хватает, чтобы разобрать спор об удалённом аккаунте;
-- - в журнале решений у аккаунта, которого больше нет, стираются тексты
--   (условие, заметка, запрос, ответ, ошибка, замечания проверки). Числа -
--   предмет, модели, время, кредиты, себестоимость и цена - остаются:
--   по ним считаются качество и экономика, и человека по ним не узнать.
-- Сроки хранения в политике данных описывает её редакция, не эта миграция.

create or replace function private.purge_deleted_user_traces()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  scrubbed_audit integer;
  scrubbed_logs integer;
begin
  with scrubbed as (
    update private.admin_audit_log l
    set payload = (l.payload - 'email' - 'phone') || jsonb_build_object('personalDataRemoved', true)
    where l.event_type = 'user_deleted'
      and l.created_at < now() - interval '90 days'
      and (l.payload ? 'email' or l.payload ? 'phone')
    returning 1
  )
  select count(*)::integer into scrubbed_audit from scrubbed;

  with scrubbed as (
    update private.solution_logs s
    set task = '',
        condition = '',
        note = '',
        request = null,
        response = null,
        error = null,
        issues = '[]'::jsonb
    where s.user_id is not null
      and not exists (select 1 from auth.users u where u.id = s.user_id)
      and (s.task <> '' or s.condition <> '' or s.note <> '' or s.request is not null or s.response is not null or s.error is not null)
    returning 1
  )
  select count(*)::integer into scrubbed_logs from scrubbed;

  return jsonb_build_object('auditEntries', scrubbed_audit, 'solutionLogs', scrubbed_logs);
end;
$$;

revoke all on function private.purge_deleted_user_traces() from public, anon, authenticated;

select cron.unschedule('purge-deleted-user-traces')
where exists (select 1 from cron.job where jobname = 'purge-deleted-user-traces');

select cron.schedule(
  'purge-deleted-user-traces',
  '47 3 * * *',
  $job$ select private.purge_deleted_user_traces(); $job$
);
