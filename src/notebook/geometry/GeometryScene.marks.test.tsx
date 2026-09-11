import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GeometryScene } from './GeometryScene'
import { labelRect, labelWidth, rectsOverlap } from './labelLayout'
import type { HomeworkDiagramScene } from '../../lib/homeworkContract'
import { geometryNotebookLayoutV1 } from '../layouts/geometryNotebookLayoutV1'

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
