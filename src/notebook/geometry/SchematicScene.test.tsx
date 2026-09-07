import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SchematicScene } from './SchematicScene'
import type { HomeworkSchematic } from '../../lib/homeworkContract'

/* Схема цепи на листе.

   7 сентября: физика и химия чертить не умели вовсе - сцена знала только
   точки и отрезки. Теперь значки из библиотеки рисует лист, модель
   лишь расставляет их и соединяет проводами. */
const circuit: HomeworkSchematic = {
  kind: 'circuit',
  elements: [
    { id: 'E', symbol: 'battery', x: 50, y: 85, rotation: 0, length: 0, label: 'ε' },
    { id: 'R1', symbol: 'resistor', x: 30, y: 15, rotation: 0, length: 0, label: 'R₁ = 4 Ом' },
    { id: 'R2', symbol: 'resistor', x: 70, y: 15, rotation: 0, length: 0, label: 'R₂ = 6 Ом' },
    { id: 'K', symbol: 'switch', x: 85, y: 50, rotation: 90, length: 0, label: 'K' },
  ],
  connections: [
    { from: 'E', to: 'R1', kind: 'wire', label: '' },
    { from: 'R1', to: 'R2', kind: 'wire', label: '' },
    { from: 'R2', to: 'K', kind: 'wire', label: '' },
    { from: 'K', to: 'E', kind: 'wire', label: '' },
  ],
}

describe('SchematicScene', () => {
  it('рисует элементы, провода и подписи', () => {
    const { container } = render(<svg>
      <SchematicScene schematic={circuit} description="Цепь из двух резисторов" />
    </svg>)

    expect(container.querySelector('[data-testid="geometry-schematic"]')).toBeTruthy()
    expect(container.querySelectorAll('rect').length).toBeGreaterThanOrEqual(2)
    expect(container.textContent).toContain('R₁ = 4 Ом')
    expect(container.textContent).toContain('ε')
    // Провод под прямым углом: путь из трёх точек.
    const wires = [...container.querySelectorAll('path.diagram-line')].map((node) => node.getAttribute('d') ?? '')
    expect(wires.some((d) => d.split('L').length === 3)).toBe(true)
  })

  it('поворачивает элемент', () => {
    const { container } = render(<svg>
      <SchematicScene schematic={circuit} description="Цепь" />
    </svg>)
    const rotated = [...container.querySelectorAll('g[transform]')].map((node) => node.getAttribute('transform') ?? '')
    expect(rotated.some((transform) => transform.includes('rotate(90)'))).toBe(true)
  })
})
