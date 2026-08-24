create table public.user_schedules (
  user_id uuid primary key references auth.users(id) on delete cascade,
  entries jsonb not null default '[]'::jsonb,
  time_slots jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint user_schedules_entries_array check (jsonb_typeof(entries) = 'array'),
  constraint user_schedules_time_slots_array check (jsonb_typeof(time_slots) = 'array')
);

alter table public.user_schedules enable row level security;

revoke all on table public.user_schedules from public, anon, authenticated;
grant select, insert, update, delete on table public.user_schedules to authenticated;

create policy "user_schedules_select_own"
  on public.user_schedules for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "user_schedules_insert_own"
  on public.user_schedules for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "user_schedules_update_own"
  on public.user_schedules for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "user_schedules_delete_own"
  on public.user_schedules for delete
  to authenticated
  using ((select auth.uid()) = user_id);
