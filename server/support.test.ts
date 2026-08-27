import { describe, expect, it } from 'vitest'
import { secureEqual, splitTelegramText } from './support.ts'

describe('support telegram helpers', () => {
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
})
