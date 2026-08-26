import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { geometryFixtures } from './fixtures'
import { GeometryNotebookLayoutV1 } from './GeometryNotebookLayoutV1'
import { assertGeometryNotebookLayoutV1, geometryNotebookLayoutV1 as layout } from './layouts/geometryNotebookLayoutV1'

describe('GeometryNotebookLayoutV1', () => {
  it('keeps the approved divider joint and diagram invariants', () => {
    expect(assertGeometryNotebookLayoutV1()).toBe(true)
    expect(layout.zones.divider.horizontal.endX).toBe(layout.zones.divider.vertical.x)
    expect(layout.invariants.hasAngleArcAtB).toBe(true)
  })

  it('renders the verified three-point task without an invented angle mark', () => {
    const { container } = render(<GeometryNotebookLayoutV1 spec={geometryFixtures[0]} />)

    expect(screen.getByText('№ 2', { selector: '.notebook-number' })).toBeInTheDocument()
    expect(container.querySelectorAll('[data-angle-arc="B"]')).toHaveLength(0)
    expect(screen.getByLabelText(/Три точки A, B и C/)).toBeInTheDocument()
    expect(screen.getByText('Решение.', { selector: '.notebook-title' })).toBeInTheDocument()
  })

  it('keeps seven solution lines and the answer on one sheet without an invented figure', () => {
    const { container } = render(<GeometryNotebookLayoutV1 spec={{
      ...geometryFixtures[0],
      number: '3',
      diagram: { kind: 'none', description: '', vertices: [] },
      solution: Array.from({ length: 7 }, (_, index) => `Строка ${index + 1}`),
      answer: '3 точки или 1 точка',
    }} />)

    expect(screen.getAllByTestId('geometry-notebook-page')).toHaveLength(1)
    expect(container.querySelector('.geometry-diagram')).not.toBeInTheDocument()
    expect(screen.queryByText('Решение. (продолжение)')).not.toBeInTheDocument()
    expect(screen.getByText('Ответ: 3 точки или 1 точка')).toBeInTheDocument()
  })

  it('starts a real continuation at the top of the next sheet', () => {
    render(<GeometryNotebookLayoutV1 spec={{
      ...geometryFixtures[0],
      diagram: { kind: 'none', description: '', vertices: [] },
      solution: Array.from({ length: 20 }, (_, index) => `Строка ${index + 1}`),
      answer: 'Готово',
    }} />)

    expect(screen.getAllByTestId('geometry-notebook-page')).toHaveLength(2)
    expect(screen.getByText('Решение. (продолжение)')).toHaveAttribute('y', String(layout.zones.solution.continuation.titleY))
    expect(screen.getByText('Строка 9')).toHaveAttribute('y', String(layout.zones.solution.continuation.firstLineY))
  })

  it('renders the exact source scan instead of a semantic template', () => {
    const { container } = render(<GeometryNotebookLayoutV1 spec={{
      ...geometryFixtures[0],
      sourceDiagram: {
        imageUrl: 'data:image/png;base64,c291cmNl',
        alt: 'Исходный рисунок 43 из учебника',
      },
    }} />)

    expect(screen.getByLabelText('Исходный рисунок 43 из учебника')).toHaveClass('source-diagram-image')
    expect(container.querySelector('.geometry-diagram')).not.toBeInTheDocument()
  })

  it('keeps long given and goal text inside the left notebook zone', () => {
    render(<GeometryNotebookLayoutV1 spec={{
      ...geometryFixtures[0],
      given: ['Каждые две прямые пересекаются'],
      goal: { title: 'Найти', text: 'количество точек пересечения' },
    }} />)

    expect(screen.getByText('Каждые две прямые')).toHaveClass('notebook-body-compact')
    expect(screen.getByText('пересекаются')).toHaveClass('notebook-body-compact')
    expect(screen.getByText('Найти: количество')).toHaveClass('notebook-goal-compact')
    expect(screen.getByText('точек пересечения')).toHaveClass('notebook-goal-compact')
  })

  it('does not truncate dense notebook text', () => {
    render(<GeometryNotebookLayoutV1 spec={{
      ...geometryFixtures[0],
      given: ['один два три четыре пять шесть семь восемь девять десять одиннадцать двенадцать тринадцать четырнадцать финал'],
      goal: { title: 'Найти', text: 'один два три четыре пять шесть семь восемь девять десять финал' },
    }} />)

    expect(screen.getAllByText(/финал$/)).toHaveLength(2)
  })
})
