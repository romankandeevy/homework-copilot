-- Пределы поддержки на аккаунт (аудит 16 сентября, В6).
--
-- Обращений на аккаунт в час ограничено не было: аккаунт со стартовыми 20 ₽
-- циклом заваливал бота владельца, и настоящие обращения терялись.
-- Теперь - не больше 5 новых обращений и 30 сообщений ученика в час.
--
-- Проверка стоит триггерами в базе, а не в server/support.ts: так её не
-- обойти ни новым путём записи, ни двумя параллельными запросами (замок на
-- аккаунт). Ответы владельца и поддержки (`author_type = 'owner'`) пределы
-- не трогают. Отказ - исключение с текстом `support_rate_limited`; сервер
-- превращает его в 429 с понятной фразой.
--
-- Новое обращение проверяет и предел сообщений: за ним сразу идёт первое
-- сообщение, и пустое обращение без него в базе остаться не должно.

create index if not exists support_messages_author_created_idx
  on public.support_messages (author_user_id, created_at desc)
  where author_type = 'user';

create or replace function private.assert_support_rate(p_user_id uuid, p_new_conversation boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  conversations_last_hour integer;
  messages_last_hour integer;
begin
  if p_user_id is null then
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('support_rate:' || p_user_id::text, 0));

  select count(*) into messages_last_hour
  from public.support_messages m
  where m.author_type = 'user'
    and m.author_user_id = p_user_id
    and m.created_at > now() - interval '1 hour';
  if messages_last_hour >= 30 then
    raise exception 'support_rate_limited: messages' using errcode = 'P0001';
  end if;

  if p_new_conversation then
    select count(*) into conversations_last_hour
    from public.support_conversations c
    where c.user_id = p_user_id
      and c.created_at > now() - interval '1 hour';
    if conversations_last_hour >= 5 then
      raise exception 'support_rate_limited: conversations' using errcode = 'P0001';
    end if;
  end if;
end;
$$;

revoke all on function private.assert_support_rate(uuid, boolean) from public, anon, authenticated;

create or replace function private.support_conversation_rate_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_support_rate(new.user_id, true);
  return new;
end;
$$;

create or replace function private.support_message_rate_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.author_type = 'user' then
    perform private.assert_support_rate(new.author_user_id, false);
  end if;
  return new;
end;
$$;

revoke all on function private.support_conversation_rate_guard() from public, anon, authenticated;
revoke all on function private.support_message_rate_guard() from public, anon, authenticated;

drop trigger if exists support_conversations_rate_guard on public.support_conversations;
create trigger support_conversations_rate_guard
  before insert on public.support_conversations
  for each row execute function private.support_conversation_rate_guard();

drop trigger if exists support_messages_rate_guard on public.support_messages;
create trigger support_messages_rate_guard
  before insert on public.support_messages
  for each row execute function private.support_message_rate_guard();
