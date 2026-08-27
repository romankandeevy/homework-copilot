-- Persistent support conversations. User writes are brokered by the server so
-- Telegram delivery and context enrichment never trust browser-supplied auth.

create table public.support_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('general', 'payment', 'feature', 'wrong_solution')),
  subject text not null check (char_length(subject) between 1 and 120),
  status text not null default 'pending_owner' check (status in ('pending_owner', 'pending_user', 'resolved')),
  context jsonb not null default '{}'::jsonb check (jsonb_typeof(context) = 'object'),
  owner_notification_status text not null default 'pending' check (owner_notification_status in ('pending', 'sent', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index support_conversations_user_updated_idx
  on public.support_conversations (user_id, updated_at desc);
create index support_conversations_status_updated_idx
  on public.support_conversations (status, updated_at desc);

create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  author_type text not null check (author_type in ('user', 'owner')),
  author_user_id uuid references auth.users(id) on delete set null,
  body text not null check (char_length(body) between 1 and 4000),
  source_key text unique,
  created_at timestamptz not null default now(),
  constraint support_messages_author_shape check (
    (author_type = 'user' and author_user_id is not null)
    or (author_type = 'owner' and author_user_id is null)
  )
);

create index support_messages_conversation_created_idx
  on public.support_messages (conversation_id, created_at asc);

alter table public.support_conversations enable row level security;
alter table public.support_messages enable row level security;
revoke all on public.support_conversations from public, anon, authenticated;
revoke all on public.support_messages from public, anon, authenticated;
grant select on public.support_conversations to authenticated;
grant select on public.support_messages to authenticated;

drop policy if exists support_conversations_select_own on public.support_conversations;
create policy support_conversations_select_own
  on public.support_conversations
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists support_messages_select_own on public.support_messages;
create policy support_messages_select_own
  on public.support_messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.support_conversations conversation
      where conversation.id = support_messages.conversation_id
        and conversation.user_id = (select auth.uid())
    )
  );

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.support_telegram_message_map (
  telegram_chat_id bigint not null,
  telegram_message_id bigint not null,
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  direction text not null check (direction in ('outbound', 'inbound')),
  created_at timestamptz not null default now(),
  primary key (telegram_chat_id, telegram_message_id)
);

create index support_telegram_message_map_conversation_idx
  on public.support_telegram_message_map (conversation_id, created_at desc);
revoke all on public.support_telegram_message_map from public, anon, authenticated;

create table private.support_telegram_processed_updates (
  update_id bigint primary key,
  processed_at timestamptz not null default now()
);

create table private.support_feature_credits (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null unique references public.support_conversations(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  wallet_entry_id uuid not null unique references public.wallet_entries(id) on delete restrict,
  amount integer not null check (amount > 0),
  reason text not null check (char_length(reason) between 3 and 160),
  created_at timestamptz not null default now()
);

alter table private.admin_audit_log drop constraint if exists admin_audit_log_event_type_check;
alter table private.admin_audit_log
  add constraint admin_audit_log_event_type_check check (
    event_type in ('balance_adjusted', 'user_banned', 'user_unbanned', 'support_feature_credited', 'support_status_changed')
  );

create or replace function public.admin_support_list(
  p_status text default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_limit integer := greatest(1, least(coalesce(p_limit, 100), 200));
  normalized_status text := nullif(trim(coalesce(p_status, '')), '');
begin
  perform private.require_admin();

  if normalized_status is not null and normalized_status not in ('pending_owner', 'pending_user', 'resolved') then
    raise exception 'invalid support status' using errcode = '22023';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', conversation.id,
        'userId', conversation.user_id,
        'email', account.email,
        'fullName', profile.full_name,
        'category', conversation.category,
        'subject', conversation.subject,
        'status', conversation.status,
        'ownerNotificationStatus', conversation.owner_notification_status,
        'context', conversation.context,
        'createdAt', conversation.created_at,
        'updatedAt', conversation.updated_at,
        'lastMessageAt', conversation.last_message_at,
        'lastMessage', last_message.body
      )
      order by conversation.updated_at desc
    )
    from (
      select *
      from public.support_conversations
      where normalized_status is null or status = normalized_status
      order by updated_at desc
      limit safe_limit
    ) conversation
    join auth.users account on account.id = conversation.user_id
    left join public.profiles profile on profile.id = conversation.user_id
    left join lateral (
      select body
      from public.support_messages message
      where message.conversation_id = conversation.id
      order by message.created_at desc
      limit 1
    ) last_message on true
  ), '[]'::jsonb);
end;
$$;

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
    )
    select jsonb_build_object(
      'conversation', row_to_json(conversation)::jsonb,
      'messages', messages.value,
      'walletEntries', wallet_entries.value
    )
    from conversation, messages, wallet_entries
  );
end;
$$;

create or replace function public.admin_support_update_status(
  p_conversation_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_admin();
  normalized_status text := trim(coalesce(p_status, ''));
  conversation public.support_conversations%rowtype;
begin
  if normalized_status not in ('pending_owner', 'pending_user', 'resolved') then
    raise exception 'invalid support status' using errcode = '22023';
  end if;

  select * into conversation
  from public.support_conversations
  where id = p_conversation_id
  for update;

  if not found then
    raise exception 'support conversation not found' using errcode = 'P0002';
  end if;

  update public.support_conversations
  set status = normalized_status,
      updated_at = now(),
      resolved_at = case when normalized_status = 'resolved' then now() else null end
  where id = p_conversation_id;

  insert into private.admin_audit_log (actor_id, target_user_id, event_type, payload)
  values (
    actor_id,
    conversation.user_id,
    'support_status_changed',
    jsonb_build_object(
      'conversationId', p_conversation_id,
      'action', 'status_changed',
      'status', normalized_status
    )
  );

  return jsonb_build_object('conversationId', p_conversation_id, 'status', normalized_status);
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

revoke all on function public.admin_support_list(text, integer) from public, anon;
grant execute on function public.admin_support_list(text, integer) to authenticated;
revoke all on function public.admin_support_detail(uuid) from public, anon;
grant execute on function public.admin_support_detail(uuid) to authenticated;
revoke all on function public.admin_support_update_status(uuid, text) from public, anon;
grant execute on function public.admin_support_update_status(uuid, text) to authenticated;
revoke all on function public.admin_credit_feature_balance(uuid, integer, text) from public, anon;
grant execute on function public.admin_credit_feature_balance(uuid, integer, text) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.support_conversations;
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.support_messages;
exception
  when duplicate_object then null;
end;
$$;
