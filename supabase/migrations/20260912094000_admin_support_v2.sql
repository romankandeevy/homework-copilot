-- Поддержка v2: метки, фильтр по дате и по просрочке, массовые действия,
-- статистика и история обращений ученика.
--
-- 1. Метки (tags) - классификация агента. Тип обращения (category) выбирает
--    ученик, и от него зависит логика (идея - начисление), поэтому его не
--    трогаем, а метки ставит и меняет поддержка. Словарь закрытый: у каждой
--    метки свой цвет в интерфейсе (зеркало - SUPPORT_TAGS в
--    src/admin/sections/supportModel.ts). Новое обращение получает метку по
--    типу, старые размечены тем же правилом.
-- 2. admin_support_inbox: период по дате создания (день/неделя/месяц/всё),
--    метка, «только просроченные по SLA» и общие счётчики - просрочка
--    считается по всей базе, а не по странице списка. Прежние именованные
--    аргументы работают как раньше.
-- 3. admin_support_bulk_update - закрыть, открыть, переназначить и сменить
--    метки у одного или нескольких обращений одним вызовом, каждое
--    изменение - строка в журнале действий.
-- 4. admin_support_stats - обращений в день, первый ответ, доля решённых,
--    просрочки SLA; всё считается в базе, день - по Москве.
-- 5. admin_support_thread отдаёт прошлые обращения этого ученика.

-- ---------------------------------------------------------------------------
-- 1. Метки
-- ---------------------------------------------------------------------------

alter table public.support_conversations
  add column if not exists tags text[] not null default '{}'::text[];

create or replace function private.support_known_tags()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['bug', 'payment', 'question', 'solution', 'refund', 'account', 'idea']::text[];
$$;

revoke all on function private.support_known_tags() from public, anon, authenticated;

alter table public.support_conversations drop constraint if exists support_conversations_tags_known;
alter table public.support_conversations
  add constraint support_conversations_tags_known check (
    tags <@ array['bug', 'payment', 'question', 'solution', 'refund', 'account', 'idea']::text[]
    and cardinality(tags) <= 7
  );

create or replace function private.support_default_tags(p_category text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_category
    when 'payment' then array['payment']::text[]
    when 'feature' then array['idea']::text[]
    when 'wrong_solution' then array['solution']::text[]
    else array['question']::text[]
  end;
$$;

revoke all on function private.support_default_tags(text) from public, anon, authenticated;

create or replace function private.support_conversation_default_tags()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(cardinality(new.tags), 0) = 0 then
    new.tags := private.support_default_tags(new.category);
  end if;
  return new;
end;
$$;

revoke all on function private.support_conversation_default_tags() from public, anon, authenticated;

drop trigger if exists support_conversations_default_tags on public.support_conversations;
create trigger support_conversations_default_tags
  before insert on public.support_conversations
  for each row execute function private.support_conversation_default_tags();

update public.support_conversations
set tags = private.support_default_tags(category)
where cardinality(tags) = 0;

create index if not exists support_conversations_created_idx
  on public.support_conversations (created_at desc);

-- ---------------------------------------------------------------------------
-- 2. Период по Москве
-- ---------------------------------------------------------------------------

create or replace function private.support_period_start(p_period text)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case p_period
    when 'day' then date_trunc('day', now() at time zone 'Europe/Moscow') at time zone 'Europe/Moscow'
    when 'week' then (date_trunc('day', now() at time zone 'Europe/Moscow') - interval '6 days') at time zone 'Europe/Moscow'
    when 'month' then (date_trunc('day', now() at time zone 'Europe/Moscow') - interval '29 days') at time zone 'Europe/Moscow'
  end;
$$;

revoke all on function private.support_period_start(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Входящие
-- ---------------------------------------------------------------------------

drop function if exists public.admin_support_inbox(text, text, text, text, integer, integer);

create or replace function public.admin_support_inbox(
  p_status text default null,
  p_assignee text default null,
  p_priority text default null,
  p_search text default '',
  p_page integer default 1,
  p_page_size integer default 50,
  p_period text default 'all',
  p_tag text default null,
  p_overdue boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin('support');
  sla integer := private.setting_int('support_sla_minutes', 30);
  safe_size integer := greatest(1, least(coalesce(p_page_size, 50), 200));
  safe_page integer := greatest(1, coalesce(p_page, 1));
  search text := trim(coalesce(p_search, ''));
  since timestamptz;
  total integer;
  items jsonb;
begin
  if coalesce(p_period, 'all') not in ('day', 'week', 'month', 'all') then
    raise exception 'invalid support period' using errcode = '22023';
  end if;
  if p_tag is not null and not (p_tag = any(private.support_known_tags())) then
    raise exception 'unknown support tag' using errcode = '22023';
  end if;
  since := private.support_period_start(coalesce(p_period, 'all'));

  with filtered as (
    select c.*
    from public.support_conversations c
    join auth.users u on u.id = c.user_id
    left join public.profiles p on p.id = c.user_id
    where (p_status is null or p_status = 'all'
        or (p_status = 'open' and c.status <> 'resolved')
        or c.status = p_status)
      and (p_assignee is null or (p_assignee = 'me' and c.assigned_to = actor) or (p_assignee = 'none' and c.assigned_to is null) or c.assigned_to::text = p_assignee)
      and (p_priority is null or c.priority = p_priority)
      and (p_tag is null or p_tag = any(c.tags))
      and (since is null or c.created_at >= since)
      and (not coalesce(p_overdue, false)
        or (c.status = 'pending_owner' and c.last_user_message_at < now() - make_interval(mins => sla)))
      and (search = '' or u.email ilike '%' || search || '%' or p.full_name ilike '%' || search || '%' or c.subject ilike '%' || search || '%')
  ),
  page as (
    select f.*
    from filtered f
    order by case f.priority when 'urgent' then 4 when 'high' then 3 when 'normal' then 2 else 1 end desc,
             (f.status = 'pending_owner') desc, f.updated_at desc
    limit safe_size offset (safe_page - 1) * safe_size
  )
  select
    (select count(*) from filtered),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'userId', c.user_id, 'email', u.email, 'fullName', p.full_name,
        'category', c.category, 'subject', c.subject, 'status', c.status, 'priority', c.priority,
        'tags', to_jsonb(c.tags),
        'assignedTo', c.assigned_to, 'assignedEmail', au.email,
        'createdAt', c.created_at, 'updatedAt', c.updated_at, 'lastMessageAt', c.last_message_at,
        'lastUserMessageAt', c.last_user_message_at, 'firstResponseAt', c.first_response_at,
        'resolvedAt', c.resolved_at,
        'ownerLastReadAt', c.owner_last_read_at,
        'rating', c.rating,
        'lastMessage', (select m.body from public.support_messages m where m.conversation_id = c.id order by m.created_at desc limit 1),
        'lastAuthor', (select m.author_type from public.support_messages m where m.conversation_id = c.id order by m.created_at desc limit 1),
        'unread', (select count(*) from public.support_messages m where m.conversation_id = c.id and m.author_type = 'user' and m.created_at > coalesce(c.owner_last_read_at, '-infinity'::timestamptz)),
        'waitingMinutes', case when c.status = 'pending_owner' and c.last_user_message_at is not null
          then floor(extract(epoch from (now() - c.last_user_message_at)) / 60)::integer end,
        'slaBreached', c.status = 'pending_owner' and c.last_user_message_at < now() - make_interval(mins => sla)
      ) order by case c.priority when 'urgent' then 4 when 'high' then 3 when 'normal' then 2 else 1 end desc,
               (c.status = 'pending_owner') desc, c.updated_at desc)
      from page c
      join auth.users u on u.id = c.user_id
      left join public.profiles p on p.id = c.user_id
      left join auth.users au on au.id = c.assigned_to
    ), '[]'::jsonb)
  into total, items;

  return jsonb_build_object(
    'total', total,
    'page', safe_page,
    'pageSize', safe_size,
    'slaMinutes', sla,
    'period', coalesce(p_period, 'all'),
    'since', since,
    'agents', (
      select coalesce(jsonb_agg(jsonb_build_object('id', a.user_id, 'email', u.email, 'role', a.role) order by u.email), '[]'::jsonb)
      from private.admin_users a join auth.users u on u.id = a.user_id
    ),
    -- Счётчики по всей базе, без фильтров списка: тревога SLA не должна
    -- зависеть от того, какая страница открыта.
    'counts', (
      select jsonb_build_object(
        'open', count(*) filter (where c.status <> 'resolved'),
        'pendingOwner', count(*) filter (where c.status = 'pending_owner'),
        'overdue', count(*) filter (where c.status = 'pending_owner' and c.last_user_message_at < now() - make_interval(mins => sla)),
        'unassigned', count(*) filter (where c.status <> 'resolved' and c.assigned_to is null),
        'mine', count(*) filter (where c.status <> 'resolved' and c.assigned_to = actor)
      )
      from public.support_conversations c
    ),
    'items', items
  );
end;
$$;

revoke all on function public.admin_support_inbox(text, text, text, text, integer, integer, text, text, boolean) from public, anon;
grant execute on function public.admin_support_inbox(text, text, text, text, integer, integer, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Массовые действия
-- ---------------------------------------------------------------------------

create or replace function public.admin_support_bulk_update(
  p_conversation_ids uuid[],
  p_status text default null,
  p_assigned_to uuid default null,
  p_unassign boolean default false,
  p_add_tags text[] default null,
  p_remove_tags text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin('support');
  ids uuid[];
  add_tags text[] := coalesce(p_add_tags, '{}'::text[]);
  remove_tags text[] := coalesce(p_remove_tags, '{}'::text[]);
  before_row public.support_conversations%rowtype;
  next_status text;
  next_assignee uuid;
  next_tags text[];
  changed_ids uuid[] := '{}'::uuid[];
begin
  select coalesce(array_agg(distinct id), '{}'::uuid[]) into ids
  from unnest(coalesce(p_conversation_ids, '{}'::uuid[])) id
  where id is not null;
  if cardinality(ids) not between 1 and 200 then
    raise exception 'select 1 to 200 conversations' using errcode = '22023';
  end if;
  if p_status is not null and p_status not in ('pending_owner', 'pending_user', 'resolved') then
    raise exception 'invalid support status' using errcode = '22023';
  end if;
  if p_assigned_to is not null and not exists (select 1 from private.admin_users where user_id = p_assigned_to) then
    raise exception 'assignee is not an administrator' using errcode = '22023';
  end if;
  if not (add_tags <@ private.support_known_tags() and remove_tags <@ private.support_known_tags()) then
    raise exception 'unknown support tag' using errcode = '22023';
  end if;
  if p_status is null and p_assigned_to is null and not coalesce(p_unassign, false)
    and cardinality(add_tags) = 0 and cardinality(remove_tags) = 0 then
    raise exception 'nothing to change' using errcode = '22023';
  end if;

  for before_row in
    select * from public.support_conversations where id = any(ids) order by id for update
  loop
    next_status := coalesce(p_status, before_row.status);
    next_assignee := case when coalesce(p_unassign, false) then null else coalesce(p_assigned_to, before_row.assigned_to) end;
    select coalesce(array_agg(tag order by array_position(private.support_known_tags(), tag)), '{}'::text[]) into next_tags
    from (
      select distinct tag from unnest(before_row.tags || add_tags) tag
      where not (tag = any(remove_tags))
    ) t;

    continue when next_status is not distinct from before_row.status
      and next_assignee is not distinct from before_row.assigned_to
      and next_tags is not distinct from before_row.tags;

    update public.support_conversations
    set status = next_status,
        resolved_at = case
          when next_status = before_row.status then resolved_at
          when next_status = 'resolved' then now()
          else null
        end,
        assigned_to = next_assignee,
        tags = next_tags,
        -- Смена одних меток не поднимает обращение в списке.
        updated_at = case
          when next_status is distinct from before_row.status or next_assignee is distinct from before_row.assigned_to then now()
          else updated_at
        end
    where id = before_row.id;

    perform private.audit(
      'support_bulk_updated', before_row.user_id,
      jsonb_build_object('conversationId', before_row.id, 'batchSize', cardinality(ids)),
      jsonb_build_object('status', before_row.status, 'assignedTo', before_row.assigned_to, 'tags', to_jsonb(before_row.tags)),
      jsonb_build_object('status', next_status, 'assignedTo', next_assignee, 'tags', to_jsonb(next_tags))
    );
    changed_ids := changed_ids || before_row.id;
  end loop;

  return jsonb_build_object(
    'requested', cardinality(ids),
    'updated', cardinality(changed_ids),
    'ids', to_jsonb(changed_ids),
    'actor', actor
  );
end;
$$;

revoke all on function public.admin_support_bulk_update(uuid[], text, uuid, boolean, text[], text[]) from public, anon;
grant execute on function public.admin_support_bulk_update(uuid[], text, uuid, boolean, text[], text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Статистика
-- ---------------------------------------------------------------------------

create or replace function public.admin_support_stats(p_period text default 'week')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  sla integer;
  period text := coalesce(p_period, 'week');
  since timestamptz;
  today date := (now() at time zone 'Europe/Moscow')::date;
  first_seen date;
  day_count integer;
  series_from date;
  summary jsonb;
begin
  perform private.require_admin('support');
  if period not in ('day', 'week', 'month', 'all') then
    raise exception 'invalid support period' using errcode = '22023';
  end if;
  sla := private.setting_int('support_sla_minutes', 30);
  since := private.support_period_start(period);

  if since is null then
    select (min(created_at) at time zone 'Europe/Moscow')::date into first_seen from public.support_conversations;
    first_seen := least(coalesce(first_seen, today), today);
  else
    first_seen := (since at time zone 'Europe/Moscow')::date;
  end if;
  day_count := today - first_seen + 1;
  -- Диаграмма «за всё время» - последние 90 дней, иначе столбики не читаются.
  series_from := greatest(first_seen, today - 89);

  select jsonb_build_object(
    'created', count(*),
    'resolved', count(*) filter (where c.status = 'resolved'),
    'responded', count(*) filter (where c.first_response_at is not null),
    'firstResponseAvgMinutes', round((avg(extract(epoch from (c.first_response_at - c.created_at)) / 60)
      filter (where c.first_response_at is not null))::numeric, 1),
    'firstResponseMedianMinutes', round((percentile_cont(0.5) within group (order by extract(epoch from (c.first_response_at - c.created_at)) / 60)
      filter (where c.first_response_at is not null))::numeric, 1),
    'slaBreached', count(*) filter (where
      (c.first_response_at is not null and c.first_response_at - c.created_at > make_interval(mins => sla))
      or (c.first_response_at is null and c.status <> 'resolved' and now() - c.created_at > make_interval(mins => sla))),
    'rated', count(*) filter (where c.rating is not null),
    'ratingAvg', round(avg(c.rating)::numeric, 2)
  ) into summary
  from public.support_conversations c
  where since is null or c.created_at >= since;

  return summary || jsonb_build_object(
    'period', period,
    'since', since,
    'days', day_count,
    'slaMinutes', sla,
    'perDay', round(((summary ->> 'created')::numeric / greatest(day_count, 1)), 1),
    'resolvedShare', case when (summary ->> 'created')::integer > 0
      then round((summary ->> 'resolved')::numeric * 100 / (summary ->> 'created')::numeric, 1) end,
    'now', (
      select jsonb_build_object(
        'open', count(*) filter (where c.status <> 'resolved'),
        'pendingOwner', count(*) filter (where c.status = 'pending_owner'),
        'overdue', count(*) filter (where c.status = 'pending_owner' and c.last_user_message_at < now() - make_interval(mins => sla)),
        'unassigned', count(*) filter (where c.status <> 'resolved' and c.assigned_to is null)
      )
      from public.support_conversations c
    ),
    'series', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'date', d.day,
        'created', (select count(*) from public.support_conversations c
          where (c.created_at at time zone 'Europe/Moscow')::date = d.day),
        'resolved', (select count(*) from public.support_conversations c
          where c.status = 'resolved' and (c.resolved_at at time zone 'Europe/Moscow')::date = d.day)
      ) order by d.day), '[]'::jsonb)
      from (select generate_series(series_from, today, interval '1 day')::date as day) d
    ),
    'byTag', (
      select coalesce(jsonb_agg(jsonb_build_object('tag', t.tag, 'count', t.total) order by t.total desc, t.tag), '[]'::jsonb)
      from (
        select tag, count(*) as total
        from public.support_conversations c, unnest(c.tags) tag
        where since is null or c.created_at >= since
        group by tag
      ) t
    )
  );
end;
$$;

revoke all on function public.admin_support_stats(text) from public, anon;
grant execute on function public.admin_support_stats(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Переписка: то же, что в 20260911090800, плюс история ученика
-- ---------------------------------------------------------------------------

create or replace function public.admin_support_thread(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  conversation public.support_conversations%rowtype;
  plan private.plans;
begin
  perform private.require_admin('support');
  select * into conversation from public.support_conversations where id = p_conversation_id;
  if conversation.id is null then
    raise exception 'support conversation not found' using errcode = 'P0002';
  end if;
  plan := private.effective_plan(conversation.user_id);

  return jsonb_build_object(
    'conversation', to_jsonb(conversation) || jsonb_build_object('slaMinutes', private.setting_int('support_sla_minutes', 30)),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'authorType', m.author_type, 'authorEmail', u.email, 'body', m.body, 'createdAt', m.created_at) order by m.created_at)
      from public.support_messages m left join auth.users u on u.id = m.author_user_id and m.author_type = 'owner'
      where m.conversation_id = p_conversation_id
    ), '[]'::jsonb),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'body', n.body, 'attachment', n.attachment, 'authorEmail', u.email, 'createdAt', n.created_at) order by n.created_at)
      from private.support_notes n left join auth.users u on u.id = n.author_id
      where n.conversation_id = p_conversation_id
    ), '[]'::jsonb),
    'user', (
      select jsonb_build_object(
        'id', p.id, 'email', u.email, 'fullName', p.full_name, 'grade', p.grade,
        'balance', coalesce(w.balance, 0),
        'planTitle', plan.title,
        'isBanned', coalesce(ac.is_banned, false),
        'createdAt', p.created_at
      )
      from public.profiles p join auth.users u on u.id = p.id
      left join public.wallet_accounts w on w.user_id = p.id
      left join public.account_controls ac on ac.user_id = p.id
      where p.id = conversation.user_id
    ),
    'recentTasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', j.idempotency_key, 'subject', j.subject, 'task', j.task, 'preview', j.condition_preview,
        'status', j.status, 'error', j.error, 'createdAt', j.created_at,
        'logId', (select l.id from private.solution_logs l where l.idempotency_key = j.idempotency_key and l.user_id = j.user_id order by l.created_at desc limit 1)
      ) order by j.created_at desc)
      from (select * from public.homework_jobs where user_id = conversation.user_id order by created_at desc limit 5) j
    ), '[]'::jsonb),
    'flags', coalesce((
      select jsonb_agg(jsonb_build_object('ruleId', f.rule_id, 'risk', f.risk, 'explanation', f.explanation, 'status', f.status))
      from private.fraud_flags f where f.user_id = conversation.user_id and f.status in ('open', 'deferred')
    ), '[]'::jsonb),
    'walletEntries', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'amount', e.amount, 'description', e.description, 'createdAt', e.created_at) order by e.created_at desc)
      from (select * from public.wallet_entries where user_id = conversation.user_id order by created_at desc limit 8) e
    ), '[]'::jsonb),
    'ideaApproval', (
      select jsonb_build_object(
        'status', case
          when conversation.category <> 'feature' then 'not_applicable'
          when decision.decision = 'rejected' then 'rejected'
          when approval_message.id is not null then 'approved'
          else 'pending'
        end,
        'requiredPhrase', 'да это хорошая идея',
        'source', case
          when decision.decision = 'rejected' then decision.decided_via
          when approval_message.id is not null then coalesce(decision.decided_via, 'manual_reply')
        end,
        'decidedAt', case
          when decision.decision = 'rejected' then decision.decided_at
          else approval_message.created_at
        end,
        'credited', exists (select 1 from private.support_feature_credits fc where fc.conversation_id = p_conversation_id)
      )
      from (select 1) x
      left join private.support_idea_decisions decision on decision.conversation_id = p_conversation_id
      left join lateral (
        select message.id, message.created_at
        from public.support_messages message
        where message.conversation_id = p_conversation_id
          and message.author_type = 'owner'
          and private.normalize_support_idea_approval(message.body) = 'да это хорошая идея'
        order by message.created_at asc
        limit 1
      ) approval_message on true
    ),
    'templates', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'body', t.body) order by t.sort, t.title)
      from private.support_templates t
    ), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', h.id, 'subject', h.subject, 'category', h.category, 'status', h.status,
        'tags', to_jsonb(h.tags), 'createdAt', h.created_at, 'lastMessageAt', h.last_message_at,
        'resolvedAt', h.resolved_at, 'rating', h.rating
      ) order by h.created_at desc)
      from (
        select * from public.support_conversations
        where user_id = conversation.user_id and id <> conversation.id
        order by created_at desc
        limit 20
      ) h
    ), '[]'::jsonb),
    'historyTotal', (
      select count(*) from public.support_conversations
      where user_id = conversation.user_id and id <> conversation.id
    )
  );
end;
$$;

revoke all on function public.admin_support_thread(uuid) from public, anon;
grant execute on function public.admin_support_thread(uuid) to authenticated;
