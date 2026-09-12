-- База решений в админке: выданные решения, а не только общий каталог.
--
-- Разбор 12 сентября. Раздел звал admin_list_solution_library, а она читает
-- только public.homework_solution_catalog. В каталог решение попадает лишь
-- из ветки «задача по номеру из проверенного учебника» в
-- complete_homework_solution, а проверенных задач в базе ноль
-- (verified_homework_tasks пуста). Все выданные решения - по фото и по
-- тексту: 31 строка в public.homework_solutions (22 текст, 9 фото, у каждой
-- доступ и списание), ещё 3 решения гостей в private.guest_generated_solutions.
-- Каталог пуст, функция без ошибки отдавала total = 0, и раздел писал
-- «Выданных решений пока нет».
--
-- Теперь раздел читает все три места, где лежит выданное решение:
--   public.homework_solutions            - решение ученика с аккаунтом (и
--                                          каталог, если оно туда попало);
--   private.user_generated_homework_solutions - личное решение задачи по
--                                          номеру, которой нет в каталоге;
--   private.guest_generated_solutions    - решение гостя.
-- Только чтение: решение уже у ученика, и правка задним числом поменяла бы
-- то, за что он заплатил. Старую admin_list_solution_library не трогаем.

create or replace view private.admin_issued_solutions as
  select
    solution.id::text as id,
    case when catalog.solution_id is not null then 'catalog' else 'personal' end as kind,
    solution.source,
    solution.subject,
    solution.task,
    solution.textbook_id,
    solution.textbook_title,
    coalesce(solution.solution ->> 'condition', '') as condition,
    coalesce(solution.solution ->> 'answer', '') as answer,
    solution.solution as payload,
    solution.created_by as user_id,
    null::uuid as guest_id,
    (
      select access.idempotency_key
      from public.homework_solution_access as access
      where access.solution_id = solution.id
      order by (access.user_id = solution.created_by) desc, access.purchased_at
      limit 1
    ) as idempotency_key,
    (
      select count(*)
      from public.homework_solution_access as access
      where access.solution_id = solution.id
    ) as access_count,
    solution.created_at
  from public.homework_solutions as solution
  left join public.homework_solution_catalog as catalog on catalog.solution_id = solution.id

  union all

  select
    'number:' || personal.user_id::text || ':' || personal.idempotency_key,
    'personal',
    'number',
    coalesce(personal.solution ->> 'subject', ''),
    personal.task,
    personal.textbook_id,
    coalesce(personal.solution ->> 'textbookTitle', ''),
    coalesce(personal.solution ->> 'condition', ''),
    coalesce(personal.solution ->> 'answer', ''),
    personal.solution,
    personal.user_id,
    null::uuid,
    personal.idempotency_key,
    1::bigint,
    personal.created_at
  from private.user_generated_homework_solutions as personal

  union all

  select
    'guest:' || guest.guest_id::text || ':' || guest.idempotency_key,
    'guest',
    coalesce(guest.solution ->> 'source', ''),
    coalesce(guest.solution ->> 'subject', ''),
    coalesce(guest.solution ->> 'task', ''),
    coalesce(guest.solution ->> 'textbookId', ''),
    coalesce(guest.solution ->> 'textbookTitle', ''),
    coalesce(guest.solution ->> 'condition', ''),
    coalesce(guest.solution ->> 'answer', ''),
    guest.solution,
    null::uuid,
    guest.guest_id,
    guest.idempotency_key,
    1::bigint,
    guest.created_at
  from private.guest_generated_solutions as guest;

revoke all on private.admin_issued_solutions from public, anon, authenticated;

comment on view private.admin_issued_solutions is
  'Все выданные решения для админки: ученики с аккаунтом, личные решения по номеру и гости.';

-- Отметка проверки, которую решатель записал в само решение.
create or replace function private.admin_solution_status(p_payload jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_payload #>> '{quality,reviewPassed}'
    when 'true' then 'passed'
    when 'false' then 'failed'
    else 'unknown'
  end;
$$;

revoke all on function private.admin_solution_status(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Список с фильтрами, цифрами сверху и вариантами фильтров из самих данных
-- ---------------------------------------------------------------------------

create or replace function public.admin_solutions_v2(
  p_search text default '',
  p_subject text default null,
  p_source text default null,
  p_status text default null,
  p_kind text default null,
  p_from date default null,
  p_to date default null,
  p_page integer default 1,
  p_page_size integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_search text := left(trim(coalesce(p_search, '')), 200);
  pattern text;
  safe_page integer := greatest(1, coalesce(p_page, 1));
  safe_size integer := greatest(1, least(coalesce(p_page_size, 50), 100));
  today date := private.msk_day(now());
  result jsonb;
begin
  perform private.require_admin('admin');

  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'period start is after period end' using errcode = '22023';
  end if;

  pattern := '%' || replace(replace(replace(normalized_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  with base as (
    select issued.*, private.admin_solution_status(issued.payload) as status
    from private.admin_issued_solutions as issued
  ),
  filtered as (
    select base.*, account.email::text as email
    from base
    left join auth.users as account on account.id = base.user_id
    where (nullif(p_subject, '') is null or base.subject = p_subject)
      and (nullif(p_source, '') is null or base.source = p_source)
      and (nullif(p_status, '') is null or base.status = p_status)
      and (nullif(p_kind, '') is null or base.kind = p_kind)
      and (p_from is null or private.msk_day(base.created_at) >= p_from)
      and (p_to is null or private.msk_day(base.created_at) <= p_to)
      and (
        normalized_search = ''
        or base.condition ilike pattern
        or base.answer ilike pattern
        or base.task ilike pattern
        or base.subject ilike pattern
        or base.textbook_title ilike pattern
        or coalesce(account.email::text, '') ilike pattern
      )
  ),
  paged as (
    select *
    from filtered
    order by created_at desc, id
    limit safe_size
    offset (safe_page - 1) * safe_size
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'page', safe_page,
    'pageSize', safe_size,
    'stats', (
      select jsonb_build_object(
        'total', count(*),
        'today', count(*) filter (where private.msk_day(created_at) = today),
        'week', count(*) filter (where private.msk_day(created_at) > today - 7),
        'catalog', count(*) filter (where kind = 'catalog'),
        'personal', count(*) filter (where kind = 'personal'),
        'guest', count(*) filter (where kind = 'guest'),
        'firstAt', min(created_at),
        'lastAt', max(created_at),
        'verifiedTasks', (select count(*) from public.verified_homework_tasks),
        'costsSince', (select min(created_at) from private.solution_costs)
      )
      from base
    ),
    'facets', jsonb_build_object(
      'subjects', (
        select coalesce(jsonb_agg(jsonb_build_object('value', subject, 'count', amount) order by amount desc, subject), '[]'::jsonb)
        from (select subject, count(*) as amount from base where subject <> '' group by subject) as grouped
      ),
      'sources', (
        select coalesce(jsonb_agg(jsonb_build_object('value', source, 'count', amount) order by amount desc, source), '[]'::jsonb)
        from (select source, count(*) as amount from base where source <> '' group by source) as grouped
      ),
      'statuses', (
        select coalesce(jsonb_agg(jsonb_build_object('value', status, 'count', amount) order by amount desc, status), '[]'::jsonb)
        from (select status, count(*) as amount from base group by status) as grouped
      ),
      'kinds', (
        select coalesce(jsonb_agg(jsonb_build_object('value', kind, 'count', amount) order by amount desc, kind), '[]'::jsonb)
        from (select kind, count(*) as amount from base group by kind) as grouped
      )
    ),
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', paged.id,
          'kind', paged.kind,
          'source', paged.source,
          'subject', paged.subject,
          'task', case when paged.source = 'number' then paged.task end,
          'textbookTitle', paged.textbook_title,
          'condition', left(paged.condition, 280),
          'answer', left(paged.answer, 200),
          'userId', paged.user_id,
          'email', paged.email,
          'accessCount', paged.access_count,
          'status', paged.status,
          'failedChecks', (
            select count(*)
            from jsonb_array_elements(
              case when jsonb_typeof(paged.payload #> '{verification,checks}') = 'array'
                then paged.payload #> '{verification,checks}' else '[]'::jsonb end
            ) as check_item
            where check_item ->> 'passed' = 'false'
          ),
          'priceKopecks', (
            select -entry.amount
            from public.wallet_entries as entry
            where entry.user_id = paged.user_id
              and entry.idempotency_key = paged.idempotency_key
              and entry.kind = 'debit'
            order by entry.created_at
            limit 1
          ),
          'costKopecks', (
            select cost.cost_kopecks
            from private.solution_costs as cost
            where cost.idempotency_key = paged.idempotency_key
            order by (cost.outcome = 'solved') desc, cost.created_at desc
            limit 1
          ),
          'createdAt', paged.created_at
        )
        order by paged.created_at desc, paged.id
      )
      from paged
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Полное решение: запись целиком, кому выдано, деньги, себестоимость, очередь
-- ---------------------------------------------------------------------------

create or replace function public.admin_solution_detail_v2(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  issued record;
  rating_key text;
begin
  perform private.require_admin('admin');

  select * into issued
  from private.admin_issued_solutions
  where id = left(coalesce(p_id, ''), 400);

  if not found then
    raise exception 'solution not found' using errcode = 'P0002';
  end if;

  rating_key := coalesce(issued.payload ->> 'textbookId', issued.textbook_id) || ':' || coalesce(issued.payload ->> 'task', issued.task);

  return jsonb_build_object(
    'id', issued.id,
    'kind', issued.kind,
    'source', issued.source,
    'subject', issued.subject,
    'task', case when issued.source = 'number' then issued.task end,
    'textbookTitle', issued.textbook_title,
    'textbookEdition', coalesce(issued.payload ->> 'textbookEdition', ''),
    'createdAt', issued.created_at,
    'userId', issued.user_id,
    'email', (select account.email::text from auth.users as account where account.id = issued.user_id),
    'guest', issued.guest_id is not null,
    'status', private.admin_solution_status(issued.payload),
    'engineVersion', case when coalesce(issued.payload ->> 'engineVersion', '') ~ '^[0-9]+$' then (issued.payload ->> 'engineVersion')::integer end,
    -- Подпись сервера нужна только базе при записи: наружу её не отдаём.
    'solution', issued.payload - '_serverProof',
    'accesses', coalesce((
      select jsonb_agg(jsonb_build_object('userId', access.user_id, 'email', account.email::text, 'at', access.purchased_at) order by access.purchased_at)
      from public.homework_solution_access as access
      left join auth.users as account on account.id = access.user_id
      where access.solution_id::text = issued.id
    ), '[]'::jsonb),
    'wallet', coalesce((
      select jsonb_agg(jsonb_build_object('amount', entry.amount, 'kind', entry.kind, 'description', entry.description, 'at', entry.created_at) order by entry.created_at)
      from public.wallet_entries as entry
      where issued.user_id is not null
        and entry.user_id = issued.user_id
        and entry.idempotency_key in (issued.idempotency_key, issued.idempotency_key || ':refund')
    ), '[]'::jsonb),
    'cost', (
      select jsonb_build_object(
        'models', cost.models,
        'calls', cost.calls,
        'credits', cost.credits,
        'costKopecks', cost.cost_kopecks,
        'priceKopecks', cost.price_kopecks,
        'seconds', cost.seconds,
        'outcome', cost.outcome,
        'at', cost.created_at
      )
      from private.solution_costs as cost
      where cost.idempotency_key = issued.idempotency_key
      order by (cost.outcome = 'solved') desc, cost.created_at desc
      limit 1
    ),
    'job', (
      select jsonb_build_object(
        'status', job.status,
        'stage', job.stage,
        'grade', job.grade,
        'createdAt', job.created_at,
        'finishedAt', job.finished_at
      )
      from public.homework_jobs as job
      where job.idempotency_key = issued.idempotency_key
        and (job.user_id = issued.user_id or job.guest_id = issued.guest_id)
      order by job.created_at desc
      limit 1
    ),
    'ratings', (
      select jsonb_build_object(
        'helpful', count(*) filter (where rating.helpful),
        'unhelpful', count(*) filter (where not rating.helpful),
        'comments', coalesce(jsonb_agg(jsonb_build_object('helpful', rating.helpful, 'comment', rating.comment, 'at', rating.created_at) order by rating.created_at desc) filter (where rating.comment is not null), '[]'::jsonb)
      )
      from private.solution_ratings as rating
      where rating.solution_key = rating_key
    )
  );
end;
$$;

revoke all on function public.admin_solutions_v2(text, text, text, text, text, date, date, integer, integer) from public, anon;
revoke all on function public.admin_solution_detail_v2(text) from public, anon;
grant execute on function public.admin_solutions_v2(text, text, text, text, text, date, date, integer, integer) to authenticated;
grant execute on function public.admin_solution_detail_v2(text) to authenticated;

comment on function public.admin_solutions_v2(text, text, text, text, text, date, date, integer, integer) is
  'Админка, база решений: все выданные решения с фильтрами, цифрами и вариантами фильтров из данных. Роль admin и выше.';
comment on function public.admin_solution_detail_v2(text) is
  'Админка, база решений: полное решение, кому выдано, списание, себестоимость, очередь и оценки. Только чтение. Роль admin и выше.';
