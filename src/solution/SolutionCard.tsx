import { CodeSimple, PencilRuler } from '@phosphor-icons/react'
import { homeworkSolutionForm } from '../lib/homeworkContract'
import type { HomeworkSolution } from '../lib/homeworkContract'
import { keyed } from '../lib/listKeys'
import './SolutionCard.css'

/* Карточка решения в списке.

   Раньше решение в списке было строкой: значок предмета, номер задачи,
   время. Чтобы понять, что там, приходилось открывать. Карточка отвечает
   на три вопроса до открытия: что за задача, как выглядит запись, какой
   ответ.

   Каждая часть занимает ровно столько строк, сколько ей отведено: условие
   три, запись три, ответ две. Что не влезло, обрезается по слову
   многоточием - никаких полустрок и затуханий: половина строки читается как
   обрыв, а не как «есть ещё». Вместо тумана внизу честная цифра «ещё 12
   строк». Раскрыть на месте нельзя - вся карточка открывает решение. */

const previewLines = 3

export function SolutionCard({ solution, subject, time, onOpen }: {
  solution: HomeworkSolution
  subject: string
  time: string
  onOpen: () => void
}) {
  const essay = homeworkSolutionForm(solution.subject, solution.taskType) === 'essay'
  const hasDiagram = solution.diagram.kind !== 'none'
  const code = solution.code?.text.trim() ?? ''
  const codeLines = code ? code.split('\n') : []

  /* Что показать в записи: программу, если она есть, иначе первые шаги.
     Программа интереснее шагов - по информатике шаги описывают алгоритм
     словами, а узнают задачу по коду. */
  const lines = codeLines.length > 0 ? codeLines : solution.steps
  const shown = lines.slice(0, previewLines)
  const rest = lines.length - shown.length
  const restLabel = rest <= 0
    ? ''
    : codeLines.length > 0 || !essay
      ? `ещё ${rest} ${pluralize(rest, 'строка', 'строки', 'строк')}`
      : `ещё ${rest} ${pluralize(rest, 'абзац', 'абзаца', 'абзацев')}`

  return (
    <button className="solution-card" type="button" onClick={onOpen}>
      <span className="solution-card-head">
        <span className="solution-card-subject">{subject}</span>
        {hasDiagram && (
          <span className="solution-card-chip" title="В решении есть чертёж">
            <PencilRuler size={12} weight="bold" aria-hidden="true" />
            чертёж
          </span>
        )}
        {code && (
          <span className="solution-card-chip" title="В решении есть программа">
            <CodeSimple size={12} weight="bold" aria-hidden="true" />
            {solution.code?.language || 'код'}
          </span>
        )}
        <time>{time}</time>
      </span>

      <span className="solution-card-condition">
        <span>{solution.condition}</span>
      </span>

      <span className={`solution-card-preview${codeLines.length > 0 ? ' is-code' : essay ? ' is-prose' : ''}`}>
        <span className="solution-card-lines">
          {keyed(shown, (line) => line).map(({ key, item: line }) => (
            <span key={key}>{codeLines.length > 0 ? line : line.replace(/^\s*\d{1,2}[).]\s+/u, '')}</span>
          ))}
        </span>
        {restLabel && <span className="solution-card-more">{restLabel}</span>}
      </span>

      <span className="solution-card-answer">
        <span className="solution-card-answer-label">Ответ:</span>
        <span className="solution-card-answer-value">{solution.answer || 'на листе'}</span>
      </span>
    </button>
  )
}

function pluralize(count: number, one: string, few: string, many: string) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}
