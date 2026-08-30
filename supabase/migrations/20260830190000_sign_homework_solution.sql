-- Подпись сгенерированного решения на стороне базы.
--
-- Проблема: триггер private.enforce_verified_number_solution пускает решение
-- по номеру задачи в общий каталог только если payload побайтово совпал
-- с эталонным либо содержит поле _serverProof — HMAC-SHA256 от канонической
-- строки решения. Эту подпись не вычислял никто: в TypeScript её не было
-- вовсе. В результате любая задача, кроме четырёх эталонных, падала на
-- сохранении с «Не получилось безопасно сохранить готовое решение».
--
-- Решение: подписывает сама база, функцией под service_role.
--   * секрет не покидает базу — сервер его вообще не видит;
--   * каноническая строка считается той же самой функцией
--     private.homework_solution_proof_payload, что и в триггере,
--     поэтому форматы не могут разъехаться при будущих правках.
--
-- Право вызова есть только у service_role: подпись доказывает, что решение
-- прошло движок и проверку качества, а не пришло из браузера.

create or replace function public.sign_homework_solution(p_solution jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  signing_secret text;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if jsonb_typeof(p_solution) <> 'object' then
    raise exception 'invalid solution payload' using errcode = '22023';
  end if;

  select secret into signing_secret
  from private.solver_signing_secrets
  where id = 'primary';

  if signing_secret is null then
    raise exception 'solver signing secret is not configured' using errcode = '55000';
  end if;

  return pg_catalog.encode(
    extensions.hmac(
      pg_catalog.convert_to(
        private.homework_solution_proof_payload(p_solution - '_serverProof'),
        'UTF8'
      ),
      pg_catalog.convert_to(signing_secret, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
end;
$$;

revoke all on function public.sign_homework_solution(jsonb) from public, anon, authenticated;
grant execute on function public.sign_homework_solution(jsonb) to service_role;
