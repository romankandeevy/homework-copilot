create table public.legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agreement_version text not null check (agreement_version = '2026-08-28'),
  privacy_version text not null check (privacy_version = '2026-08-28'),
  consent_version text not null check (consent_version = '2026-08-28'),
  source text not null check (source in ('email', 'google')),
  accepted_at timestamptz not null default now(),
  unique (user_id, agreement_version, privacy_version, consent_version)
);

alter table public.legal_acceptances enable row level security;

revoke all on table public.legal_acceptances from anon, authenticated;
grant select, insert on table public.legal_acceptances to authenticated;

create policy "Users can read their legal acceptances"
on public.legal_acceptances
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can record the current legal acceptance"
on public.legal_acceptances
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and agreement_version = '2026-08-28'
  and privacy_version = '2026-08-28'
  and consent_version = '2026-08-28'
);

create or replace function private.stamp_legal_acceptance()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.user_id := auth.uid();
  new.agreement_version := '2026-08-28';
  new.privacy_version := '2026-08-28';
  new.consent_version := '2026-08-28';
  new.accepted_at := now();
  return new;
end;
$$;

revoke execute on function private.stamp_legal_acceptance() from public, anon, authenticated;

create trigger stamp_legal_acceptance_before_insert
before insert on public.legal_acceptances
for each row execute function private.stamp_legal_acceptance();

create or replace function public.record_current_legal_acceptance(p_source text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_source text := lower(trim(coalesce(p_source, '')));
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if normalized_source not in ('email', 'google') then
    raise exception 'invalid acceptance source' using errcode = '22023';
  end if;

  insert into public.legal_acceptances (
    user_id,
    agreement_version,
    privacy_version,
    consent_version,
    source
  ) values (
    current_user_id,
    '2026-08-28',
    '2026-08-28',
    '2026-08-28',
    normalized_source
  )
  on conflict (user_id, agreement_version, privacy_version, consent_version) do nothing;
end;
$$;

revoke execute on function public.record_current_legal_acceptance(text) from public, anon;
grant execute on function public.record_current_legal_acceptance(text) to authenticated;

comment on table public.legal_acceptances is 'Server-stamped acceptance of the current agreement, privacy policy, and separate personal-data consent.';
