# Поддержка через Telegram

Система поддержки сохраняет обращения в Supabase. Сообщения пользователя отправляются в Telegram владельца, а ответ владельца должен быть отправлен ответом на сообщение бота. Ключи используются только серверными Vercel Functions.

## Переменные Vercel

Добавь в Production и Preview:

- `SUPABASE_SERVICE_ROLE_KEY` — серверный service-role ключ проекта Supabase; не публиковать в браузере.
- `TELEGRAM_BOT_TOKEN` — токен Telegram-бота от BotFather.
- `TELEGRAM_OWNER_CHAT_ID` — числовой chat id владельца, которому бот отправляет обращения.
- `TELEGRAM_WEBHOOK_SECRET` — случайная длинная строка для заголовка webhook.

Публичному клиенту по-прежнему нужны только `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` и URL поддержки `VITE_SUPPORT_API_URL` (`https://homework-copilot-taupe.vercel.app/api/support` для GitHub Pages).

## Webhook

После деплоя задай webhook URL:

`https://www.homeworkcopilot.ru/api/telegram-webhook`

Передай `secret_token`, равный `TELEGRAM_WEBHOOK_SECRET`. Endpoint принимает только POST, проверяет заголовок `X-Telegram-Bot-Api-Secret-Token`, чат владельца и связь `reply_to_message` с сохранённым сообщением бота. Нерелевантные сообщения игнорируются.

Платежи пока не подключены: обращения по оплате показывают владельцу текущий баланс и историю внутреннего баланса, но автоматический возврат не выполняют.
