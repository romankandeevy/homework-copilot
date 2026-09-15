import { describe, expect, it } from 'vitest'
import type { HomeworkDiagramScene } from '../src/lib/homeworkContract.ts'
import { namedFigure, orientDiagram, orientScene, withIsoscelesMarks } from './sceneOrientation.ts'

/* Чертёж стоит основанием вниз.

   Аудит 15 сентября 2026: равнобедренный треугольник ABC с основанием AC
   пришёл вершиной вниз - модель считала ось y математической, а поле
   сцены экранное. Ответ верный, чертёж вверх ногами. */

const condition = 'В равнобедренном треугольнике ABC с основанием AC боковые стороны равны 13 см, а основание 10 см. Найдите высоту BH.'

function upsideDown(): HomeworkDiagramScene {
  return {
    points: [
      { id: 'A', label: 'A', x: 12, y: 14, visible: true },
      { id: 'B', label: 'B', x: 50, y: 90, visible: true },
      { id: 'C', label: 'C', x: 88, y: 14, visible: true },
      { id: 'H', label: 'H', x: 50, y: 14, visible: true },
    ],
    objects: [
      { kind: 'polygon', points: ['A', 'B', 'C'], label: '', auxiliary: false },
      { kind: 'segment', points: ['B', 'H'], label: '', auxiliary: true },
    ],
    marks: [{ kind: 'right-angle', points: ['B', 'H', 'C'], label: '' }],
    constraints: [
      { kind: 'equal-length', points: ['A', 'B', 'B', 'C'] },
      { kind: 'midpoint', points: ['H', 'A', 'C'] },
      { kind: 'perpendicular', points: ['B', 'H', 'A', 'C'] },
    ],
  }
}

describe('фигура с названным основанием', () => {
  it('читает основание равнобедренного треугольника из условия', () => {
    expect(namedFigure(condition)).toEqual({ kind: 'isosceles', vertices: ['A', 'B', 'C'], bases: [['A', 'C']], apex: 'B' })
  })

  it('выводит основание из равных сторон', () => {
    expect(namedFigure('В равнобедренном треугольнике MNK MN = NK, ∠M = 70°.')).toEqual({
      kind: 'isosceles', vertices: ['M', 'N', 'K'], bases: [['M', 'K']], apex: 'N',
    })
  })

  it('читает оба основания трапеции', () => {
    expect(namedFigure('Трапеция ABCD с основаниями AD и BC, AD = 12.')?.bases).toEqual([['A', 'D'], ['B', 'C']])
  })

  it('молчит без названного основания', () => {
    expect(namedFigure('В треугольнике ABC угол A равен 40°.')).toBeNull()
  })
})

describe('ориентация сцены', () => {
  it('переворачивает треугольник вершиной вверх', () => {
    const scene = orientScene(upsideDown(), namedFigure(condition))
    const point = (id: string) => scene.points.find((entry) => entry.id === id)!
    expect(point('B').y).toBeLessThan(point('A').y)
    expect(point('A').y).toBeCloseTo(point('C').y, 1)
    expect(point('A').x).toBeLessThan(point('C').x)
    // Высота осталась высотой: H посередине AC, BH вертикальна.
    expect(point('H').x).toBeCloseTo((point('A').x + point('C').x) / 2, 1)
    expect(point('H').x).toBeCloseTo(point('B').x, 1)
    for (const entry of scene.points) {
      expect(entry.x).toBeGreaterThanOrEqual(0)
      expect(entry.x).toBeLessThanOrEqual(100)
      expect(entry.y).toBeGreaterThanOrEqual(0)
      expect(entry.y).toBeLessThanOrEqual(100)
    }
  })

  it('кладёт наклонённое основание горизонтально', () => {
    const tilted: HomeworkDiagramScene = {
      ...upsideDown(),
      points: [
        { id: 'A', label: 'A', x: 10, y: 60, visible: true },
        { id: 'B', label: 'B', x: 20, y: 10, visible: true },
        { id: 'C', label: 'C', x: 80, y: 30, visible: true },
        { id: 'H', label: 'H', x: 45, y: 45, visible: true },
      ],
    }
    const scene = orientScene(tilted, namedFigure(condition))
    const point = (id: string) => scene.points.find((entry) => entry.id === id)!
    expect(point('A').y).toBeCloseTo(point('C').y, 1)
    expect(point('B').y).toBeLessThan(point('A').y)
  })

  it('не трогает чертёж, который уже стоит прямо', () => {
    const upright = orientScene(upsideDown(), namedFigure(condition))
    expect(orientScene(upright, namedFigure(condition))).toBe(upright)
  })

  it('не трогает координатную плоскость и сцену без основания', () => {
    const scene = upsideDown()
    expect(orientScene(scene, null)).toBe(scene)
    const withAxes = { ...scene, axes: { xMin: -5, xMax: 5, yMin: -5, yMax: 5, unit: 1, xLabel: 'x', yLabel: 'y' } }
    expect(orientScene(withAxes, namedFigure(condition))).toBe(withAxes)
  })
})

describe('значки равнобедренного треугольника', () => {
  it('добавляет штрихи на боковые стороны и дуги на углы при основании', () => {
    const scene = withIsoscelesMarks(upsideDown(), namedFigure(condition))
    expect(scene.marks).toContainEqual({ kind: 'equal-segment', points: ['B', 'A', 'B', 'C'], label: '' })
    expect(scene.marks).toContainEqual({ kind: 'equal-angle', points: ['B', 'A', 'C', 'B', 'C', 'A'], label: '' })
  })

  it('не дублирует значки, которые модель уже поставила', () => {
    const marked: HomeworkDiagramScene = {
      ...upsideDown(),
      marks: [
        { kind: 'equal-segment', points: ['A', 'B', 'B', 'C'], label: '13 см' },
        { kind: 'equal-angle', points: ['B', 'C', 'A', 'B', 'A', 'C'], label: '' },
      ],
    }
    expect(withIsoscelesMarks(marked, namedFigure(condition))).toBe(marked)
  })
})

describe('чертёж по условию', () => {
  it('ставит треугольник прямо и размечает его', () => {
    const diagram = orientDiagram({
      kind: 'construction',
      description: 'Равнобедренный треугольник ABC.',
      vertices: ['A', 'B', 'C', 'H'],
      scene: upsideDown(),
    }, condition)
    const point = (id: string) => diagram.scene!.points.find((entry) => entry.id === id)!
    expect(point('B').y).toBeLessThan(point('A').y)
    expect(diagram.scene!.marks.map((mark) => mark.kind)).toEqual(['right-angle', 'equal-segment', 'equal-angle'])
  })

  it('оставляет как есть чертёж без сцены', () => {
    const diagram = { kind: 'none' as const, description: '', vertices: [] }
    expect(orientDiagram(diagram, condition)).toBe(diagram)
  })
})
