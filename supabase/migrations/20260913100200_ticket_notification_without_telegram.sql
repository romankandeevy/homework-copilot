-- «Новый тикет» больше не шлёт второе сообщение в Telegram.
--
-- Сообщение ученика и так уходит владельцу в Telegram из server/support.ts,
-- и на него можно ответить: ответ вернётся в диалог. Уведомление правила
-- ticket_new приходило вторым, и ответ на него терялся (mapping_not_found в
-- журнале webhook). Почта по этому правилу не меняется. Вернуть Telegram
-- можно в админке, раздел «Уведомления».

update private.admin_notification_rules
set telegram = false, updated_at = now()
where event = 'ticket_new';
