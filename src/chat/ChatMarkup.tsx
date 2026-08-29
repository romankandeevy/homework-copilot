import { Fragment } from 'react'
import { parseChatMarkup } from './answerMarkup'
import type { ChatSpan } from './answerMarkup'

function Spans({ spans }: { spans: ChatSpan[] }) {
  return (
    <>
      {spans.map((span) => {
        if (span.kind === 'code') return <code key={span.id} className="chat-inline-code">{span.text}</code>
        if (span.kind === 'strong') return <strong key={span.id}>{span.text}</strong>
        if (span.kind === 'link') {
          return (
            <a key={span.id} className="chat-inline-link" href={span.href} target="_blank" rel="noreferrer noopener">
              {span.text}
            </a>
          )
        }
        return <Fragment key={span.id}>{span.text}</Fragment>
      })}
    </>
  )
}

/* Текст ответа никогда не вставляется как HTML: разметка собирается из разобранных блоков. */
export default function ChatMarkup({ text }: { text: string }) {
  const blocks = parseChatMarkup(text)

  return (
    <div className="chat-markup">
      {blocks.map((block) => {
        if (block.kind === 'code') return <pre key={block.id} className="chat-code"><code>{block.text}</code></pre>

        if (block.kind === 'heading') {
          return block.level === 2
            ? <h3 key={block.id} className="chat-markup-heading"><Spans spans={block.spans} /></h3>
            : <h4 key={block.id} className="chat-markup-heading"><Spans spans={block.spans} /></h4>
        }

        if (block.kind === 'list') {
          const items = block.items.map((item) => <li key={item.id}><Spans spans={item.spans} /></li>)
          return block.ordered
            ? <ol key={block.id} className="chat-markup-list">{items}</ol>
            : <ul key={block.id} className="chat-markup-list">{items}</ul>
        }

        return <p key={block.id} className="chat-markup-paragraph"><Spans spans={block.spans} /></p>
      })}
    </div>
  )
}
