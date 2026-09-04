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

  it('renders the approved rhombus page with numbered solution rows', () => {
    const { container } = render(<GeometryNotebookLayoutV1 spec={geometryFixtures[0]} />)

    expect(screen.getByText('№ 274', { selector: '.notebook-number' })).toBeInTheDocument()
    expect(container.querySelectorAll('[data-angle-arc="B"]')).toHaveLength(0)
    expect(screen.getByLabelText(/Ромб ABCD с диагоналями/)).toBeInTheDocument()
    expect(screen.getByText('Решение.', { selector: '.notebook-title' })).toBeInTheDocument()
    expect(screen.getByText('1) Диагонали ромба делятся пополам и ⟂.')).toBeInTheDocument()
    expect(screen.getByText('5) AB = √169 = 13 см')).toBeInTheDocument()
    expect(screen.getByText('Ответ: AB = 13 см')).toBeInTheDocument()
  })

  /* Номер получает шаг, а не перенос: иначе продолжение строки читается
     как новый пункт решения. */
  it('numbers solution steps once and leaves wrapped rows unnumbered', () => {
    render(<GeometryNotebookLayoutV1 spec={{
      ...geometryFixtures[0],
      diagram: { kind: 'none', description: '', vertices: [] },
      solution: ['1) Итого прямых: прямая a и три прямые AD, BD, CD.', 'Готово'],
      answer: '4 прямые',
    }} />)

    expect(screen.getByText('1) Итого прямых: прямая a и три прямые')).toBeInTheDocument()
    expect(screen.getByText('AD, BD, CD.')).toBeInTheDocument()
    expect(screen.getByText('2) Готово')).toBeInTheDocument()
  })

  /* Номера у принесённой задачи не существует.

     В `task` у задачи из своего условия лежит его начало, и лист печатал
     «№ В прямоугольном треугольнике ABC угол» — обрезанное краем страницы. */
  it('не печатает номер у задачи, принесённой текстом или фотографией', () => {
    const { number: _number, ...withoutNumber } = geometryFixtures[0]
    const { container } = render(<GeometryNotebookLayoutV1 spec={withoutNumber} />)

    expect(container.querySelector('.notebook-number')).not.toBeInTheDocument()
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
    expect(screen.getByText('9) Строка 9')).toHaveAttribute('y', String(layout.zones.solution.continuation.firstLineY))
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

  it('wraps long solution rows before they reach the page edge', () => {
    render(<GeometryNotebookLayoutV1 spec={{
      ...geometryFixtures[0],
      solution: ['Итого прямых: прямая a и три прямые AD, BD, CD.'],
      answer: '4 прямые',
    }} />)

    expect(screen.getByText('1) Итого прямых: прямая a и три прямые')).toBeInTheDocument()
    expect(screen.getByText('AD, BD, CD.')).toBeInTheDocument()
    expect(screen.getByText('Ответ: 4 прямые')).toBeInTheDocument()
  })

  it('renders a construction task from its checked semantic scene', () => {
    const { container } = render(<GeometryNotebookLayoutV1 spec={{
      ...geometryFixtures[0],
      number: '5',
      given: ['A, B ∈ a', 'M, N ∈ [AB]', 'P, Q ∈ a; R, S ∉ a'],
      goal: { title: 'Построить', text: 'P, A, M, N, B, Q; R, S' },
      diagram: {
        kind: 'construction',
        description: 'Точки на прямой a и вне её.',
        vertices: ['P', 'A', 'M', 'N', 'B', 'Q', 'R', 'S'],
        scene: {
          points: [
            { id: 'P', label: 'P', x: 5, y: 55, visible: true },
            { id: 'A', label: 'A', x: 20, y: 55, visible: true },
            { id: 'M', label: 'M', x: 40, y: 55, visible: true },
            { id: 'N', label: 'N', x: 55, y: 55, visible: true },
            { id: 'B', label: 'B', x: 72, y: 55, visible: true },
            { id: 'Q', label: 'Q', x: 95, y: 55, visible: true },
            { id: 'R', label: 'R', x: 30, y: 18, visible: true },
            { id: 'S', label: 'S', x: 78, y: 18, visible: true },
          ],
          objects: [{ kind: 'line', points: ['P', 'Q'], label: 'a', auxiliary: false }],
          marks: [],
          constraints: [
            { kind: 'collinear', points: ['P', 'A', 'M', 'N', 'B', 'Q'] },
            { kind: 'between', points: ['M', 'A', 'B'] },
            { kind: 'between', points: ['N', 'A', 'B'] },
            { kind: 'not-on-line', points: ['R', 'A', 'B'] },
            { kind: 'not-on-line', points: ['S', 'A', 'B'] },
          ],
        },
      },
      solution: ['M, N ∈ [AB]; P, Q ∈ a ∖ [AB]; R, S ∉ a.'],
      answer: undefined,
    }} />)

    expect(screen.getByTestId('geometry-scene')).toHaveAccessibleName('Точки на прямой a и вне её.')
    expect(screen.getByText('Построить: P, A, M,')).toBeInTheDocument()
    expect(screen.getByText('R', { selector: '.diagram-vertex' })).toBeInTheDocument()
    expect(screen.getByText('S', { selector: '.diagram-vertex' })).toBeInTheDocument()
    expect(container.querySelectorAll('.diagram-point')).toHaveLength(8)
    expect(screen.getAllByTestId('geometry-notebook-page')).toHaveLength(1)
  })
})
