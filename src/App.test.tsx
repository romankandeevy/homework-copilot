import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('review preview', () => {
  it('renders the approved notebook fixture', () => {
    render(<App />)

    expect(screen.getByText('Дано:', { selector: '.notebook-title' })).toBeInTheDocument()
    expect(screen.getByText('№ 123', { selector: '.notebook-number' })).toBeInTheDocument()
    expect(screen.getByLabelText(/Лист тетради: задача 123/i)).toBeInTheDocument()
  })

  it('switches fixture from the preview controls', () => {
    render(<App />)

    fireEvent.change(screen.getByLabelText('Тестовая задача'), { target: { value: '2' } })

    expect(screen.getByText('№ 125', { selector: '.notebook-number' })).toBeInTheDocument()
    expect(screen.getByText('∠C = 55°.', { selector: '.notebook-solution' })).toBeInTheDocument()
  })
})
