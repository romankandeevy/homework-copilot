import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GeometryScene } from './GeometryScene'
import { labelRect, labelWidth, rectToSegment, rectsOverlap } from './labelLayout'
import type { Segment } from './labelLayout'
import type { HomeworkDiagramScene } from '../../lib/homeworkContract'
import { geometryNotebookLayoutV1 } from '../layouts/geometryNotebookLayoutV1'
import { auditSheetFixtures } from '../auditFixtures'

describe('равные углы', () => {
  it('первая пара - одной дугой, вторая - двумя', () => {
    const scene: HomeworkDiagramScene = {
      points: [
        { id: 'A', label: 'A', x: 10, y: 90, visible: true },
        { id: 'B', label: 'B', x: 50, y: 10, visible: true },
        { id: 'C', label: 'C', x: 90, y: 90, visible: true },
        { id: 'D', label: 'D', x: 50, y: 90, visible: true },
      ],
      objects: [
        { kind: 'polygon', points: ['A', 'B', 'C'], label: '', auxiliary: false },
        { kind: 'segment', points: ['B', 'D'], label: '', auxiliary: false },
      ],
      marks: [
        { kind: 'equal-angle', points: ['B', 'A', 'C', 'B', 'C', 'A'], label: '' },
        { kind: 'equal-angle', points: ['A', 'B', 'D', 'D', 'B', 'C'], label: '' },
      ],
      constraints: [],
    }
    const { container } = render(<svg><GeometryScene scene={scene} description="Равнобедренный треугольник" /></svg>)
    const arcs = [...container.querySelectorAll('path.diagram-mark')].map((node) => node.getAttribute('d') ?? '')
    expect(arcs).toHaveLength(6)
    expect(arcs.every((path) => path.includes(' A '))).toBe(true)
  })
})

describe('ширина подписи', () => {
  it('индекс уже буквы', () => {
    expect(labelWidth('T₁', 20)).toBeLessThan(labelWidth('TT', 20))
    expect(labelWidth('A₁', 20)).toBeGreaterThan(labelWidth('A', 20))
    expect(labelWidth('', 20)).toBeGreaterThan(0)
  })
})

/* Плотная сцена: 18 подписанных точек - прежний предел сцены. Подписи
   вершин не должны ложиться друг на друга. */
describe('плотный чертёж', () => {
  it('восемнадцать вершин подписаны без наложений', () => {
    const count = 18
    const points = Array.from({ length: count }, (_, index) => {
      const turn = (index / count) * Math.PI * 2
      const id = `${String.fromCharCode(65 + (index % 9))}${index >= 9 ? '₁' : ''}`
      return { id, label: id, x: 50 + Math.cos(turn) * 45, y: 50 + Math.sin(turn) * 45, visible: true }
    })
    const scene: HomeworkDiagramScene = {
      points,
      objects: [{ kind: 'polygon', points: points.map((point) => point.id), label: '', auxiliary: false }],
      marks: [],
      constraints: [],
    }
    const { container } = render(<svg><GeometryScene scene={scene} description="Восемнадцатиугольник" /></svg>)
    const fontSize = geometryNotebookLayoutV1.typography.bodySize
    const rects = [...container.querySelectorAll('text.diagram-vertex')].map((node) => labelRect(
      Number(node.getAttribute('x')),
      Number(node.getAttribute('y')),
      node.textContent ?? '',
      fontSize,
      (node.getAttribute('text-anchor') ?? 'start') as 'start' | 'end',
    ))
    expect(rects).toHaveLength(count)
    const overlaps = rects.flatMap((rect, index) => rects.slice(index + 1).filter((other) => rectsOverlap(rect, other)))
    expect(overlaps).toEqual([])
  })
})

/* Аудит 16 сентября, Г7: «13 см» у равных сторон равнобедренного
   треугольника ложилась на пунктир высоты BH и на сторону. Подпись длины
   проходит ту же раскладку, что буквы вершин. */
describe('подпись длины у значка равных отрезков', () => {
  it('не ложится на линии чертежа и на буквы вершин', () => {
    const geometry = auditSheetFixtures.find((solution) => solution.textbookId === 'geometry')
    const scene = geometry?.diagram.scene
    if (!scene) throw new Error('В записях аудита нет чертежа по геометрии')
    const { container } = render(<svg><GeometryScene scene={scene} description="Равнобедренный треугольник" /></svg>)
    const fontSize = geometryNotebookLayoutV1.typography.bodySize

    const drawn = new Map([...container.querySelectorAll('text.diagram-vertex')].map((node) => {
      const circle = node.parentElement?.querySelector('circle.diagram-point')
      return [node.textContent ?? '', { x: Number(circle?.getAttribute('cx')), y: Number(circle?.getAttribute('cy')) }] as const
    }))
    const at = (id: string) => {
      const point = drawn.get(id)
      if (!point) throw new Error(`Нет вершины ${id}`)
      return point
    }
    const edges: Segment[] = [[at('A'), at('B')], [at('B'), at('C')], [at('C'), at('A')], [at('B'), at('H')]]

    const length = [...container.querySelectorAll('text.diagram-angle-label')].find((node) => node.textContent === '13 см')
    expect(length).toBeDefined()
    const rect = labelRect(
      Number(length?.getAttribute('x')),
      Number(length?.getAttribute('y')),
      '13 см',
      fontSize,
      (length?.getAttribute('text-anchor') ?? 'start') as 'start' | 'middle' | 'end',
    )
    // Меряем от середины и углов прямоугольника: ни одна из них не на линии.
    expect(Math.min(...edges.map((edge) => rectToSegment(rect, edge)))).toBeGreaterThan(4)

    const vertexRects = [...container.querySelectorAll('text.diagram-vertex')].map((node) => labelRect(
      Number(node.getAttribute('x')),
      Number(node.getAttribute('y')),
      node.textContent ?? '',
      fontSize,
      (node.getAttribute('text-anchor') ?? 'start') as 'start' | 'middle' | 'end',
    ))
    expect(vertexRects.filter((other) => rectsOverlap(rect, other))).toEqual([])
  })
})
