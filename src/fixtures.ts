export type NotebookFixture = {
  id: string
  number: string
  condition: string
  given: string
  givenLines?: string[]
  goalTitle: 'Найти' | 'Доказать' | 'Построить'
  goal: string
  goalItems?: string[]
  solutionTitle?: 'Решение' | 'Построение'
  solution: string[]
  answer?: string
  diagram: {
    description: string
    labels: [string, string, string]
    kind?: 'triangle' | 'perpendiculars'
    variant: 'isosceles' | 'median' | 'right'
  }
}

export const fixtures: NotebookFixture[] = [
  {
    id: 'isosceles-triangle',
    number: '123',
    condition: 'В равнобедренном треугольнике ABC AB = BC, ∠B = 40°. Найдите углы при основании.',
    given: '△ABC, AB = BC, ∠B = 40°.',
    goalTitle: 'Найти',
    goal: '∠A и ∠C.',
    goalItems: ['∠C', '∠A'],
    solution: [
      'Т.к AB = BC то △ABC равнобедренный => ∠A = ∠C.',
      '∠A + ∠B + ∠C = 180°.',
      '2∠A + 40° = 180°.',
      '∠A = (180 - 40):2',
      '∠A = ∠C = 70°.',
    ],
    answer: '∠A = 70°, ∠C = 70°.',
    diagram: {
      kind: 'triangle',
      description: 'Равнобедренный треугольник ABC с равными боковыми сторонами AB и BC.',
      labels: ['A', 'C', 'B'],
      variant: 'isosceles',
    },
  },
  {
    id: 'median-triangle',
    number: '124',
    condition: 'В треугольнике ABC проведена медиана BM. Докажите, что AM = MC.',
    given: '△ABC, BM — медиана.',
    goalTitle: 'Доказать',
    goal: 'AM = MC.',
    solution: [
      'По определению медианы треугольника',
      'медиана делит противоположную сторону пополам.',
      'Значит, AM = MC.',
    ],
    diagram: {
      kind: 'triangle',
      description: 'Треугольник ABC с медианой BM к стороне AC.',
      labels: ['A', 'C', 'B'],
      variant: 'median',
    },
  },
  {
    id: 'right-triangle',
    number: '125',
    condition: 'В прямоугольном треугольнике ABC ∠A = 90°, ∠B = 35°. Найдите ∠C.',
    given: '△ABC, ∠A = 90°, ∠B = 35°.',
    goalTitle: 'Найти',
    goal: '∠C.',
    solution: [
      '∠A + ∠B + ∠C = 180°.',
      '90° + 35° + ∠C = 180°.',
      '∠C = 55°.',
    ],
    answer: '55°.',
    diagram: {
      kind: 'triangle',
      description: 'Прямоугольный треугольник ABC с прямым углом при точке A.',
      labels: ['A', 'C', 'B'],
      variant: 'right',
    },
  },
]

export const task105Fixture: NotebookFixture = {
  id: 'task-105-perpendiculars',
  number: '105',
  condition: 'Начертите прямую a и отметьте точки A и B, лежащие по разные стороны от прямой a. С помощью чертёжного угольника проведите из этих точек перпендикуляры к прямой a.',
  given: 'a — прямая, A и B по разные стороны от a.',
  givenLines: ['a — прямая;', 'A и B — по разные', 'стороны от a.'],
  goalTitle: 'Построить',
  goal: 'AC ⟂ a, BD ⟂ a.',
  goalItems: ['AC ⟂ a', 'BD ⟂ a'],
  solutionTitle: 'Построение',
  solution: [
    '1. Один катет угольника приложим к прямой a.',
    '2. Через точку A проведём второй катет: AC ⟂ a.',
    '3. Так же через точку B проведём BD ⟂ a.',
  ],
  answer: 'AC ⟂ a, BD ⟂ a.',
  diagram: {
    kind: 'perpendiculars',
    description: 'Прямая a, точки A и B по разные её стороны и перпендикуляры AC и BD к прямой a.',
    labels: ['A', 'B', 'a'],
    variant: 'right',
  },
}
