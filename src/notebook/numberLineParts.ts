import type { HomeworkNumberLine, HomeworkSolution } from '../lib/homeworkContract'

/* Пункт задания: свой столбик преобразований, свой ответ, своя прямая.

   В тетради у задания из пунктов а)-г) прямая стоит не общим блоком
   наверху листа, а напротив своего пункта, рядом с его ответом. Чтобы так
   сверстать, строки решения надо разложить по пунктам: первая строка
   пункта помечена буквой, следующие - его же преобразования без буквы.

   Ответ пункта модель отдаёт вместе с прямой. У решений, сохранённых до
   этого поля, он вынимается из общего ответа: там пункты перечислены
   через «;» с теми же буквами. */

export type NumberLinePart = {
  label: string
  steps: string[]
  line: HomeworkNumberLine['lines'][number]
  answer: string
}

const partLabel = /^\s*([а-я])\s*\)\s*/u

const labelLetter = (value: string) => partLabel.exec(value)?.[1]
  ?? (/^\s*([а-я])\s*\)?\s*$/u.exec(value)?.[1] ?? '')

/* «а) x ∈ (-2,5; +∞); б) x ∈ (2/7; +∞)» - в ответ по букве пункта.

   Резать по «;» нельзя: точка с запятой стоит и внутри самого промежутка,
   и ответ обрывался на «x ∈ (-2,5». Границей служит только та точка с
   запятой, за которой идёт буква следующего пункта. */
export function answersByPart(answer: string) {
  const parts = new Map<string, string>()
  const marks = [...answer.matchAll(/(?:^|[;.]\s*)([а-я])\s*\)\s*/gu)]
  for (const [index, mark] of marks.entries()) {
    const from = (mark.index ?? 0) + mark[0].length
    const to = index + 1 < marks.length ? marks[index + 1].index ?? answer.length : answer.length
    parts.set(mark[1], answer.slice(from, to).trim().replace(/[.;]+$/u, ''))
  }
  return parts
}

export function numberLineParts(solution: HomeworkSolution): NumberLinePart[] {
  const lines = solution.diagram.kind === 'number-line' ? solution.diagram.numberLine?.lines ?? [] : []
  if (lines.length === 0) return []

  const groups: { label: string; steps: string[] }[] = []
  for (const step of solution.steps) {
    if (partLabel.test(step) || groups.length === 0) {
      groups.push({ label: labelLetter(step), steps: [step] })
      continue
    }
    groups[groups.length - 1].steps.push(step)
  }

  const answers = answersByPart(solution.answer)
  const parts = groups.flatMap((group, index) => {
    /* Прямая ищется по букве пункта, а не по порядку: модель может не
       нарисовать прямую там, где её не требуется, и порядок разъедется. */
    const line = lines.find((entry) => labelLetter(entry.label) === group.label)
      ?? (groups.length === 1 && lines.length === 1 ? lines[0] : undefined)
      ?? (groups.length === lines.length ? lines[index] : undefined)
    if (!line) return []
    return [{
      label: group.label,
      steps: group.steps,
      line,
      answer: line.answer || answers.get(group.label) || '',
    }]
  })

  // Разложить удалось только целиком: половина пунктов у своей прямой, а
  // половина без неё читается хуже, чем общий блок прямых наверху.
  return parts.length === groups.length && parts.length === lines.length ? parts : []
}
