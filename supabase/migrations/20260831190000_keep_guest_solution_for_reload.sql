-- Готовое решение гостя переживает перезаход.
--
-- Решение ученика с аккаунтом лежит в базе, поэтому после перезагрузки оно
-- возвращается само. У гостя аккаунта нет, и решение существовало только
-- в ответе того запроса, который отправила вкладка. Перезагрузка страницы
-- на середине убивала вкладку вместе с ответом: очередь честно доходила до
-- «Решение готово», а открывать было нечего.
--
-- Теперь решение гостя хранится рядом с его бесплатной попыткой — по той же
-- метке браузера. Заодно повтор запроса с тем же ключом перестал заново
-- гонять модель: сначала смотрим, не решено ли уже.

create table if not exists private.guest_generated_solutions (
  guest_id uuid not null,
  idempotency_key text not null,
  solution jsonb not null,
  created_at timestamptz not null default now(),
  primary key (guest_id, idempotency_key),
  constraint guest_generated_solutions_key_length check (char_length(idempotency_key) between 8 and 160)
);

comment on table private.guest_generated_solutions is
  'Решение, выданное без аккаунта. Живёт неделю: дольше метка браузера всё равно не переживает.';

create index if not exists guest_generated_solutions_created_idx
  on private.guest_generated_solutions (created_at);

-- Пишет только решатель.
create or replace function public.store_guest_homework_solution(
  p_guest_id uuid,
  p_idempotency_key text,
  p_solution jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_guest_id is null or p_solution is null then
    return;
  end if;

  insert into private.guest_generated_solutions (guest_id, idempotency_key, solution)
  values (p_guest_id, p_idempotency_key, p_solution)
  on conflict (guest_id, idempotency_key) do update set solution = excluded.solution;

  delete from private.guest_generated_solutions
  where created_at < now() - interval '7 days';
end;
$$;

revoke all on function public.store_guest_homework_solution(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.store_guest_homework_solution(uuid, text, jsonb)
  to service_role;

-- Читает владелец метки. Метка — случайный UUID, известный только его
-- браузеру, и решение по ней отдаётся только вместе с ключом запроса.
create or replace function public.get_guest_homework_solution(
  p_guest_id uuid,
  p_idempotency_key text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select solution
  from private.guest_generated_solutions
  where guest_id = p_guest_id
    and idempotency_key = p_idempotency_key
  limit 1;
$$;

revoke all on function public.get_guest_homework_solution(uuid, text) from public;
grant execute on function public.get_guest_homework_solution(uuid, text) to anon, authenticated;
