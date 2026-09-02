-- Удаление диалога уносит и файлы вложений.
--
-- Политика данных обещает: «Удаление диалога стирает сообщения и вложения».
-- Стирались только строки: `delete_chat_conversation` чистила `chat_messages`,
-- а объекты в бакете `chat-attachments` оставались навсегда — вместе с
-- фотографиями тетрадей и всем, что на них попало.
--
-- Сама функция удалять файлы не может: объекты хранилища живут за пределами
-- транзакции, и падение записи оставило бы диалог с уже стёртыми картинками.
-- Поэтому она возвращает пути удалённых файлов, а хранилище чистит клиент
-- сразу после ответа — правило доступа пускает владельца ровно в свою папку.

create or replace function public.delete_chat_conversation(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  removed_messages integer;
  removed_attachments jsonb;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if not exists (
    select 1 from public.chat_conversations
    where id = p_conversation_id and user_id = current_user_id and deleted_at is null
  ) then
    raise exception 'chat conversation not found' using errcode = 'P0002';
  end if;

  -- Отвязываем финансовые записи до удаления сообщений, чтобы каскад
  -- не унёс историю списаний вместе с текстами.
  update public.chat_generations
  set conversation_id = null, message_id = null
  where user_id = current_user_id and conversation_id = p_conversation_id;

  with purged as (
    delete from public.chat_messages
    where conversation_id = p_conversation_id and user_id = current_user_id
    returning attachments
  ),
  counted as (
    select count(*)::integer as total from purged
  ),
  files as (
    select distinct jsonb_array_elements_text(attachments) as path
    from purged
    where jsonb_typeof(attachments) = 'array'
  )
  select counted.total, coalesce((select jsonb_agg(files.path) from files), '[]'::jsonb)
  into removed_messages, removed_attachments
  from counted;

  update public.chat_conversations
  set deleted_at = now(), title = 'Удалённый чат', updated_at = now()
  where id = p_conversation_id and user_id = current_user_id;

  return jsonb_build_object(
    'deleted', true,
    'messages', coalesce(removed_messages, 0),
    'attachments', coalesce(removed_attachments, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.delete_chat_conversation(uuid) from public, anon, authenticated;
grant execute on function public.delete_chat_conversation(uuid) to authenticated;
