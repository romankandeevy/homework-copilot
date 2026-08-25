create or replace function private.solution_task_price(
  p_textbook_id text,
  p_task_number integer
)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  chapter_length integer;
  position_in_chapter integer;
begin
  if p_task_number is null or p_task_number not between 1 and 9999 then
    raise exception 'invalid task number' using errcode = '22023';
  end if;

  chapter_length := case p_textbook_id
    when 'geometry' then 60
    when 'physics' then 45
    when 'chemistry' then 45
    else 40
  end;
  position_in_chapter := mod(p_task_number - 1, chapter_length);

  if position_in_chapter < ceil(chapter_length / 3.0) then return 5; end if;
  if position_in_chapter < ceil(chapter_length * 2 / 3.0) then return 10; end if;
  return 15;
end;
$$;

drop function if exists public.spend_solution_credit(text, text);

create function public.spend_solution_credit(
  p_idempotency_key text,
  p_description text default 'Решение задачи',
  p_task_number integer default null,
  p_textbook_id text default null,
  p_source text default 'number'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid;
  solution_price integer;
  resulting_balance integer;
begin
  current_user_id := (select auth.uid());

  if current_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if char_length(coalesce(p_idempotency_key, '')) not between 8 and 160 then
    raise exception 'invalid idempotency key' using errcode = '22023';
  end if;

  if char_length(coalesce(p_description, '')) not between 1 and 160 then
    raise exception 'invalid description' using errcode = '22023';
  end if;

  if p_source not in ('number', 'photo') then
    raise exception 'invalid solution source' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.wallet_entries
    where user_id = current_user_id and idempotency_key = p_idempotency_key
  ) then
    select balance into resulting_balance
    from public.wallet_accounts where user_id = current_user_id;
    return resulting_balance;
  end if;

  solution_price := case
    when p_source = 'photo' then 15
    else private.solution_task_price(p_textbook_id, p_task_number)
  end;

  update public.wallet_accounts
  set balance = balance - solution_price
  where user_id = current_user_id and balance >= solution_price
  returning balance into resulting_balance;

  if resulting_balance is null then
    raise exception 'insufficient balance' using errcode = 'P0001';
  end if;

  insert into public.wallet_entries (user_id, amount, kind, description, idempotency_key)
  values (current_user_id, -solution_price, 'debit', p_description, p_idempotency_key);

  return resulting_balance;
exception
  when unique_violation then
    select balance into resulting_balance
    from public.wallet_accounts where user_id = current_user_id;
    return resulting_balance;
end;
$$;

revoke all on function public.spend_solution_credit(text, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.spend_solution_credit(text, text, integer, text, text) to authenticated;
