import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import LegalPage from './LegalPage'

describe('LegalPage cookie controls', () => {
  afterEach(cleanup)

  it('offers an explicit browser-data removal action', () => {
    render(<LegalPage kind="cookies" />)
    expect(screen.getByRole('button', { name: 'Очистить данные браузера' })).toBeInTheDocument()
    expect(screen.getByText(/вход на этом устройстве могут сброситься/)).toBeInTheDocument()
  })
})
