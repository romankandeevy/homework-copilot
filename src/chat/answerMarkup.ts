/* Разбор ответа модели в безопасное дерево блоков.
   Никакого HTML: парсер отдаёт данные, React рисует их обычными элементами.
   Ключи для React считаются здесь же, чтобы в разметке не появлялись индексы массивов. */

export type ChatSpan =
  | { id: string; kind: 'text'; text: string }
  | { id: string; kind: 'strong'; text: string }
  | { id: string; kind: 'code'; text: string }
  | { id: string; kind: 'link'; text: string; href: string }

export type ChatListItem = {
  id: string
  spans: ChatSpan[]
}

export type ChatBlock =
  | { id: string; kind: 'paragraph'; spans: ChatSpan[] }
  | { id: string; kind: 'heading'; level: 2 | 3; spans: ChatSpan[] }
  | { id: string; kind: 'code'; text: string }
  | { id: string; kind: 'list'; ordered: boolean; items: ChatListItem[] }

const codePattern = /`([^`\n]+)`/g
const strongPattern = /\*\*([^*\n]+)\*\*/g
// Хвостовая пунктуация не должна попадать внутрь ссылки.
const linkPattern = /https?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)\]]/g
const bulletPattern = /^ {0,3}[-*•]\s+(.*)$/
const orderedPattern = /^ {0,3}(\d{1,3})[.)]\s+(.*)$/
const headingPattern = /^ {0,3}(#{1,6})\s+(.*)$/
const fencePattern = /^ {0,3}```/

type SpanDraft =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string }

function splitBy(
  text: string,
  pattern: RegExp,
  onMatch: (match: RegExpExecArray) => SpanDraft,
  onRest: (value: string) => SpanDraft[],
): SpanDraft[] {
  const drafts: SpanDraft[] = []
  const scanner = new RegExp(pattern.source, pattern.flags)
  let lastIndex = 0
  let match = scanner.exec(text)

  while (match) {
    if (match.index > lastIndex) drafts.push(...onRest(text.slice(lastIndex, match.index)))
    drafts.push(onMatch(match))
    lastIndex = match.index + match[0].length
    match = scanner.exec(text)
  }

  if (lastIndex < text.length) drafts.push(...onRest(text.slice(lastIndex)))
  return drafts
}

function plainDrafts(value: string): SpanDraft[] {
  return value ? [{ kind: 'text', text: value }] : []
}

function linkDrafts(value: string): SpanDraft[] {
  return splitBy(value, linkPattern, (match) => ({ kind: 'link', text: match[0], href: match[0] }), plainDrafts)
}

function strongDrafts(value: string): SpanDraft[] {
  return splitBy(value, strongPattern, (match) => ({ kind: 'strong', text: match[1] }), linkDrafts)
}

export function parseChatSpans(value: string, prefix = 's'): ChatSpan[] {
  const drafts = splitBy(value, codePattern, (match) => ({ kind: 'code', text: match[1] }), strongDrafts)
  const spans: ChatSpan[] = []
  let counter = 0

  for (const draft of drafts) {
    const id = `${prefix}-${counter}`
    counter += 1
    spans.push(draft.kind === 'link' ? { id, kind: 'link', text: draft.text, href: draft.href } : { id, ...draft })
  }

  return spans
}

export function parseChatMarkup(source: string): ChatBlock[] {
  const blocks: ChatBlock[] = []
  const lines = source.replace(/\r\n/g, '\n').split('\n')

  let blockCounter = 0
  let paragraph: string[] = []
  let listItems: string[] = []
  let listOrdered = false
  let fenceLines: string[] | null = null

  const nextId = () => {
    const id = `b-${blockCounter}`
    blockCounter += 1
    return id
  }

  const flushParagraph = () => {
    const text = paragraph.join('\n').trim()
    paragraph = []
    if (!text) return
    const id = nextId()
    blocks.push({ id, kind: 'paragraph', spans: parseChatSpans(text, id) })
  }

  const flushList = () => {
    const items = listItems
    listItems = []
    if (items.length === 0) return
    const id = nextId()
    blocks.push({
      id,
      kind: 'list',
      ordered: listOrdered,
      items: items.map((item, index) => ({ id: `${id}-i${index}`, spans: parseChatSpans(item, `${id}-i${index}`) })),
    })
  }

  const flushAll = () => {
    flushParagraph()
    flushList()
  }

  for (const line of lines) {
    if (fencePattern.test(line)) {
      if (fenceLines) {
        blocks.push({ id: nextId(), kind: 'code', text: fenceLines.join('\n') })
        fenceLines = null
      } else {
        flushAll()
        fenceLines = []
      }
      continue
    }

    if (fenceLines) {
      fenceLines.push(line)
      continue
    }

    if (!line.trim()) {
      flushAll()
      continue
    }

    const heading = headingPattern.exec(line)
    if (heading) {
      flushAll()
      const id = nextId()
      blocks.push({ id, kind: 'heading', level: heading[1].length <= 2 ? 2 : 3, spans: parseChatSpans(heading[2].trim(), id) })
      continue
    }

    const bullet = bulletPattern.exec(line)
    if (bullet) {
      flushParagraph()
      if (listOrdered && listItems.length > 0) flushList()
      listOrdered = false
      listItems.push(bullet[1].trim())
      continue
    }

    const ordered = orderedPattern.exec(line)
    if (ordered) {
      flushParagraph()
      if (!listOrdered && listItems.length > 0) flushList()
      listOrdered = true
      listItems.push(ordered[2].trim())
      continue
    }

    flushList()
    paragraph.push(line)
  }

  // Незакрытая ограда бывает у ещё не дописанного ответа — показываем как код.
  if (fenceLines) blocks.push({ id: nextId(), kind: 'code', text: fenceLines.join('\n') })
  flushAll()

  return blocks
}
