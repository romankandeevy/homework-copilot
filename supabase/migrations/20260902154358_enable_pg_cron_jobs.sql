-- Расписание, которого не было.
--
-- Миграция чата (20260830170000) заводила уборку зависших генераций так:
-- «если установлено расширение pg_cron — запланировать». Расширение установлено
-- не было, условие не выполнялось, миграция проходила успешно — и задача просто
-- не создавалась. Проверка на проде 2 сентября: `pg_extension` без pg_cron,
-- `cron.job` не существует вовсе. То есть зависшая генерация чата не закрывалась
-- никем, а деньги за неё оставались зарезервированными до следующего запроса.
--
-- Здесь расширение включается явно, и обе задачи ставятся по-настоящему.
create extension if not exists pg_cron;

select cron.unschedule('reap-stale-chat-generations')
where exists (select 1 from cron.job where jobname = 'reap-stale-chat-generations');

select cron.schedule(
  'reap-stale-chat-generations',
  '*/5 * * * *',
  $job$ select private.reap_stale_chat_generations(); $job$
);

select cron.unschedule('purge-expired-records')
where exists (select 1 from cron.job where jobname = 'purge-expired-records');

select cron.schedule(
  'purge-expired-records',
  '17 3 * * *',
  $job$ select private.purge_expired_records(); $job$
);
