import { describe, expect, it } from 'vitest'
import { parseChatMarkup, parseChatSpans } from './answerMarkup'
import { parseSseFrames } from '../lib/chatClient'

describe('parseChatMarkup', () => {
  it('делит ответ на абзацы, списки и код', () => {
    const blocks = parseChatMarkup('Вот план:\n\n- первый шаг\n- второй шаг\n\n```\nx = 2\n```')

    expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'list', 'code'])
    const list = blocks[1]
    expect(list.kind === 'list' && list.ordered).toBe(false)
    expect(list.kind === 'list' && list.items.length).toBe(2)
    expect(blocks[2].kind === 'code' && blocks[2].text).toBe('x = 2')
  })

  it('различает нумерованный список и заголовок', () => {
    const blocks = parseChatMarkup('## Итог\n1. посчитать\n2. проверить')

    expect(blocks[0].kind === 'heading' && blocks[0].level).toBe(2)
    expect(blocks[1].kind === 'list' && blocks[1].ordered).toBe(true)
  })

  it('выдаёт уникальные ключи для блоков и пунктов', () => {
    const blocks = parseChatMarkup('Раз\n\n- а\n- б\n\nДва')
    const ids = blocks.map((block) => block.id)

    expect(new Set(ids).size).toBe(ids.length)
    const list = blocks[1]
    const itemIds = list.kind === 'list' ? list.items.map((item) => item.id) : []
    expect(new Set(itemIds).size).toBe(itemIds.length)
  })

  it('оставляет HTML обычным текстом', () => {
    const spans = parseChatSpans('<script>alert(1)</script> и <b>жирный</b>')

    expect(spans).toHaveLength(1)
    expect(spans[0].kind).toBe('text')
    expect(spans[0].text).toBe('<script>alert(1)</script> и <b>жирный</b>')
  })

  it('разбирает жирный текст, код и ссылку', () => {
    const spans = parseChatSpans('Смотри **тут**: `a + b` и https://example.org/page.')

    expect(spans.map((span) => span.kind)).toEqual(['text', 'strong', 'text', 'code', 'text', 'link', 'text'])
    const link = spans[5]
    expect(link.kind === 'link' && link.href).toBe('https://example.org/page')
  })
})

describe('parseSseFrames', () => {
  it('собирает целые события и оставляет хвост в буфере', () => {
    const { frames, rest } = parseSseFrames('event: delta\ndata: {"text":"при"}\n\nevent: delta\ndata: {"text":"вет')

    expect(frames).toEqual([{ event: 'delta', data: '{"text":"при"}' }])
    expect(rest).toBe('event: delta\ndata: {"text":"вет')
  })

  it('понимает переводы строк CRLF и событие ошибки', () => {
    const { frames } = parseSseFrames('event: error\r\ndata: {"message":"нет денег"}\r\n\r\n')

    expect(frames).toEqual([{ event: 'error', data: '{"message":"нет денег"}' }])
  })
})
