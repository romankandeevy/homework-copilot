import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import {
  handleSupportRequest,
  isIdeaApprovalPhrase,
  normalizeIdeaApprovalPhrase,
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
