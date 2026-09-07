import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GeometryScene } from './GeometryScene'
import { labelRect, rectsOverlap } from './labelLayout'
import type { HomeworkDiagramScene } from '../../lib/homeworkContract'
import { geometryNotebookLayoutV1 } from '../layouts/geometryNotebookLayoutV1'

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

/* Подписи не садятся друг на друга.

   7 сентября на проде график по обществознанию вышел нечитаемым: «S₀», «S₁»
   и подписи точек налезли друг на друга и на сами кривые. Раскладчиков было
   три, они не знали друг о друге, а сравнивали точки-якоря - без ширины
   строки, из-за чего «S₀ = 40» считалось таким же узким, как «A». */
describe('подписи чертежа не накладываются', () => {
  const fontSize = geometryNotebookLayoutV1.typography.bodySize
  const tickSize = Math.round(fontSize * 0.72)

  const drawnRects = (container: HTMLElement) => [
    ...container.querySelectorAll('.diagram-vertex,.diagram-angle-label,.diagram-axis-label,.diagram-tick-label'),
  ].map((node) => labelRect(
    Number(node.getAttribute('x')),
    Number(node.getAttribute('y')),
    node.textContent ?? '',
    node.classList.contains('diagram-tick-label') ? tickSize : fontSize,
    (node.getAttribute('text-anchor') as 'start' | 'middle' | 'end' | null) ?? 'start',
  ))

  const overlaps = (container: HTMLElement) => {
    const rects = drawnRects(container)
    return rects.flatMap((rect, index) => rects
      .slice(index + 1)
      .filter((other) => rectsOverlap(rect, other))
      .map((other) => [rect, other]))
  }

  // Спрос и предложение до и после налога: та самая сцена, на которой
  // подписи слиплись.
  it('разводит подписи двух кривых спроса и предложения', () => {
    const { container } = render(<svg>
      <GeometryScene
        scene={{
          axes: { xMin: 0, xMax: 100, yMin: 0, yMax: 40, unit: 10, xLabel: 'Q', yLabel: 'P' },
          points: [
            { id: 'E', label: 'E', x: 80, y: 20, visible: true },
            { id: 'A', label: 'A', x: 68, y: 26, visible: true },
          ],
          objects: [
            { kind: 'curve', points: [], label: 'S₀', auxiliary: false, formula: '(x - 20)/3' },
            { kind: 'curve', points: [], label: 'S₁', auxiliary: false, formula: '(x - 20)/3 + 10' },
            { kind: 'curve', points: [], label: 'D', auxiliary: false, formula: '(120 - x)/2' },
          ],
          marks: [],
          constraints: [],
        }}
        description="Спрос и предложение до и после налога"
      />
    </svg>)

    expect(container.textContent).toContain('S₀')
    expect(overlaps(container)).toEqual([])
  })

  it('разводит буквы вершин на плотном четырёхугольнике', () => {
    const { container } = render(<svg>
      <GeometryScene
        scene={{
          points: [
            { id: 'A', label: 'A', x: 20, y: 20, visible: true },
            { id: 'B', label: 'B', x: 80, y: 24, visible: true },
            { id: 'C', label: 'C', x: 72, y: 78, visible: true },
            { id: 'D', label: 'D', x: 26, y: 74, visible: true },
            { id: 'O', label: 'O', x: 49, y: 49, visible: true },
          ],
          objects: [
            { kind: 'polygon', points: ['A', 'B', 'C', 'D'], label: '', auxiliary: false },
            { kind: 'segment', points: ['A', 'C'], label: '', auxiliary: true },
            { kind: 'segment', points: ['B', 'D'], label: '', auxiliary: true },
          ],
          marks: [],
          constraints: [],
        }}
        description="Четырёхугольник с диагоналями"
      />
    </svg>)

    expect(container.querySelectorAll('.diagram-vertex')).toHaveLength(5)
    expect(overlaps(container)).toEqual([])
  })
})

/* Скрытое ребро - настоящее ребро тела, а не вспомогательная линия:
   у него своя толщина и свой пунктир. */
describe('чертёж тела', () => {
  it('чертит невидимые рёбра отдельным классом', () => {
    const { container } = render(<svg>
      <GeometryScene
        scene={{
          points: [
            { id: 'A', label: 'A', x: 20, y: 70, visible: true },
            { id: 'B', label: 'B', x: 60, y: 70, visible: true },
            { id: 'D', label: 'D', x: 34, y: 56, visible: true },
            { id: 'A1', label: 'A₁', x: 20, y: 30, visible: true },
          ],
          objects: [
            { kind: 'segment', points: ['A', 'B'], label: '', auxiliary: false },
            { kind: 'segment', points: ['A', 'A1'], label: '', auxiliary: false },
            { kind: 'segment', points: ['A', 'D'], label: '', auxiliary: false, hidden: true },
          ],
          marks: [],
          constraints: [],
        }}
        description="Куб"
      />
    </svg>)

    expect(container.querySelectorAll('path.diagram-hidden')).toHaveLength(1)
    expect(container.querySelectorAll('path.diagram-line')).toHaveLength(2)
    expect(container.querySelectorAll('path.diagram-auxiliary')).toHaveLength(0)
  })
})
