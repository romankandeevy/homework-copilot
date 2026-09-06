-- Во что нам обходится решение.
--
-- Цена в 5 ₽ выведена из ручного замера 30 августа: 18 копеек за выданный
-- разбор. Замер был на другом пуле и на восьми задачах, с тех пор сменилось
-- и устройство прохода, и модели. 6 сентября выяснилось, чего стоит такая
-- слепота: один вызов gpt-5-6-sol на трудной комбинаторике обошёлся в 6,10
-- кредита - 3 ₽ из пяти, и это без починки.
--
-- Логи Vercel живут считаные дни, а цену пересматривают по неделям
-- наблюдений, поэтому расход пишется сюда. Таблица служебная: ученику она
-- не видна, пишет в неё только сервер под service_role.

create table if not exists private.solution_costs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  subject text not null,
  source text not null,
  -- Какими моделями и сколько раз: «gemini-3-6-flash-openai×2».
  models text not null,
  calls integer not null,
  -- Кредиты шлюза. null - шлюз не сообщил расход, выдумывать ноль нельзя.
  credits numeric(10,4),
  cost_kopecks integer,
  price_kopecks integer not null,
  seconds numeric(8,2) not null,
  outcome text not null
);

create index if not exists solution_costs_created_at_idx
  on private.solution_costs (created_at desc);

create or replace function public.record_solution_cost(
  p_subject text,
  p_source text,
  p_models text,
  p_calls integer,
  p_credits numeric,
  p_cost_kopecks integer,
  p_price_kopecks integer,
  p_seconds numeric,
  p_outcome text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_outcome not in ('solved', 'failed') then
    raise exception 'unknown solve outcome' using errcode = '22023';
  end if;

  insert into private.solution_costs (
    subject, source, models, calls, credits, cost_kopecks, price_kopecks, seconds, outcome
  )
  values (
    left(coalesce(p_subject, ''), 150),
    left(coalesce(p_source, ''), 20),
    left(coalesce(p_models, ''), 200),
    greatest(coalesce(p_calls, 0), 0),
    p_credits,
    p_cost_kopecks,
    coalesce(p_price_kopecks, 0),
    coalesce(p_seconds, 0),
    p_outcome
  );
end;
$function$;

revoke all on function public.record_solution_cost(text, text, text, integer, numeric, integer, integer, numeric, text)
  from public, anon, authenticated;
grant execute on function public.record_solution_cost(text, text, text, integer, numeric, integer, integer, numeric, text)
  to service_role;
