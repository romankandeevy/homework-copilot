-- Класс в профиле больше не выдумывается.
--
-- handle_new_user ставил 8, если класс не пришёл при регистрации. Вход через
-- Google класса не передаёт никогда, поэтому каждый такой ученик числился
-- восьмиклассником, а форма задачи подставляла «8 класс» в каждое условие -
-- и сервер ограничивал приём решения восьмым классом. AGENTS.md: класс не
-- выдумывать. Теперь класса нет, пока ученик его не выбрал; задача без
-- класса решается без ограничения по классу, как и раньше при пустом поле.

alter table public.profiles
  alter column grade drop not null,
  alter column grade drop default;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  profile_name text;
  profile_grade smallint;
  device_id text := nullif(trim(coalesce(new.raw_user_meta_data ->> 'device_id', '')), '');
  gives_welcome boolean := true;
begin
  profile_name := left(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 120);

  -- Нет класса в регистрации (Google его не передаёт) - нет и в профиле.
  if coalesce(new.raw_user_meta_data ->> 'grade', '') ~ '^[1-9]$|^1[01]$' then
    profile_grade := (new.raw_user_meta_data ->> 'grade')::smallint;
  else
    profile_grade := null;
  end if;

  -- Метка есть и уже получала подарок: аккаунт создаётся, деньги - нет.
  if device_id is not null and char_length(device_id) <= 64 then
    gives_welcome := not private.welcome_credit_is_spent(device_id);
  end if;

  insert into public.profiles (id, full_name, grade)
  values (new.id, profile_name, profile_grade);

  insert into public.wallet_accounts (user_id, balance)
  values (new.id, case when gives_welcome then 2000 else 0 end);

  if gives_welcome then
    insert into public.wallet_entries (user_id, amount, kind, description, idempotency_key)
    values (new.id, 2000, 'credit', 'Стартовые 20 ₽', 'welcome-credit');

    if device_id is not null and char_length(device_id) <= 64 then
      insert into private.welcome_grants (device_id, user_id)
      values (device_id, new.id)
      on conflict (device_id) do nothing;
    end if;
  end if;

  return new;
end;
$function$;

-- Админка может сохранить имя, не выбирая класс за ученика.
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

  if p_grade is not null and p_grade not between 1 and 11 then
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

-- Восьмой класс, выданный по умолчанию входу через Google, снимается: такой
-- ученик класса не выбирал. Кто выбрал класс при регистрации по почте, того
-- не трогаем - класс записан в его метаданных.
update public.profiles p
set grade = null
from auth.users u
where u.id = p.id
  and coalesce(u.raw_app_meta_data ->> 'provider', '') = 'google'
  and coalesce(u.raw_user_meta_data ->> 'grade', '') !~ '^[1-9]$|^1[01]$'
  and p.grade = 8;
