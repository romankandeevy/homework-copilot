import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import {
  ensureTelegramWebhook,
  handleSupportRequest,
  isIdeaApprovalPhrase,
  isSupportRateLimitError,
  normalizeIdeaApprovalPhrase,
  ownerNotificationText,
  parseIdeaCallbackData,
  secureEqual,
  splitTelegramText,
} from './support.ts'

function mockResponse() {
  const headers = new Map<string, string>()
  const end = vi.fn()
  const response = {
    statusCode: 0,
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value)
    },
    end,
  } as unknown as ServerResponse
  return { response, headers, end }
}

describe('telegram webhook', () => {
  const webhookUrl = 'https://homework-copilot-taupe.vercel.app/api/telegram-webhook'
  const ready = { url: webhookUrl, allowed_updates: ['message', 'callback_query'] }

  function telegramFetch(infos: Record<string, unknown>[]) {
    const calls: string[] = []
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const method = String(url).split('/').pop() ?? ''
      calls.push(method)
      const result = method === 'getWebhookInfo' ? infos.shift() : true
      return new Response(JSON.stringify({ ok: true, result }), { status: 200 })
    }) as unknown as typeof fetch
    return { fetchImpl, calls }
  }

  it('keeps a webhook that already points at the site', async () => {
    const { fetchImpl, calls } = telegramFetch([ready])
    await expect(ensureTelegramWebhook('token', 'secret', fetchImpl)).resolves.toBe('kept')
    expect(calls).toEqual(['getWebhookInfo'])
  })

  it('sets a missing webhook and verifies it', async () => {
    const { fetchImpl, calls } = telegramFetch([{ url: '' }, ready])
    await expect(ensureTelegramWebhook('token', 'secret', fetchImpl)).resolves.toBe('set')
    expect(calls).toEqual(['getWebhookInfo', 'setWebhook', 'getWebhookInfo'])
  })

  it('re-sets a webhook that our handler rejects after a secret change', async () => {
    const { fetchImpl, calls } = telegramFetch([{ ...ready, last_error_message: 'Wrong response from the webhook: 401 Unauthorized' }, ready])
    await expect(ensureTelegramWebhook('token', 'secret', fetchImpl)).resolves.toBe('set')
    expect(calls).toEqual(['getWebhookInfo', 'setWebhook', 'getWebhookInfo'])
  })

  it('refuses to touch the webhook without a secret', async () => {
    const { fetchImpl, calls } = telegramFetch([ready])
    await expect(ensureTelegramWebhook('token', undefined, fetchImpl)).rejects.toThrow('secret')
    expect(calls).toEqual([])
  })
})

describe('support telegram helpers', () => {
  it('allows the GitHub Pages production origin to call support', async () => {
    const request = {
      method: 'OPTIONS',
      headers: { origin: 'https://www.homeworkcopilot.ru' },
    } as IncomingMessage
    const { response, headers, end } = mockResponse()

    await handleSupportRequest(request, response)

    expect(response.statusCode).toBe(204)
    expect(headers.get('access-control-allow-origin')).toBe('https://www.homeworkcopilot.ru')
    expect(headers.get('access-control-allow-methods')).toBe('POST, OPTIONS')
    expect(headers.get('access-control-allow-headers')).toBe('Authorization, Content-Type')
    expect(end).toHaveBeenCalledOnce()
  })

  it('rejects support preflight requests from other origins', async () => {
    const request = {
      method: 'OPTIONS',
      headers: { origin: 'https://example.com' },
    } as IncomingMessage
    const { response, headers } = mockResponse()

    await handleSupportRequest(request, response)

    expect(response.statusCode).toBe(403)
    expect(headers.has('access-control-allow-origin')).toBe(false)
  })

  it('compares webhook secrets without accepting different values', () => {
    expect(secureEqual('support-secret', 'support-secret')).toBe(true)
    expect(secureEqual('support-secret', 'support-secret-2')).toBe(false)
    expect(secureEqual('support-secret', '')).toBe(false)
  })

  it('splits long owner notifications into replyable Telegram messages', () => {
    const chunks = splitTelegramText(`${'Условие задачи\n'.repeat(400)}конец`)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk: string) => chunk.length <= 3800)).toBe(true)
    expect(chunks.join('\n')).toContain('конец')
  })

  it('accepts only the normalized exact idea approval phrase', () => {
    expect(normalizeIdeaApprovalPhrase('  Да,   это хорошая идея! ')).toBe('да это хорошая идея')
    expect(isIdeaApprovalPhrase('«Да, это хорошая идея!»')).toBe(true)
    expect(isIdeaApprovalPhrase('да это очень хорошая идея')).toBe(false)
    expect(isIdeaApprovalPhrase('да это хорошая идея начисли 50')).toBe(false)
  })

  it('accepts only bounded opaque idea callback payloads', () => {
    expect(parseIdeaCallbackData('idea:approve:abcdefghijklmnopqrstuvwx')).toEqual({ action: 'approve', token: 'abcdefghijklmnopqrstuvwx' })
    expect(parseIdeaCallbackData('idea:reject:0123456789_-ABCDEFGHIJKL')).toEqual({ action: 'reject', token: '0123456789_-ABCDEFGHIJKL' })
    expect(parseIdeaCallbackData('idea:approve:conversation-id')).toBeNull()
    expect(parseIdeaCallbackData('idea:credit:abcdefghijklmnopqrstuvwx')).toBeNull()
    expect(parseIdeaCallbackData('idea:approve:abcdefghijklmnopqrstuvwx:extra')).toBeNull()
  })
})

/* Аудит 16 сентября, В6: в Telegram - только ссылка на обращение и начало
   сообщения. Почта, телефон, имя, баланс и операции кошелька остаются в админке. */
describe('support owner notification', () => {
  const conversation = { id: '7d3f1c2a-0000-4000-8000-000000000001', category: 'payment', status: 'pending_owner' }

  it('links the ticket in the admin and keeps only the first 500 characters', () => {
    const body = 'а'.repeat(480) + 'хвост, которого в Telegram быть не должно ' + 'б'.repeat(200)
    const text = ownerNotificationText(conversation, body, false)
    expect(text).toContain('https://www.homeworkcopilot.ru/admin?section=support&conversation=7d3f1c2a-0000-4000-8000-000000000001')
    expect(text).toContain('Проблема с оплатой или балансом')
    expect(text).toContain('а'.repeat(480))
    expect(text).not.toContain('б'.repeat(10))
    expect(text).not.toMatch(/баланс \d|Пользователь:|Контекст|@/u)
    expect(text).not.toMatch(/[\u2013\u2014]/u)
  })

  it('keeps a short message whole and asks for an idea decision when needed', () => {
    const text = ownerNotificationText({ ...conversation, category: 'feature' }, 'Добавьте тёмную тему', true)
    expect(text).toContain('Сообщение пользователя:\nДобавьте тёмную тему\n')
    expect(text).toContain('да это хорошая идея')
  })

  it('recognizes the database rate limit refusal', () => {
    expect(isSupportRateLimitError({ message: 'support_rate_limited: messages' })).toBe(true)
    expect(isSupportRateLimitError({ message: 'duplicate key value' })).toBe(false)
    expect(isSupportRateLimitError(null)).toBe(false)
  })
})
