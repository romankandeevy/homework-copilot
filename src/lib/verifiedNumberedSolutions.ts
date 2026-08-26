import type { HomeworkDiagram, HomeworkSolution } from './homeworkContract.ts'

type VerifiedGeometrySolution = {
  given: readonly string[]
  goal: HomeworkSolution['goal']
  steps: readonly string[]
  answer: string
  diagram: HomeworkDiagram
}

const verifiedGeometrySolutions: Readonly<Record<string, VerifiedGeometrySolution>> = {
  '2': {
    given: ['A, B, C — неколлинеарны'],
    goal: { title: 'Найти', text: 'n(прямых)' },
    steps: [
      'AB, BC, CA — различные прямые.',
      'n = 3.',
    ],
    answer: '3 прямые',
    diagram: {
      kind: 'three-point-extended-lines',
      description: 'Три неколлинеарные точки A, B, C и прямые AB, BC, CA.',
      vertices: ['A', 'B', 'C'],
    },
  },
  '3': {
    given: ['a ∩ b ≠ ∅', 'a ∩ c ≠ ∅', 'b ∩ c ≠ ∅'],
    goal: { title: 'Найти', text: 'n(точек пересечения)' },
    steps: [
      '1) a ∩ b = A; b ∩ c = B; a ∩ c = C ⇒ n = 3.',
      '2) a ∩ b ∩ c = O ⇒ n = 1.',
    ],
    answer: '1 или 3 точки',
    diagram: {
      kind: 'three-lines-cases',
      description: 'Два случая пересечения трёх прямых: три разные точки и одна общая точка.',
      vertices: ['A', 'B', 'C', 'O'],
    },
  },
  '4': {
    given: ['A, B, C ∈ a', 'D ∉ a'],
    goal: { title: 'Найти', text: 'n(прямых)' },
    steps: [
      'AB ≡ AC ≡ BC ≡ a ⇒ n₁ = 1.',
      'AD, BD, CD ⇒ n₂ = 3.',
      'n = n₁ + n₂ = 1 + 3 = 4.',
    ],
    answer: '4 прямые',
    diagram: {
      kind: 'three-collinear-one-off-lines',
      description: 'Точки A, B, C лежат на прямой a, точка D не лежит на ней; проведены прямые AD, BD и CD.',
      vertices: ['A', 'B', 'C', 'D'],
    },
  },
}

export function getVerifiedNumberedGeometrySolution(solution: HomeworkSolution): HomeworkSolution | null {
  if (solution.source !== 'number' || solution.textbookId !== 'geometry') return null
  const verified = verifiedGeometrySolutions[solution.task]
  if (!verified) return null

  return {
    ...solution,
    given: [...verified.given],
    goal: verified.goal,
    steps: [...verified.steps],
    answer: verified.answer,
    diagram: verified.diagram,
    sourceVerified: true,
  }
}
