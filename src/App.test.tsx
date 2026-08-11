import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('review preview', () => {
  it('renders the initial notebook fixture', () => {
    render(<App />)

    expect(screen.getAllByRole('heading', { name: 'Дано:' })).toHaveLength(2)
    expect(screen.getByRole('heading', { name: 'Решение' })).toBeInTheDocument()
    expect(screen.getByLabelText(/Лист тетради: задача 123/i)).toBeInTheDocument()
  })

  it('renders task 105 alongside the triangle solution', () => {
    render(<App />)

    expect(screen.getByLabelText(/Лист тетради: задача 105/i)).toBeInTheDocument()
    expect(screen.getByText('Построение')).toBeInTheDocument()
    expect(screen.getByText(/Ответ:.*AC ⟂ a, BD ⟂ a\./)).toBeInTheDocument()
  })
})
