alter table public.support_telegram_message_map enable row level security;
revoke all on public.support_telegram_message_map from public, anon, authenticated;
