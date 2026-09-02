-- Версия документов и надёжная отметка о согласии.
--
-- Две вещи чинятся вместе.
--
-- 1. Версия «2026-08-28» была вписана намертво в четырёх местах: два CHECK,
--    правило вставки, триггер и RPC. Обновление документов требовало
--    миграции на каждое из них, и легко было поправить три из четырёх.
--    Теперь версия живёт в одной функции, а ограничения проверяют формат.
--
-- 2. Отметка о согласии терялась. Её ставил клиент после входа, читая
--    sessionStorage: подтвердил почту в другом браузере или на телефоне —
--    и доказательства согласия нет вовсе. Теперь её ставит триггер при
--    создании учётной записи, по метке в метаданных регистрации; клиентский
--    путь остаётся для входа через Google, где возврат всегда в тот же
--    браузер.

-- 1. Единственный источник версии.
create or replace function private.current_legal_version()
returns text
language sql
immutable
set search_path = ''
as $function$ select '2026-09-02'::text $function$;

-- 2. Ограничения по формату вместо равенства конкретной дате. Версия строки
--    всё равно проставляется триггером, клиент её не выбирает.
alter table public.legal_acceptances
  drop constraint if exists legal_acceptances_agreement_version_check,
  drop constraint if exists legal_acceptances_privacy_version_check,
  drop constraint if exists legal_acceptances_consent_version_check;

alter table public.legal_acceptances
  add constraint legal_acceptances_agreement_version_check check (agreement_version ~ '^\d{4}-\d{2}-\d{2}$'),
  add constraint legal_acceptances_privacy_version_check check (privacy_version ~ '^\d{4}-\d{2}-\d{2}$'),
  add constraint legal_acceptances_consent_version_check check (consent_version ~ '^\d{4}-\d{2}-\d{2}$');

drop policy if exists "Users can record the current legal acceptance" on public.legal_acceptances;
create policy "Users can record the current legal acceptance"
on public.legal_acceptances
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create or replace function private.stamp_legal_acceptance()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.user_id := coalesce(new.user_id, auth.uid());
  new.agreement_version := private.current_legal_version();
  new.privacy_version := private.current_legal_version();
  new.consent_version := private.current_legal_version();
  new.accepted_at := now();
  return new;
end;
$$;

revoke execute on function private.stamp_legal_acceptance() from public, anon, authenticated;

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

  insert into public.legal_acceptances (user_id, agreement_version, privacy_version, consent_version, source)
  values (
    current_user_id,
    private.current_legal_version(),
    private.current_legal_version(),
    private.current_legal_version(),
    normalized_source
  )
  on conflict (user_id, agreement_version, privacy_version, consent_version) do nothing;
end;
$$;

revoke execute on function public.record_current_legal_acceptance(text) from public, anon;
grant execute on function public.record_current_legal_acceptance(text) to authenticated;

-- 3. Отметка при создании учётной записи.
--
-- Триггер идёт от имени `security definer`, поэтому `auth.uid()` внутри пуст:
-- пользователь ещё не вошёл. Строку заполняем явно, минуя триггер отметки.
create or replace function private.record_signup_legal_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  source text := lower(trim(coalesce(new.raw_user_meta_data ->> 'legal_source', '')));
begin
  if source not in ('email', 'google') then
    return new;
  end if;

  insert into public.legal_acceptances (
    user_id, agreement_version, privacy_version, consent_version, source, accepted_at
  ) values (
    new.id,
    private.current_legal_version(),
    private.current_legal_version(),
    private.current_legal_version(),
    source,
    now()
  )
  on conflict (user_id, agreement_version, privacy_version, consent_version) do nothing;

  return new;
end;
$$;

revoke execute on function private.record_signup_legal_acceptance() from public, anon, authenticated;

drop trigger if exists on_auth_user_record_legal_acceptance on auth.users;
create trigger on_auth_user_record_legal_acceptance
after insert on auth.users
for each row execute function private.record_signup_legal_acceptance();

comment on function private.current_legal_version() is
  'Дата действующей редакции документов. Меняется одной строкой при обновлении текстов.';
