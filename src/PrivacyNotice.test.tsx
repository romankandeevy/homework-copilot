import '@testing-library/jest-dom/vitest'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import PrivacyNotice from './PrivacyNotice'

describe('PrivacyNotice', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => vi.useRealTimers())

  it('explains necessary storage without pretending it is optional consent', () => {
    const { unmount } = render(<PrivacyNotice />)
    expect(screen.getByText('Без рекламных cookie.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Подробнее' })).toHaveAttribute('href', '/docs/cookies')
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть уведомление' }))
    expect(screen.queryByLabelText('Уведомление о хранении данных')).not.toBeInTheDocument()

    unmount()
    render(<PrivacyNotice />)
    expect(screen.queryByLabelText('Уведомление о хранении данных')).not.toBeInTheDocument()
  })

  /* Аудит 16 сентября 2026 (Г4): уведомление уходит, как только человек
     начал листать, - в том числе когда листает не окно, а блок внутри. Но не
     от прокрутки, которую страница делает сама сразу после загрузки. */
  it('closes on scroll, but not on the page scrolling itself right after load', () => {
    vi.useFakeTimers()
    const scroller = document.createElement('div')
    document.body.append(scroller)
    render(<PrivacyNotice />)

    act(() => { scroller.dispatchEvent(new Event('scroll')) })
    expect(screen.getByLabelText('Уведомление о хранении данных')).toBeInTheDocument()

    act(() => { vi.advanceTimersByTime(1000) })
    act(() => { scroller.dispatchEvent(new Event('scroll')) })
    expect(screen.queryByLabelText('Уведомление о хранении данных')).not.toBeInTheDocument()
    expect(window.localStorage.getItem('homework-copilot:storage-notice-v1')).toBe('acknowledged')
    scroller.remove()
  })
})
