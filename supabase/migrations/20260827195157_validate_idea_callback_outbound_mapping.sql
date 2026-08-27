-- Require the callback action and the original outbound Telegram mapping to
-- agree before recording an owner decision.

create or replace function public.record_support_idea_telegram_decision(
  p_token_hash text,
  p_action text,
  p_telegram_chat_id bigint,
  p_telegram_message_id bigint,
  p_telegram_user_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  callback_action public.support_telegram_callback_actions%rowtype;
  conversation public.support_conversations%rowtype;
  existing_decision private.support_idea_decisions%rowtype;
  approval_message_id uuid;
  decision_message_id uuid;
  desired_decision text;
  decision_source text;
  applied boolean := false;
begin
  if coalesce(p_action, '') not in ('approve', 'reject')
     or coalesce(p_token_hash, '') !~ '^[0-9a-f]{64}$'
     or p_telegram_chat_id is null
     or p_telegram_message_id is null
     or p_telegram_user_id is null then
    raise exception 'invalid idea callback' using errcode = '22023';
  end if;

  select * into callback_action
  from public.support_telegram_callback_actions
  where token_hash = p_token_hash
  for update;

  if not found
     or callback_action.action <> p_action
     or callback_action.telegram_chat_id <> p_telegram_chat_id
     or callback_action.telegram_message_id <> p_telegram_message_id
     or p_telegram_user_id <> p_telegram_chat_id then
    raise exception 'idea callback is not authorized' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.support_telegram_message_map mapping
    where mapping.telegram_chat_id = p_telegram_chat_id
      and mapping.telegram_message_id = p_telegram_message_id
      and mapping.conversation_id = callback_action.conversation_id
      and mapping.direction = 'outbound'
  ) then
    raise exception 'idea callback outbound mapping is invalid' using errcode = '42501';
  end if;

  select * into conversation
  from public.support_conversations
  where id = callback_action.conversation_id
  for update;

  if not found or conversation.category <> 'feature' then
    raise exception 'idea callback is only available for idea conversations' using errcode = '22023';
  end if;

  select * into existing_decision
  from private.support_idea_decisions
  where conversation_id = conversation.id
  for update;

  if not found then
    select message.id into approval_message_id
    from public.support_messages message
    where message.conversation_id = conversation.id
      and message.author_type = 'owner'
      and private.normalize_support_idea_approval(message.body) = 'да это хорошая идея'
    order by message.created_at asc
    limit 1;

    if approval_message_id is not null then
      desired_decision := 'approved';
      decision_source := 'manual_reply';
      decision_message_id := approval_message_id;
    else
      desired_decision := case when p_action = 'approve' then 'approved' else 'rejected' end;
      decision_source := 'telegram_callback';

      insert into public.support_messages (conversation_id, author_type, body, source_key)
      values (
        conversation.id,
        'owner',
        case
          when desired_decision = 'approved' then 'да это хорошая идея'
          else 'Владелец отклонил идею.'
        end,
        'idea-decision:' || p_token_hash
      )
      returning id into decision_message_id;
    end if;

    insert into private.support_idea_decisions (
      conversation_id,
      decision,
      decided_via,
      owner_message_id,
      telegram_user_id
    )
    values (
      conversation.id,
      desired_decision,
      decision_source,
      decision_message_id,
      case when decision_source = 'telegram_callback' then p_telegram_user_id else null end
    )
    returning * into existing_decision;

    applied := decision_source = 'telegram_callback';

    update public.support_conversations
    set status = case when desired_decision = 'approved' then 'pending_user' else 'resolved' end,
        updated_at = now(),
        last_message_at = now(),
        resolved_at = case when desired_decision = 'rejected' then now() else null end
    where id = conversation.id;
  end if;

  update public.support_telegram_callback_actions
  set status = 'processed', processed_at = coalesce(processed_at, now())
  where conversation_id = conversation.id;

  return jsonb_build_object(
    'ok', true,
    'decision', existing_decision.decision,
    'applied', applied
  );
end;
$$;

revoke all on function public.record_support_idea_telegram_decision(text, text, bigint, bigint, bigint) from public, anon, authenticated;
grant execute on function public.record_support_idea_telegram_decision(text, text, bigint, bigint, bigint) to service_role;
