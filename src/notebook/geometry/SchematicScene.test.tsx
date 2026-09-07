import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SchematicScene } from './SchematicScene'
import { labelRect, rectsOverlap } from './labelLayout'
import type { HomeworkSchematic } from '../../lib/homeworkContract'
import { geometryNotebookLayoutV1 } from '../layouts/geometryNotebookLayoutV1'

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

/* Стержень на рельсах: задача про электромагнитную индукцию с прода.

   7 сентября стрелки F_A и m·g висели рядом со стержнем, ни на что не
   опираясь, а штриховка рельсов шла вразнобой. Причины были разные:
   у стрелки не было ссылки на тело, а штриховку рисовали три отдельные
   копии с разным шагом и наклоном. */
const rails: HomeworkSchematic = {
  kind: 'forces',
  elements: [
    { id: 'AB', symbol: 'body', x: 50, y: 45, rotation: 0, length: 0, label: 'AB' },
    { id: 'FA', symbol: 'vector', x: 50, y: 45, rotation: 270, length: 22, label: 'F_A', anchor: 'AB' },
    { id: 'mg', symbol: 'vector', x: 50, y: 45, rotation: 90, length: 22, label: 'm·g', anchor: 'AB' },
    { id: 'L', symbol: 'wall', x: 20, y: 45, rotation: 0, length: 60, label: '' },
    { id: 'R', symbol: 'wall', x: 80, y: 45, rotation: 0, length: 60, label: '' },
  ],
  connections: [],
}

describe('схема сил', () => {
  const fontSize = Math.round(geometryNotebookLayoutV1.typography.bodySize * 0.72)

  it('стрелка выходит из тела, к которому приложена', () => {
    const { container } = render(<svg>
      <SchematicScene schematic={rails} description="Стержень на рельсах" />
    </svg>)

    // Тело и обе силы стоят в одной точке: значок стрелки рисуется от неё.
    const translations = [...container.querySelectorAll('g[transform]')]
      .map((node) => /translate\(([-\d.]+) ([-\d.]+)\)/u.exec(node.getAttribute('transform') ?? ''))
      .filter((match): match is RegExpExecArray => Boolean(match))
      .map((match) => `${Number(match[1]).toFixed(1)},${Number(match[2]).toFixed(1)}`)

    expect(new Set(translations).size).toBeLessThan(translations.length)
  })

  it('штрихует оба рельса одинаково', () => {
    const { container } = render(<svg>
      <SchematicScene schematic={rails} description="Стержень на рельсах" />
    </svg>)

    const lengths = [...container.querySelectorAll('path.diagram-mark')]
      .map((node) => {
        const numbers = (node.getAttribute('d') ?? '').match(/-?\d+(?:\.\d+)?/gu)?.map(Number) ?? []
        return numbers.length === 4 ? Math.hypot(numbers[2] - numbers[0], numbers[3] - numbers[1]) : 0
      })
      .filter(Boolean)

    expect(lengths.length).toBeGreaterThan(6)
    // Все штрихи одной длины: раньше у стены, опоры и зеркала она была
    // разной. Сотые расходятся из-за округления координат в пути.
    expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThan(0.05)
  })

  it('подписи сил не садятся друг на друга', () => {
    const { container } = render(<svg>
      <SchematicScene schematic={rails} description="Стержень на рельсах" />
    </svg>)

    const rects = [...container.querySelectorAll('text.diagram-tick-label')].map((node) => labelRect(
      Number(node.getAttribute('x')),
      Number(node.getAttribute('y')),
      node.textContent ?? '',
      fontSize,
      (node.getAttribute('text-anchor') as 'start' | 'middle' | 'end' | null) ?? 'start',
    ))

    expect(rects.length).toBeGreaterThanOrEqual(3)
    const clashes = rects.flatMap((rect, index) => rects.slice(index + 1).filter((other) => rectsOverlap(rect, other)))
    expect(clashes).toEqual([])
  })
})
