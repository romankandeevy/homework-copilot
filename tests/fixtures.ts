import { test as base } from '@playwright/test'
import type { BrowserContext } from '@playwright/test'

export { expect } from '@playwright/test'

/* Общий fixture всех браузерных проверок.

   Приложение на каждом заходе читает из базы настройки админки
   (`get_public_config`: предметы, флаги, баннер), а чат - список моделей
   (`list_chat_models`). Пока проверки ходили за ними в настоящий Supabase,
   недоступная база или выключенный в админке флаг роняли деплой прода,
   хотя код не менялся. Здесь оба ответа подменены на уровне контекста.

   Маршруты страницы важнее маршрутов контекста, поэтому тест, которому
   нужен другой ответ (`mockSupabase` из adminMocks.ts или свой
   `page.route`), перекрывает эти без лишних действий. */

export const publicConfigMock = {
  // Пустой список - все предметы в порядке из кода (orderedSubjects).
  subjects: [],
  // Флаги «включают, а не выключают» (вход через Яндекс ID и по телефону)
  // выключены, как у свежей базы; остальные без записи считаются включёнными.
  flags: {},
  banner: { enabled: false, text: '', tone: 'info', link: '' },
}

export const chatModelsMock = {
  enabled: true,
  models: [
    {
      id: 'e2e-model',
      title: 'Тестовая модель',
      description: 'Ответы подменены в tests/fixtures.ts',
      supportsImages: true,
      supportsWebSearch: false,
      maxChargeKopecks: 500,
      minChargeKopecks: 100,
    },
  ],
}

export async function mockPublicSupabase(context: BrowserContext) {
  await context.route(/\/rest\/v1\/rpc\/get_public_config(\?|$)/, (route) => route.fulfill({ json: publicConfigMock }))
  await context.route(/\/rest\/v1\/rpc\/list_chat_models(\?|$)/, (route) => route.fulfill({ json: chatModelsMock }))
}

// Второй аргумент fixture Playwright принято звать `use`; здесь другое имя,
// потому что oxlint принимает его за хук React.
export const test = base.extend({
  context: async ({ context }, provide) => {
    await mockPublicSupabase(context)
    await provide(context)
  },
})
