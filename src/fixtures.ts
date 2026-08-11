export type NotebookFixture = {
  id: string
  number: string
  condition: string
  given: string
  goalTitle: 'Найти' | 'Доказать'
  goal: string
  solution: string[]
  answer?: string
  diagram: {
    description: string
    labels: [string, string, string]
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
    solution: [
      'Так как AB = BC, то △ABC равнобедренный.',
      'Следовательно, ∠A = ∠C.',
      '∠A + ∠B + ∠C = 180°.',
      '2∠A + 40° = 180°.',
      '∠A = ∠C = 70°.',
    ],
    answer: '70°, 70°.',
    diagram: {
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
      description: 'Прямоугольный треугольник ABC с прямым углом при точке A.',
      labels: ['A', 'C', 'B'],
      variant: 'right',
    },
  },
]
