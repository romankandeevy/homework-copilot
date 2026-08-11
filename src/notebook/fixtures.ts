import type { GeometryNotebookPageSpec } from './geometry/types'

export const geometryFixtures: readonly GeometryNotebookPageSpec[] = [
  {
    id: 'approved-isosceles-triangle-123',
    number: '123',
    condition: 'В равнобедренном треугольнике ABC AB = BC, ∠B = 40°. Найдите углы при основании.',
    given: ['△ABC', 'AB = BC', '∠B = 40°'],
    goal: { title: 'Найти', text: '∠A и ∠C.' },
    diagram: {
      kind: 'isosceles-triangle',
      description: 'Равнобедренный треугольник ABC с равными сторонами AB и BC и углом B, равным 40 градусам.',
      vertices: ['A', 'B', 'C'],
      apexAngle: '40°',
      equalSides: ['AB', 'BC'],
    },
    solution: [
      'Т.к AB = BC, то △ABC р/б => ∠A = ∠C.',
      '∠A + ∠B + ∠C = 180°.',
      '2∠A + 40° = 180°.',
      '∠A = (180° − 40°):2',
      '∠A = ∠C = 70°.',
    ],
    answer: '∠A = 70°, ∠C = 70°.',
  },
  {
    id: 'median-triangle-124',
    number: '124',
    condition: 'В треугольнике ABC проведена медиана BM. Докажите, что AM = MC.',
    given: ['△ABC', 'BM — медиана.'],
    goal: { title: 'Доказать', text: 'AM = MC.' },
    diagram: {
      kind: 'median-triangle',
      description: 'Треугольник ABC с медианой BM к стороне AC.',
      vertices: ['A', 'B', 'C'],
    },
    solution: [
      'Т.к BM — медиана △ABC,',
      'то M — середина AC.',
      '=> AM = MC.',
    ],
  },
  {
    id: 'right-triangle-125',
    number: '125',
    condition: 'В прямоугольном треугольнике ABC ∠A = 90°, ∠B = 35°. Найдите ∠C.',
    given: ['△ABC', '∠A = 90°', '∠B = 35°'],
    goal: { title: 'Найти', text: '∠C.' },
    diagram: {
      kind: 'right-triangle',
      description: 'Прямоугольный треугольник ABC с прямым углом при точке A.',
      vertices: ['A', 'B', 'C'],
    },
    solution: [
      '∠A + ∠B + ∠C = 180°.',
      '90° + 35° + ∠C = 180°.',
      '∠C = 55°.',
    ],
    answer: '55°.',
  },
]
