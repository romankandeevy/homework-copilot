alter table private.admin_audit_log
  drop constraint if exists admin_audit_log_event_type_check;

alter table private.admin_audit_log
  add constraint admin_audit_log_event_type_check check (
    event_type in (
      'balance_adjusted',
      'user_banned',
      'user_unbanned',
      'support_feature_credited',
      'support_status_changed',
      'user_profile_updated',
      'solution_deleted'
    )
  );

create or replace function public.admin_update_user_profile(
  p_user_id uuid,
  p_full_name text,
  p_grade integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_admin();
  normalized_name text := trim(coalesce(p_full_name, ''));
  previous_profile public.profiles%rowtype;
  updated_profile public.profiles%rowtype;
begin
  if char_length(normalized_name) not between 1 and 80 then
    raise exception 'full name must contain 1 to 80 characters' using errcode = '22023';
  end if;

  if p_grade is null or p_grade not between 1 and 11 then
    raise exception 'grade must be between 1 and 11' using errcode = '22023';
  end if;

  select * into previous_profile
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'user not found' using errcode = 'P0002';
  end if;

  update public.profiles
  set full_name = normalized_name,
      grade = p_grade::smallint
  where id = p_user_id
  returning * into updated_profile;

  if previous_profile.full_name is distinct from updated_profile.full_name
    or previous_profile.grade is distinct from updated_profile.grade then
    insert into private.admin_audit_log (actor_id, target_user_id, event_type, payload)
    values (
      actor_id,
      p_user_id,
      'user_profile_updated',
      jsonb_build_object(
        'fullNameBefore', previous_profile.full_name,
        'fullNameAfter', updated_profile.full_name,
        'gradeBefore', previous_profile.grade,
        'gradeAfter', updated_profile.grade
      )
    );
  end if;

  return jsonb_build_object(
    'userId', updated_profile.id,
    'fullName', updated_profile.full_name,
    'grade', updated_profile.grade,
    'updatedAt', updated_profile.updated_at
  );
end;
$$;

create or replace function public.admin_list_solution_library(
  p_search text default '',
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_search text := trim(coalesce(p_search, ''));
  safe_limit integer := greatest(1, least(coalesce(p_limit, 100), 200));
begin
  perform private.require_admin();

  return (
    with matching as (
      select
        solution.id,
        catalog.textbook_id,
        catalog.textbook_title,
        catalog.textbook_edition,
        catalog.subject,
        catalog.task,
        catalog.source_page,
        catalog.created_at,
        coalesce(solution.solution ->> 'condition', '') as condition,
        coalesce(solution.solution ->> 'answer', '') as answer,
        (
          select count(*)
          from public.homework_solution_access as access
          where access.solution_id = solution.id
        ) as access_count
      from public.homework_solution_catalog as catalog
      join public.homework_solutions as solution on solution.id = catalog.solution_id
      where normalized_search = ''
        or catalog.task ilike '%' || normalized_search || '%'
        or catalog.textbook_title ilike '%' || normalized_search || '%'
        or catalog.subject ilike '%' || normalized_search || '%'
        or coalesce(solution.solution ->> 'condition', '') ilike '%' || normalized_search || '%'
    ),
    limited as (
      select *
      from matching
      order by created_at desc, task asc
      limit safe_limit
    )
    select jsonb_build_object(
      'total', (select count(*) from matching),
      'totalAccesses', (select coalesce(sum(access_count), 0) from matching),
      'items', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', id,
            'textbookId', textbook_id,
            'textbookTitle', textbook_title,
            'edition', textbook_edition,
            'subject', subject,
            'task', task,
            'sourcePage', source_page,
            'condition', condition,
            'answer', answer,
            'accessCount', access_count,
            'createdAt', created_at
          )
          order by created_at desc, task asc
        )
        from limited
      ), '[]'::jsonb)
    )
  );
end;
$$;

create or replace function public.admin_delete_solution(
  p_solution_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_admin();
  normalized_reason text := trim(coalesce(p_reason, ''));
  solution_record public.homework_solutions%rowtype;
  catalog_record public.homework_solution_catalog%rowtype;
  access_count integer := 0;
  canonical_rows_cleared integer := 0;
begin
  if char_length(normalized_reason) not between 3 and 160 then
    raise exception 'deletion reason must contain 3 to 160 characters' using errcode = '22023';
  end if;

  select * into solution_record
  from public.homework_solutions
  where id = p_solution_id
  for update;

  if not found then
    raise exception 'solution not found' using errcode = 'P0002';
  end if;

  select * into catalog_record
  from public.homework_solution_catalog
  where solution_id = p_solution_id;

  if not found then
    raise exception 'solution is not published in the library' using errcode = '22023';
  end if;

  select count(*) into access_count
  from public.homework_solution_access
  where solution_id = p_solution_id;

  update public.verified_homework_tasks
  set solution_payload = null
  where textbook_id = catalog_record.textbook_id
    and textbook_edition = catalog_record.textbook_edition
    and source_url = catalog_record.source_url
    and source_page is not distinct from catalog_record.source_page
    and task = catalog_record.task
    and condition_normalized = catalog_record.condition_normalized
    and solution_payload is not null;

  get diagnostics canonical_rows_cleared = row_count;

  delete from public.homework_solutions
  where id = p_solution_id;

  insert into private.admin_audit_log (actor_id, target_user_id, event_type, payload)
  values (
    actor_id,
    solution_record.created_by,
    'solution_deleted',
    jsonb_build_object(
      'solutionId', p_solution_id,
      'textbookId', catalog_record.textbook_id,
      'textbookTitle', catalog_record.textbook_title,
      'edition', catalog_record.textbook_edition,
      'task', catalog_record.task,
      'accessCount', access_count,
      'canonicalRowsCleared', canonical_rows_cleared,
      'reason', normalized_reason
    )
  );

  return jsonb_build_object(
    'deleted', true,
    'solutionId', p_solution_id,
    'task', catalog_record.task,
    'accessCount', access_count,
    'canonicalRowsCleared', canonical_rows_cleared
  );
end;
$$;

revoke all on function public.admin_update_user_profile(uuid, text, integer) from public, anon;
revoke all on function public.admin_list_solution_library(text, integer) from public, anon;
revoke all on function public.admin_delete_solution(uuid, text) from public, anon;

grant execute on function public.admin_update_user_profile(uuid, text, integer) to authenticated;
grant execute on function public.admin_list_solution_library(text, integer) to authenticated;
grant execute on function public.admin_delete_solution(uuid, text) to authenticated;

comment on function public.admin_delete_solution(uuid, text) is
  'Owner-only audited removal of a published solution. Catalog and access rows cascade; balances are not changed.';
