import { describe, expect, it } from 'vitest'
import { humanChatMessage } from './chatClient'

/* Сообщение базы наружу не выходит.

   8 сентября на проде гость открывал ИИ-чат и читал в красной плашке
   `permission denied for function list_chat_models`. Такую строку пишет
   Postgres для журнала: она не переводится, ничего не подсказывает и
   выглядит поломкой даже там, где сработала защита - функция намеренно
   выдана только вошедшим.

   Признак «наше сообщение» - кириллица: все тексты, которые мы показываем,
   написаны по-русски. Всё остальное заменяется общей фразой по коду. */
describe('humanChatMessage', () => {
  it('не выпускает наружу текст ошибки Postgres', () => {
    expect(humanChatMessage('permission denied for function list_chat_models', 'unauthorized'))
      .toBe('Нужно войти в аккаунт')
  })

  it('заменяет любую латиницу общей фразой по коду', () => {
    expect(humanChatMessage('relation "chat_messages" does not exist', 'backend_missing'))
      .toBe('Сервер чата ещё не подключён')
    expect(humanChatMessage('canceling statement due to statement timeout', 'network'))
      .toBe('Сервер чата не ответил. Попробуй ещё раз')
  })

  it('оставляет наши собственные тексты как есть', () => {
    expect(humanChatMessage('На балансе не хватает денег для этого ответа', 'insufficient_funds'))
      .toBe('На балансе не хватает денег для этого ответа')
  })

  it('пустое сообщение тоже получает фразу по коду', () => {
    expect(humanChatMessage('', 'limit')).toBe('Превышен лимит запросов. Попробуй чуть позже')
  })
})
