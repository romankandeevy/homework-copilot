import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('review preview', () => {
  it('renders the initial notebook fixture', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Дано:' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Решение' })).toBeInTheDocument()
    expect(screen.getByLabelText(/Лист тетради: задача 123/i)).toBeInTheDocument()
  })

  it('switches fixture from the preview controls', () => {
    render(<App />)

    fireEvent.change(screen.getByLabelText('Тестовая задача'), { target: { value: '2' } })

    expect(screen.getByLabelText(/Лист тетради: задача 125/i)).toBeInTheDocument()
    expect(screen.getByText('∠C = 55°.', { selector: '.solution-lines p' })).toBeInTheDocument()
  })
})
