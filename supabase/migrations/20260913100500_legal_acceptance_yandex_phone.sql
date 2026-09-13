-- Согласие, принятое при входе через Яндекс ID или по номеру телефона.
--
-- Источник отметки о согласии был только 'email' или 'google': проверка на
-- столбце, `record_current_legal_acceptance` и триггер отметки при создании
-- учётной записи. Новые способы входа пишут 'yandex' и 'phone':
-- - Яндекс ID: сервер кладёт `legal_source = 'yandex'` в метаданные нового
--   аккаунта, если отметки стояли на вкладке «Регистрация»;
-- - телефон: клиент передаёт `legal_source = 'phone'` в `signInWithOtp`.
-- Аккаунт без отметки по-прежнему останавливает окно согласия в приложении.
--
-- Версия документов не меняется: 2026-09-13.

-- 1. Проверка на столбце. Имя ограничения задавал Postgres
--    (`legal_acceptances_source_check`), поэтому ищем его по определению.
do $migration$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.legal_acceptances'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%source%'
  loop
    execute format('alter table public.legal_acceptances drop constraint %I', constraint_name);
  end loop;
end;
$migration$;

alter table public.legal_acceptances
  add constraint legal_acceptances_source_check
  check (source in ('email', 'google', 'yandex', 'phone'));

-- 2. Отметка из приложения (окно согласия, согласие с вкладки «Регистрация»).
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

  if normalized_source not in ('email', 'google', 'yandex', 'phone') then
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
create or replace function private.record_signup_legal_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  source text := lower(trim(coalesce(new.raw_user_meta_data ->> 'legal_source', '')));
begin
  if source not in ('email', 'google', 'yandex', 'phone') then
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
