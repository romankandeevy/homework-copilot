import { homeworkSolutionForm } from '../lib/homeworkContract'
import type { HomeworkSolution, HomeworkTaskType } from '../lib/homeworkContract'
import { notebookBlocks } from './systemOfEquations'

/* Как строка решения ложится на лист.

   Аудит владельца 15 сентября 2026 (14 предметов, восьмиклассник читал
   каждую запись): ответы верны все четырнадцать, а запись «страдает».
   Здесь собрано то, что лист решает сам, без модели:

   - дробь «(x² - 9)/(x - 3)» пишется столбиком, а не в строку;
   - у столбика алгебры и у таблицы информатики номеров строк нет -
     «ни одно уравнение нигде не решается по действиям»;
   - развёрнутый ответ идёт абзацами без «Решение» и «Ответ»: «это не
     задача, ответ и есть решение, не надо его дублировать»;
   - у физики «Дано» с «Найти» слева, СИ рядом, решение справа от черты;
   - две строки через « | » - таблица деления при переводе в другую
     систему счисления. */

/* Нумерует лист только запись по действиям: математика, физика, химия,
   геометрия. Столбик алгебры и таблица информатики идут без номеров,
   развёрнутый ответ - абзацами. */
export function numberedSteps(subject: string, taskType: HomeworkTaskType = 'mixed') {
  if (homeworkSolutionForm(subject, taskType) === 'essay') return false
  const normalized = subject.toLocaleLowerCase('ru-RU')
  return !normalized.includes('алгебр') && !normalized.includes('информат')
}

/* Таблица деления: две и больше строк подряд с клетками через « | ».
   Пометка «|:2» у неравенства - одна черта и одна клетка, под таблицу
   не попадает. */
const tableRowPattern = /\s\|\s/u

export type StepBlock =
  | { kind: 'table'; rows: string[][] }
  | { kind: 'line'; line: string }

export function stepBlocks(steps: readonly string[]): StepBlock[] {
  const blocks: StepBlock[] = []
  let rows: string[][] = []
  const flush = () => {
    if (rows.length >= 2) blocks.push({ kind: 'table', rows })
    else for (const row of rows) blocks.push({ kind: 'line', line: row.join(' | ') })
    rows = []
  }
  for (const step of steps) {
    const cells = step.split(tableRowPattern).map((cell) => cell.trim())
    if (cells.length >= 3) {
      rows.push(cells)
      continue
    }
    flush()
    blocks.push({ kind: 'line', line: step })
  }
  flush()
  return blocks
}

/* Физика, астрономия и химия с «Дано»: раскладка «Дано | СИ ‖ Решение».
   У остальных предметов шапка идёт над решением. */
export function sideBySideLayout(subject: string, given: readonly string[]) {
  if (given.length === 0) return false
  const normalized = subject.toLocaleLowerCase('ru-RU')
  return ['физик', 'астроном', 'хими'].some((entry) => normalized.includes(entry))
}

/* Строка «Дано» с переводом в СИ: «m = 1,5 т = 1500 кг» - в «Дано» идёт
   «m = 1,5 т», в столбик СИ - «1500 кг». Без второго равенства столбик
   СИ у строки пуст. */
export function givenWithSi(line: string): { given: string; si: string } {
  const parts = line.split(/\s=\s/u)
  if (parts.length < 3) return { given: line, si: '' }
  return { given: `${parts[0]} = ${parts[1]}`, si: parts.slice(2).join(' = ') }
}

/* Текст для «Скопировать решение»: та же запись, что на листе.

   Копию переписывают в тетрадь и сдают. Разбор «Что нужно понять» -
   конспект для себя, в работе для учителя ему места нет. Заголовки,
   номера и «Ответ» повторяют лист: у развёрнутого ответа их нет, у
   столбика алгебры нет номеров. */
export function solutionCopyText(source: HomeworkSolution) {
  const essay = homeworkSolutionForm(source.subject, source.taskType) === 'essay'
  const numbered = numberedSteps(source.subject, source.taskType)
  const showGoal = source.given.length > 0 || source.goal.title !== 'Найти'
  let lineNumber = 0
  const steps = stepBlocks(source.steps).flatMap((block) => {
    if (block.kind === 'table') return block.rows.map((row) => row.join(' | '))
    lineNumber += 1
    return [numbered ? `${lineNumber}) ${block.line}` : block.line]
  })

  return [
    'Условие: ' + source.condition,
    ...(source.given.length > 0
      ? ['Дано:', ...notebookBlocks(source.given, source.condition).flatMap((block) => (
          // В текстовой копии скобку рисует сам знак: система должна
          // остаться системой и после «Скопировать».
          block.kind === 'system'
            ? block.lines.map((line, index) => `${index === 0 ? '{ ' : '  '}${line}`)
            : [block.line]
        ))]
      : []),
    ...(showGoal ? [source.goal.title + ': ' + source.goal.text] : []),
    ...(essay ? [] : [source.goal.title === 'Доказать' ? 'Доказательство:' : 'Решение:']),
    ...steps,
    // Программа копируется отдельным блоком и без нумерации: её вставляют
    // в редактор и запускают, а не переписывают в тетрадь построчно.
    ...(source.code?.text ? ['', 'Программа:', source.code.text] : []),
    ...(source.answer && !essay ? ['Ответ: ' + source.answer] : []),
  ].join('\n')
}
