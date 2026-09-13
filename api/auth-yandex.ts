import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleYandexAuthRequest, yandexAuthConfigFromEnv } from '../server/yandexAuth.ts'

/* Вход через Яндекс ID. Браузер зовёт его через прокси на домене Supabase
   (маршрут `auth-yandex` в supabase/functions/api), как решатель и оплату. */
export default async function handler(request: IncomingMessage, response: ServerResponse) {
  await handleYandexAuthRequest(request, response, {
    supabaseUrl: process.env.VITE_SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY,
    yandex: yandexAuthConfigFromEnv(process.env),
  })
}
