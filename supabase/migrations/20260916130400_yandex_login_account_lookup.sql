-- Вход через Яндекс ID в существующий аккаунт (аудит 16 сентября, В2).
--
-- При `email_exists` сервер выписывал ссылку входа в аккаунт с этой почтой,
-- ничего о нём не зная. Предзахват: злоумышленник регистрирует по почте
-- жертвы аккаунт с паролем и не подтверждает; жертва входит через Яндекс ID,
-- попадает в этот аккаунт, ссылка подтверждает почту, жертва пополняет
-- баланс - а злоумышленник входит по своему паролю.
--
-- Серверу входа (server/yandexAuth.ts) нужно знать про аккаунт три вещи:
-- подтверждена ли почта, к какому Яндекс ID он привязан и есть ли у него
-- пароль. Supabase JS не ищет пользователя по почте, поэтому - эта функция,
-- только для служебной роли. Наружу она ничего, кроме этого, не отдаёт.

create or replace function public.auth_account_for_external_login(p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized text := lower(trim(coalesce(p_email, '')));
  account record;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if normalized = '' or char_length(normalized) > 254 then
    return null;
  end if;

  select u.id, u.email_confirmed_at, u.raw_app_meta_data, u.encrypted_password
  into account
  from auth.users u
  where lower(u.email) = normalized
  order by u.created_at
  limit 1;

  if account.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'id', account.id,
    'emailConfirmed', account.email_confirmed_at is not null,
    'yandexId', nullif(account.raw_app_meta_data ->> 'yandex_id', ''),
    'hasPassword', coalesce(account.encrypted_password, '') <> ''
  );
end;
$$;

revoke all on function public.auth_account_for_external_login(text) from public, anon, authenticated;
grant execute on function public.auth_account_for_external_login(text) to service_role;
