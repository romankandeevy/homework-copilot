-- Проверка перевода кошелька в копейки.
--
-- Запросы 1–4 выполняются ДО миграции, запросы 5–8 — ПОСЛЕ, результаты
-- сравниваются попарно. Смысл простой: у каждого пользователя реальный
-- баланс должен остаться прежним, изменяется только единица хранения.
--
-- Порядок: сохрани вывод «до» в файл, примени миграцию, сними «после»,
-- сверь. Расхождение хотя бы в одной строке — повод откатывать.

-- ---------------------------------------------------------------------------
-- ДО МИГРАЦИИ
-- ---------------------------------------------------------------------------

-- 1. Контрольные суммы по кошелькам.
select
  count(*) as accounts,
  sum(balance) as total_balance,
  min(balance) as min_balance,
  max(balance) as max_balance,
  count(*) filter (where balance < 0) as negative_accounts
from public.wallet_accounts;

-- 2. Контрольные суммы по операциям.
select
  count(*) as entries,
  sum(amount) as total_amount,
  sum(amount) filter (where kind = 'credit') as total_credit,
  sum(amount) filter (where kind = 'debit') as total_debit
from public.wallet_entries;

-- 3. Баланс сходится с историей операций. Строк быть не должно:
-- каждая строка — аккаунт, у которого баланс разошёлся с суммой операций.
select
  wa.user_id,
  wa.balance,
  coalesce(sum(we.amount), 0) as entries_sum
from public.wallet_accounts wa
left join public.wallet_entries we on we.user_id = wa.user_id
group by wa.user_id, wa.balance
having wa.balance <> coalesce(sum(we.amount), 0);

-- 4. Двадцать самых крупных балансов поимённо — их сверим построчно.
select user_id, balance
from public.wallet_accounts
order by balance desc, user_id
limit 20;

-- ---------------------------------------------------------------------------
-- ПОСЛЕ МИГРАЦИИ
-- ---------------------------------------------------------------------------

-- 5. Те же суммы, но в копейках. Должно выполняться:
--    accounts не изменилось, total_balance ровно в 100 раз больше.
select
  count(*) as accounts,
  sum(balance) as total_balance_kopecks,
  sum(balance) / 100.0 as total_balance_rubles,
  min(balance) as min_balance,
  max(balance) as max_balance,
  count(*) filter (where balance < 0) as negative_accounts
from public.wallet_accounts;

-- 6. То же по операциям.
select
  count(*) as entries,
  sum(amount) as total_amount_kopecks,
  sum(amount) / 100.0 as total_amount_rubles
from public.wallet_entries;

-- 7. Баланс по-прежнему сходится с историей. Строк быть не должно.
select
  wa.user_id,
  wa.balance,
  coalesce(sum(we.amount), 0) as entries_sum
from public.wallet_accounts wa
left join public.wallet_entries we on we.user_id = wa.user_id
group by wa.user_id, wa.balance
having wa.balance <> coalesce(sum(we.amount), 0);

-- 8. Те же двадцать аккаунтов: каждая сумма ровно в 100 раз больше.
select user_id, balance, balance / 100.0 as rubles
from public.wallet_accounts
order by balance desc, user_id
limit 20;

-- ---------------------------------------------------------------------------
-- ПРИЗНАК ПОВТОРНОГО ПРИМЕНЕНИЯ
-- ---------------------------------------------------------------------------

-- Миграция помечает факт применения; повторный запуск не должен умножить
-- суммы во второй раз. Проверяем, что отметка на месте ровно одна.
select *
from private.wallet_migration_marks
where migration = 'wallet_in_kopecks';

-- ---------------------------------------------------------------------------
-- ЖИВАЯ ПРОВЕРКА ЦЕН
-- ---------------------------------------------------------------------------

-- Цена решения должна вернуться в копейках: раньше 5/10/15, теперь 500/1000/1500.
select
  private.solution_task_price('geometry', 1) as early_task,
  private.solution_task_price('geometry', 30) as middle_task,
  private.solution_task_price('geometry', 55) as late_task;
