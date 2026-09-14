import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import LegalPage from './LegalPage'
import type { LegalPageKind } from './LegalPage'

const kinds: LegalPageKind[] = ['terms', 'privacy', 'consent', 'cookies', 'offer', 'contacts']

describe('LegalPage', () => {
  afterEach(cleanup)

  it('offers an explicit browser-data removal action', () => {
    render(<LegalPage kind="cookies" />)
    expect(screen.getByRole('button', { name: 'Очистить данные браузера' })).toBeInTheDocument()
    expect(screen.getByText(/вход на этом устройстве могут сброситься/)).toBeInTheDocument()
  })

  /* До 14 сентября 2026 открытый документ пропадал из списка, и видно было
     пять из шести. */
  it('lists all six documents under /docs/ and marks the open one', () => {
    render(<LegalPage kind="privacy" />)
    const documents = screen.getByRole('navigation', { name: 'Юридические документы' })
    const links = within(documents).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual(kinds.map((kind) => `/docs/${kind}`))
    expect(links.filter((link) => link.getAttribute('aria-current') === 'page')).toHaveLength(1)
    expect(within(documents).getByRole('link', { name: 'Политика данных' })).toHaveAttribute('aria-current', 'page')
  })

  /* Якорь раздела - по номеру из его заголовка: окно баланса ведёт на
     /docs/terms#section-8, «Оплата и возвраты». Таблиц нет ни в одном
     документе, а «Вернуться в сервис» ведёт в приложение, не на витрину.
     Шесть документов подряд в jsdom дольше пяти секунд по умолчанию. */
  it('anchors every section, has no tables and returns to the app', () => {
    for (const kind of kinds) {
      const { container, unmount } = render(<LegalPage kind={kind} />)
      const sections = [...container.querySelectorAll('.legal-sections section')]
      expect(sections.length).toBeGreaterThan(0)
      for (const section of sections) {
        const number = section.querySelector('h2')?.textContent?.match(/^(\d+)\./)?.[1]
        expect(section.id).toBe(`section-${number}`)
      }
      expect(container.querySelector('table')).toBeNull()
      expect(container.querySelector('.legal-back')).toHaveAttribute('href', '/app')
      if (kind === 'terms') expect(container.querySelector('#section-8 h2')).toHaveTextContent('8. Оплата и возвраты')
      unmount()
    }
  }, 30_000)
})
