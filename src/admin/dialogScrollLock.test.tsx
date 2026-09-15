import { render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Modal } from './ui'

/* Окно поверх окна не оставляет страницу без прокрутки. 14 сентября 2026
   владелец не мог листать админку: карточка и подтверждение в ней
   закрывались разом, и последним возвращалось запомненное `hidden`. */
function Stack({ outer, inner }: { outer: boolean; inner: boolean }) {
  return (
    <Modal open={outer} title="Карточка" onClose={() => {}}>
      <Modal open={inner} title="Подтверждение" onClose={() => {}}>Точно удалить?</Modal>
    </Modal>
  )
}

describe('блокировка прокрутки окнами админки', () => {
  afterEach(() => {
    document.body.style.overflow = ''
  })

  it('держится, пока открыто хоть одно окно, и снимается с последним', () => {
    const view = render(<Stack outer inner={false} />)
    expect(document.body.style.overflow).toBe('hidden')
    view.rerender(<Stack outer inner />)
    expect(document.body.style.overflow).toBe('hidden')
    view.rerender(<Stack outer inner={false} />)
    expect(document.body.style.overflow).toBe('hidden')
    view.rerender(<Stack outer={false} inner={false} />)
    expect(document.body.style.overflow).toBe('')
  })

  it('снимается, когда оба окна закрываются одновременно', () => {
    const view = render(<Stack outer inner />)
    expect(document.body.style.overflow).toBe('hidden')
    view.rerender(<Stack outer={false} inner={false} />)
    expect(document.body.style.overflow).toBe('')
  })

  it('снимается, когда стопка окон уходит со страницы целиком', () => {
    const view = render(<Stack outer inner />)
    view.unmount()
    expect(document.body.style.overflow).toBe('')
  })
})
