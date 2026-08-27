-- Idea rewards require a same-conversation owner approval. Telegram decisions
-- use opaque, server-recorded callback mappings and never award money directly.

create or replace function private.normalize_support_idea_approval(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select btrim(regexp_replace(
    regexp_replace(
      replace(lower(coalesce(p_value, '')), 'ё', 'е'),
      '[^a-z0-9а-я[:space:]]+',
      ' ',
      'g'
    ),
    '[[:space:]]+',
    ' ',
    'g'
  ));
$$;

revoke all on function private.normalize_support_idea_approval(text) from public, anon, authenticated;

create table private.support_idea_decisions (
  conversation_id uuid primary key references public.support_conversations(id) on delete cascade,
  decision text not null check (decision in ('approved', 'rejected')),
  decided_via text not null check (decided_via in ('manual_reply', 'telegram_callback')),
  owner_message_id uuid not null unique references public.support_messages(id) on delete restrict,
  telegram_user_id bigint,
  decided_at timestamptz not null default now()
);

create table public.support_telegram_callback_actions (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  telegram_chat_id bigint not null,
  telegram_message_id bigint not null,
  action text not null check (action in ('approve', 'reject')),
  status text not null default 'pending' check (status in ('pending', 'processed')),
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (telegram_chat_id, telegram_message_id, action)
);

create index support_telegram_callback_actions_conversation_idx
  on public.support_telegram_callback_actions (conversation_id, created_at desc);

alter table public.support_telegram_callback_actions enable row level security;
revoke all on public.support_telegram_callback_actions from public, anon, authenticated;
grant select, insert, update, delete on public.support_telegram_callback_actions to service_role;

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

create or replace function public.admin_support_detail(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();

  if not exists (select 1 from public.support_conversations where id = p_conversation_id) then
    raise exception 'support conversation not found' using errcode = 'P0002';
  end if;

  return (
    with conversation as (
      select
        support.id,
        support.user_id,
        account.email,
        profile.full_name,
        profile.grade,
        support.category,
        support.subject,
        support.status,
        support.context,
        support.owner_notification_status,
        support.created_at,
        support.updated_at,
        support.last_message_at,
        support.resolved_at,
        wallet.balance
      from public.support_conversations support
      join auth.users account on account.id = support.user_id
      left join public.profiles profile on profile.id = support.user_id
      left join public.wallet_accounts wallet on wallet.user_id = support.user_id
      where support.id = p_conversation_id
    ),
    messages as (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', message.id,
          'authorType', message.author_type,
          'body', message.body,
          'createdAt', message.created_at
        ) order by message.created_at asc
      ), '[]'::jsonb) as value
      from public.support_messages message
      where message.conversation_id = p_conversation_id
    ),
    wallet_entries as (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', entry.id,
          'amount', entry.amount,
          'kind', entry.kind,
          'description', entry.description,
          'createdAt', entry.created_at
        ) order by entry.created_at desc
      ), '[]'::jsonb) as value
      from (
        select *
        from public.wallet_entries
        where user_id = (select user_id from conversation)
        order by created_at desc
        limit 50
      ) entry
    ),
    idea_approval as (
      select jsonb_build_object(
        'status', case
          when conversation.category <> 'feature' then 'not_applicable'
          when decision.decision = 'rejected' then 'rejected'
          when approval_message.id is not null then 'approved'
          else 'pending'
        end,
        'requiredPhrase', 'да это хорошая идея',
        'source', case
          when decision.decision = 'rejected' then decision.decided_via
          when approval_message.id is not null then coalesce(decision.decided_via, 'manual_reply')
          else null
        end,
        'decidedAt', case
          when decision.decision = 'rejected' then decision.decided_at
          else approval_message.created_at
        end,
        'credited', (credit.conversation_id is not null)
      ) as value
      from conversation
      left join private.support_idea_decisions decision on decision.conversation_id = conversation.id
      left join lateral (
        select message.id, message.created_at
        from public.support_messages message
        where message.conversation_id = conversation.id
          and message.author_type = 'owner'
          and private.normalize_support_idea_approval(message.body) = 'да это хорошая идея'
        order by message.created_at asc
        limit 1
      ) approval_message on true
      left join private.support_feature_credits credit on credit.conversation_id = conversation.id
    )
    select jsonb_build_object(
      'conversation', row_to_json(conversation)::jsonb,
      'messages', messages.value,
      'walletEntries', wallet_entries.value,
      'ideaApproval', idea_approval.value
    )
    from conversation, messages, wallet_entries, idea_approval
  );
end;
$$;

create or replace function public.admin_credit_feature_balance(
  p_conversation_id uuid,
  p_amount integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_admin();
  conversation public.support_conversations%rowtype;
  current_balance integer;
  resulting_balance integer;
  normalized_reason text := trim(coalesce(p_reason, ''));
  wallet_entry public.wallet_entries%rowtype;
  existing_credit private.support_feature_credits%rowtype;
  rejection private.support_idea_decisions%rowtype;
  approval_message_id uuid;
begin
  if p_amount is null or p_amount < 1 or p_amount > 10000 then
    raise exception 'feature credit must be between 1 and 10000' using errcode = '22023';
  end if;
  if char_length(normalized_reason) not between 3 and 160 then
    raise exception 'feature credit reason must contain 3 to 160 characters' using errcode = '22023';
  end if;

  select * into conversation
  from public.support_conversations
  where id = p_conversation_id
  for update;

  if not found then
    raise exception 'support conversation not found' using errcode = 'P0002';
  end if;
  if conversation.category <> 'feature' then
    raise exception 'balance credit is only available for feature ideas' using errcode = '22023';
  end if;

  select * into existing_credit
  from private.support_feature_credits
  where conversation_id = p_conversation_id;
  if found then
    select balance into resulting_balance
    from public.wallet_accounts
    where user_id = conversation.user_id;
    return jsonb_build_object(
      'conversationId', p_conversation_id,
      'credited', false,
      'amount', existing_credit.amount,
      'balance', resulting_balance,
      'reason', existing_credit.reason
    );
  end if;

  select * into rejection
  from private.support_idea_decisions
  where conversation_id = p_conversation_id
    and decision = 'rejected';
  if found then
    raise exception 'idea reward is unavailable because the idea was rejected' using errcode = 'P0001';
  end if;

  select message.id into approval_message_id
  from public.support_messages message
  where message.conversation_id = p_conversation_id
    and message.author_type = 'owner'
    and private.normalize_support_idea_approval(message.body) = 'да это хорошая идея'
  order by message.created_at asc
  limit 1;

  if approval_message_id is null then
    raise exception 'owner approval required: reply exactly "да это хорошая идея" in this idea conversation' using errcode = 'P0001';
  end if;

  select balance into current_balance
  from public.wallet_accounts
  where user_id = conversation.user_id
  for update;
  if current_balance is null then
    raise exception 'wallet not found' using errcode = 'P0002';
  end if;

  resulting_balance := current_balance + p_amount;
  update public.wallet_accounts
  set balance = resulting_balance,
      updated_at = now()
  where user_id = conversation.user_id;

  insert into public.wallet_entries (user_id, amount, kind, description, idempotency_key)
  values (
    conversation.user_id,
    p_amount,
    'credit',
    left('За идею: ' || normalized_reason, 160),
    'support-feature:' || p_conversation_id::text
  )
  returning * into wallet_entry;

  insert into private.support_feature_credits (
    conversation_id, user_id, actor_id, wallet_entry_id, amount, reason
  )
  values (
    p_conversation_id, conversation.user_id, actor_id, wallet_entry.id, p_amount, normalized_reason
  );

  insert into public.support_messages (conversation_id, author_type, body)
  values (
    p_conversation_id,
    'owner',
    'Владелец начислил ' || p_amount || ' ₽ на баланс за идею. Новый баланс: ' || resulting_balance || ' ₽.'
  );

  update public.support_conversations
  set status = 'pending_user', updated_at = now(), last_message_at = now()
  where id = p_conversation_id;

  insert into private.admin_audit_log (actor_id, target_user_id, event_type, payload)
  values (
    actor_id,
    conversation.user_id,
    'support_feature_credited',
    jsonb_build_object(
      'conversationId', p_conversation_id,
      'amount', p_amount,
      'reason', normalized_reason,
      'balanceAfter', resulting_balance
    )
  );

  return jsonb_build_object(
    'conversationId', p_conversation_id,
    'credited', true,
    'amount', p_amount,
    'balance', resulting_balance,
    'reason', normalized_reason
  );
exception
  when unique_violation then
    select * into existing_credit
    from private.support_feature_credits
    where conversation_id = p_conversation_id;
    select balance into resulting_balance
    from public.wallet_accounts
    where user_id = conversation.user_id;
    return jsonb_build_object(
      'conversationId', p_conversation_id,
      'credited', false,
      'amount', existing_credit.amount,
      'balance', resulting_balance,
      'reason', existing_credit.reason
    );
end;
$$;

revoke all on function public.admin_support_detail(uuid) from public, anon;
grant execute on function public.admin_support_detail(uuid) to authenticated;
revoke all on function public.admin_credit_feature_balance(uuid, integer, text) from public, anon;
grant execute on function public.admin_credit_feature_balance(uuid, integer, text) to authenticated;
