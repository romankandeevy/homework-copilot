import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GeometryScene } from './GeometryScene'
import type { HomeworkDiagramScene } from '../../lib/homeworkContract'

/* Координатная плоскость на листе.

   7 сентября: система «y = -0,1x + 0,5 и y = 0,3x + 0,1» решилась верно,
   но нарисовать её было нечем - сцена знала только поле 0..100 без осей.
   Теперь оси, деления и графики по формуле рисует лист сам. */
const graphScene: HomeworkDiagramScene = {
  axes: { xMin: -2, xMax: 4, yMin: -1, yMax: 2, unit: 1, xLabel: 'x', yLabel: 'y' },
  points: [{ id: 'A', label: 'A', x: 1, y: 0.4, visible: true }],
  objects: [
    { kind: 'curve', points: ['A'], label: 'y = -0,1x + 0,5', auxiliary: false, formula: '-0,1x + 0,5' },
    { kind: 'curve', points: ['A'], label: 'y = 0,3x + 0,1', auxiliary: false, formula: '0,3x + 0,1' },
  ],
  marks: [],
  constraints: [],
}

describe('GeometryScene с осями', () => {
  it('рисует оси, деления и обе прямые', () => {
    const { container } = render(<svg>
      <GeometryScene scene={graphScene} description="Две прямые и точка пересечения" />
    </svg>)

    expect(container.querySelectorAll('.diagram-axis').length).toBeGreaterThan(4)
    const ticks = [...container.querySelectorAll('.diagram-tick-label')].map((node) => node.textContent)
    expect(ticks).toEqual(expect.arrayContaining(['-2', '4', '-1', '2']))
    expect(ticks).not.toContain('0')
    expect(container.querySelectorAll('.diagram-line')).toHaveLength(2)
    expect(container.textContent).toContain('y = -0,1x + 0,5')
    expect(container.querySelector('.diagram-vertex')?.textContent).toBe('A')
  })

  it('ось y смотрит вверх', () => {
    const { container } = render(<svg>
      <GeometryScene
        scene={{
          ...graphScene,
          points: [
            { id: 'P', label: 'P', x: 0, y: 2, visible: true },
            { id: 'Q', label: 'Q', x: 0, y: -1, visible: true },
          ],
        }}
        description="Две точки"
      />
    </svg>)
    const [high, low] = [...container.querySelectorAll('.diagram-point')].map((node) => Number(node.getAttribute('cy')))
    expect(high).toBeLessThan(low)
  })
})
