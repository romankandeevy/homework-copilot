import '@testing-library/jest-dom/vitest'
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import PrivacyNotice from './PrivacyNotice'

describe('PrivacyNotice', () => {
  beforeEach(() => window.localStorage.clear())

  it('explains necessary storage without pretending it is optional consent', () => {
    const { unmount } = render(<PrivacyNotice />)
    expect(screen.getByText('Без рекламных cookie.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Как это работает' })).toHaveAttribute('href', '/cookies')
    fireEvent.click(screen.getByRole('button', { name: /Понятно/ }))
    expect(screen.queryByLabelText('Уведомление о хранении данных')).not.toBeInTheDocument()

    unmount()
    render(<PrivacyNotice />)
    expect(screen.queryByLabelText('Уведомление о хранении данных')).not.toBeInTheDocument()
  })
})
