create or replace function private.homework_solution_payload_has_valid_proof(p_solution jsonb)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_solution ->> '_serverProof' ~ '^[0-9a-f]{64}$'
    and p_solution ->> '_serverProof' = pg_catalog.encode(
      extensions.hmac(
        pg_catalog.convert_to(private.homework_solution_proof_payload(p_solution), 'UTF8'),
        pg_catalog.convert_to(secret.secret, 'UTF8'),
        'sha256'
      ),
      'hex'
    ),
    false
  )
  from private.solver_signing_secrets as secret
  where secret.id = 'primary'
$$;

revoke all on function private.homework_solution_payload_has_valid_proof(jsonb)
  from public, anon, authenticated;

drop trigger if exists publish_reviewed_number_solution
  on private.user_generated_homework_solutions;

create trigger publish_reviewed_number_solution
after insert or update of solution
on private.user_generated_homework_solutions
for each row
when (private.homework_solution_payload_has_valid_proof(new.solution))
execute function private.publish_reviewed_number_solution();

create or replace function public.get_my_homework_solutions()
returns table(solution jsonb, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with candidates as (
    select
      stored.solution,
      stored.created_at,
      stored.textbook_id,
      stored.textbook_edition,
      stored.source_url,
      stored.task,
      stored.condition_normalized,
      0 as source_priority
    from public.homework_solution_access as access
    join public.homework_solutions as stored on stored.id = access.solution_id
    where access.user_id = (select auth.uid())

    union all

    select
      personal.solution,
      personal.created_at,
      personal.textbook_id,
      personal.textbook_edition,
      personal.source_url,
      personal.task,
      personal.condition_normalized,
      1 as source_priority
    from private.user_generated_homework_solutions as personal
    where personal.user_id = (select auth.uid())
  ), latest as (
    select distinct on (
      textbook_id,
      textbook_edition,
      source_url,
      task,
      condition_normalized
    )
      candidate.solution,
      candidate.created_at,
      candidate.textbook_id,
      candidate.textbook_edition,
      candidate.source_url,
      candidate.task,
      candidate.condition_normalized
    from candidates as candidate
    order by
      textbook_id,
      textbook_edition,
      source_url,
      task,
      condition_normalized,
      source_priority,
      created_at desc
  )
  select latest.solution, latest.created_at
  from latest
  order by latest.created_at desc
  limit 100
$$;

revoke all on function public.get_my_homework_solutions()
  from public, anon, authenticated;
grant execute on function public.get_my_homework_solutions()
  to authenticated;
