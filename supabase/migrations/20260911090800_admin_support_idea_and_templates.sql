-- Поддержка в админке: статус одобрения идеи и список шаблонов.
--
-- 1. admin_support_thread брал статус идеи только из
--    private.support_idea_decisions, а туда пишет лишь кнопка в Telegram.
--    Ответ «да это хорошая идея» из админки начисление разрешал
--    (admin_credit_feature_balance проверяет сообщения владельца), а
--    интерфейс показывал «ждёт решения». Статус считается так же, как в
--    прежнем admin_support_detail: отказ из Telegram, иначе одобряющий ответ
--    владельца в диалоге.
-- 2. Шаблоны быстрых ответов можно прочитать без открытого обращения.

create or replace function public.admin_support_thread(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  conversation public.support_conversations%rowtype;
  plan private.plans;
begin
  perform private.require_admin('support');
  select * into conversation from public.support_conversations where id = p_conversation_id;
  if conversation.id is null then
    raise exception 'support conversation not found' using errcode = 'P0002';
  end if;
  plan := private.effective_plan(conversation.user_id);

  return jsonb_build_object(
    'conversation', to_jsonb(conversation) || jsonb_build_object('slaMinutes', private.setting_int('support_sla_minutes', 30)),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'authorType', m.author_type, 'authorEmail', u.email, 'body', m.body, 'createdAt', m.created_at) order by m.created_at)
      from public.support_messages m left join auth.users u on u.id = m.author_user_id and m.author_type = 'owner'
      where m.conversation_id = p_conversation_id
    ), '[]'::jsonb),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'body', n.body, 'attachment', n.attachment, 'authorEmail', u.email, 'createdAt', n.created_at) order by n.created_at)
      from private.support_notes n left join auth.users u on u.id = n.author_id
      where n.conversation_id = p_conversation_id
    ), '[]'::jsonb),
    'user', (
      select jsonb_build_object(
        'id', p.id, 'email', u.email, 'fullName', p.full_name, 'grade', p.grade,
        'balance', coalesce(w.balance, 0),
        'planTitle', plan.title,
        'isBanned', coalesce(ac.is_banned, false),
        'createdAt', p.created_at
      )
      from public.profiles p join auth.users u on u.id = p.id
      left join public.wallet_accounts w on w.user_id = p.id
      left join public.account_controls ac on ac.user_id = p.id
      where p.id = conversation.user_id
    ),
    'recentTasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', j.idempotency_key, 'subject', j.subject, 'task', j.task, 'preview', j.condition_preview,
        'status', j.status, 'error', j.error, 'createdAt', j.created_at,
        'logId', (select l.id from private.solution_logs l where l.idempotency_key = j.idempotency_key and l.user_id = j.user_id order by l.created_at desc limit 1)
      ) order by j.created_at desc)
      from (select * from public.homework_jobs where user_id = conversation.user_id order by created_at desc limit 5) j
    ), '[]'::jsonb),
    'flags', coalesce((
      select jsonb_agg(jsonb_build_object('ruleId', f.rule_id, 'risk', f.risk, 'explanation', f.explanation, 'status', f.status))
      from private.fraud_flags f where f.user_id = conversation.user_id and f.status in ('open', 'deferred')
    ), '[]'::jsonb),
    'walletEntries', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'amount', e.amount, 'description', e.description, 'createdAt', e.created_at) order by e.created_at desc)
      from (select * from public.wallet_entries where user_id = conversation.user_id order by created_at desc limit 8) e
    ), '[]'::jsonb),
    'ideaApproval', (
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
        end,
        'decidedAt', case
          when decision.decision = 'rejected' then decision.decided_at
          else approval_message.created_at
        end,
        'credited', exists (select 1 from private.support_feature_credits fc where fc.conversation_id = p_conversation_id)
      )
      from (select 1) x
      left join private.support_idea_decisions decision on decision.conversation_id = p_conversation_id
      left join lateral (
        select message.id, message.created_at
        from public.support_messages message
        where message.conversation_id = p_conversation_id
          and message.author_type = 'owner'
          and private.normalize_support_idea_approval(message.body) = 'да это хорошая идея'
        order by message.created_at asc
        limit 1
      ) approval_message on true
    ),
    'templates', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'body', t.body) order by t.sort, t.title)
      from private.support_templates t
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_support_template(p_action text, p_id uuid default null, p_title text default null, p_body text default null, p_sort integer default 0)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin('support');
  template_id uuid;
begin
  if p_action = 'list' then
    return coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'body', t.body, 'sort', t.sort, 'updatedAt', t.updated_at) order by t.sort, t.title)
      from private.support_templates t
    ), '[]'::jsonb);
  elsif p_action = 'save' then
    if p_id is null then
      insert into private.support_templates (title, body, sort, updated_by) values (trim(p_title), trim(p_body), coalesce(p_sort, 0), actor)
      returning id into template_id;
    else
      update private.support_templates set title = trim(p_title), body = trim(p_body), sort = coalesce(p_sort, sort), updated_by = actor, updated_at = now()
      where id = p_id returning id into template_id;
    end if;
    return jsonb_build_object('id', template_id);
  elsif p_action = 'delete' then
    delete from private.support_templates where id = p_id;
    return jsonb_build_object('deleted', true);
  end if;
  raise exception 'unknown template action' using errcode = '22023';
end;
$$;
