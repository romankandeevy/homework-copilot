import { homeworkSolutionForm } from '../lib/homeworkContract'
import type { HomeworkSolution } from '../lib/homeworkContract'
import { keyed } from '../lib/listKeys'
import { WrittenAnalysis } from '../solution/WrittenAnalysis'
import { NumberLineFigure } from './geometry/NumberLineScene'
import { NotebookDiagram } from './NotebookDiagram'
import { numberLineParts } from './numberLineParts'
import { NotebookText } from './NotebookLine'
import { givenWithSi, numberedSteps, sideBySideLayout, stepBlocks } from './notebookText'
import { notebookBlocks } from './systemOfEquations'

/* Готовая запись для тетради.

   Решение оформлено тетрадной страницей - той же, что обещана на витрине:
   бумага, клетка, красное поле. Лист один на все предметы, а вид записи
   выбирает предмет и тип задачи:

   - запись по действиям (математика, геометрия) - «Дано» и «Найти» над
     чертой, пронумерованные строки, «Ответ»;
   - столбик (алгебра, информатика) - те же зоны, но без номеров строк;
   - физика, астрономия, химия с «Дано» - «Дано» с «Найти» слева, столбик
     СИ рядом, решение справа от вертикальной черты, «Ответ» внизу;
   - развёрнутый ответ (литература, история, обществознание, биология,
     русский, английский) - абзацы как есть, без «Решение» и «Ответ».

   Черта под шапкой рисуется только там, где есть «Дано»: без него цель
   поднимается на его место и черта не нужна (AGENTS.md, контракт листа).
   Аудит 15 сентября нашёл черту над решением у всех предметов подряд -
   и там, где над ней не было ничего. */

/* Пункты задания вместо номеров.

   Задание «сравните: а) … б) … в) …» приходит строками, размеченными
   буквами. Своя нумерация поверх них - вторая шкала на том же листе. */
const partLabelPattern = /^\s*[а-я]\s*\)/u

/* Задание размечено буквами, если с буквы начинаются хотя бы два пункта.

   Раньше требовалось, чтобы с буквы начиналась каждая строка. Когда
   пункт стал столбиком - «а) 0,7x - 7 > 0», под ним «0,7x > 7 |:0,7» -
   строки без буквы снова включили нумерацию, и задача 863 вышла листом
   «1) а) …  2) 0,7x > 7  3) x > 10»: номера поверх букв. */
function lettered(steps: readonly string[]) {
  return steps.length > 1
    && partLabelPattern.test(steps[0])
    && steps.filter((step) => partLabelPattern.test(step)).length >= 2
}

function SystemBrace() {
  return (
    <svg className="notebook-system-brace" viewBox="0 0 10 100" preserveAspectRatio="none" aria-hidden="true">
      <path
        d="M9 1 C5 1 5 8 5 22 C5 40 1 46 1 50 C1 54 5 60 5 78 C5 92 5 99 9 99"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

function GivenSection({ solution, columns }: { solution: HomeworkSolution; columns: boolean }) {
  // В раскладке физики перевод в СИ уходит в свой столбик.
  const lines = columns ? solution.given.map((line) => givenWithSi(line).given) : solution.given
  return (
    <section className="notebook-sheet-given">
      <h2>Дано:</h2>
      {keyed(notebookBlocks(lines, solution.condition), (block) => (
        block.kind === 'system' ? block.lines.join('|') : block.line
      )).map(({ key, item: block }) => (block.kind === 'system'
        ? (
          <div className="notebook-system" key={key} role="group" aria-label="Система уравнений">
            <SystemBrace />
            <div className="notebook-system-lines">
              {keyed(block.lines, (line) => line).map(({ key: lineKey, item: line }) => <p key={lineKey}><NotebookText text={line} /></p>)}
            </div>
          </div>
        )
        : <p key={key}><NotebookText text={block.line} /></p>))}
    </section>
  )
}

function StepsSection({ solution }: { solution: HomeworkSolution }) {
  const essay = homeworkSolutionForm(solution.subject, solution.taskType) === 'essay'
  const numbered = numberedSteps(solution.subject, solution.taskType)
  const withLetters = lettered(solution.steps)
  const blocks = stepBlocks(solution.steps)
  const classes = [withLetters ? 'is-lettered' : '', numbered ? '' : 'is-column'].filter(Boolean).join(' ')

  return (
    <section className="notebook-sheet-steps">
      {/* У доказательства в тетради пишут «Доказательство»: по заголовку
          видно, что от записи требуется. Развёрнутый ответ заголовка не
          носит: «это не задача, ответ и есть решение». */}
      {!essay && <h2>{solution.goal.title === 'Доказать' ? 'Доказательство' : 'Решение'}</h2>}
      {essay
        ? (
          /* Развёрнутый ответ - абзацы, а не нумерованный список.

             Сочинение по литературе на четыре абзаца, разложенное по
             пунктам «1) 2) 3)», читается как план, а не как ответ. */
          <div className="notebook-sheet-prose">
            {keyed(solution.steps, (step) => step).map(({ key, item: step }) => (
              <p key={key}>{step}</p>
            ))}
          </div>
        )
        : (
          /* Нумерацию ставит страница - там, где запись идёт по действиям.
             Задание из пунктов уже размечено буквами: а), б), в); столбик
             алгебры и таблица информатики номеров не носят. */
          <ol className={classes || undefined}>
            {keyed(blocks, (block) => (block.kind === 'table' ? block.rows.map((row) => row.join('|')).join('/') : block.line)).map(({ key, item: block }) => {
              if (block.kind === 'table') {
                return (
                  <li className="is-table" key={key}>
                    <table className="notebook-table">
                      <tbody>
                        {keyed(block.rows, (row) => row.join('|')).map(({ key: rowKey, item: row }) => (
                          <tr key={rowKey}>
                            {keyed(row, (cell) => cell).map(({ key: cellKey, item: cell }) => <td key={cellKey}><NotebookText text={cell} /></td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </li>
                )
              }
              /* Строка без буквы - продолжение пункта: в тетради она
                 стоит под выражением, а не под буквой. */
              const continued = withLetters && !partLabelPattern.test(block.line)
              return (
                <li className={continued ? 'is-continued' : undefined} key={key}>
                  <NotebookText text={block.line} />
                </li>
              )
            })}
          </ol>
        )}
    </section>
  )
}

export function NotebookSheet({ solution }: { solution: HomeworkSolution }) {
  const essay = homeworkSolutionForm(solution.subject, solution.taskType) === 'essay'
  /* Задание из пунктов а)-г) с координатными прямыми верстается по
     пунктам: столбик преобразований, под ним прямая, под ней ответ. Если
     разложить решение по пунктам не вышло, лист остаётся прежним. */
  const solutionParts = numberLineParts(solution)
  const columns = solutionParts.length === 0 && sideBySideLayout(solution.subject, solution.given)
  const siColumn = columns && solution.given.some((line) => givenWithSi(line).si)
  /* «Найти» без «Дано» в тетради не пишут: пример и неравенство
     записывают сразу решением. 863 вышла с «Найти: Определить значения x
     для каждого из четырёх условий» - строкой ни о чём над столбиком.
     «Доказать» и «Построить» остаются всегда. */
  const showGoal = solution.given.length > 0 || solution.goal.title !== 'Найти'
  const hasDiagram = solutionParts.length === 0 && solution.diagram.kind !== 'none'
  const showHead = solution.given.length > 0 || showGoal || hasDiagram

  const headText = (
    <div className="notebook-sheet-head-text">
      {solution.given.length > 0 && <GivenSection solution={solution} columns={columns} />}
      {showGoal && (
        <section className="notebook-sheet-goal">
          <h2>{solution.goal.title}:</h2>
          <p><NotebookText text={solution.goal.text} /></p>
        </section>
      )}
    </div>
  )

  const diagram = hasDiagram ? <NotebookDiagram diagram={solution.diagram} /> : null

  const steps = solutionParts.length > 0
    ? (
      <section className="notebook-sheet-steps">
        <h2>Решение</h2>
        <div className="notebook-parts">
          {keyed(solutionParts, (part) => `part-${part.label}`).map(({ key, item: part }) => (
            <div className="notebook-part" key={key}>
              <div className="notebook-part-steps">
                {keyed(part.steps, (step) => step).map(({ key: stepKey, item: step }) => (
                  <p key={stepKey}><NotebookText text={step} /></p>
                ))}
              </div>
              <NumberLineFigure line={part.line} description={solution.diagram.description} />
              {part.answer && <p className="notebook-part-answer">Ответ: {part.answer}</p>}
            </div>
          ))}
        </div>
      </section>
    )
    : <StepsSection solution={solution} />

  return (
    <article className="notebook-sheet" aria-label="Готовая запись для тетради">
      <span className="notebook-sheet-grid" aria-hidden="true" />
      <span className="notebook-sheet-margin" aria-hidden="true" />
      <div className="notebook-sheet-body">
        {columns
          ? (
            /* Физика: «Дано» и «Найти» слева, столбик СИ рядом, решение
               справа от вертикальной черты - так учат оформлять в 7-9
               классах, и так владелец описал раскладку 15 сентября. */
            <div className="notebook-sheet-columns">
              <div className="notebook-sheet-known">
                {headText}
                {siColumn && (
                  <section className="notebook-sheet-si" aria-label="Перевод в СИ">
                    <h2>СИ</h2>
                    {keyed(solution.given, (line) => line).map(({ key, item: line }) => (
                      <p key={key}>{givenWithSi(line).si ? <NotebookText text={givenWithSi(line).si} /> : ' '}</p>
                    ))}
                  </section>
                )}
              </div>
              <div className="notebook-sheet-work">
                {diagram}
                {steps}
              </div>
            </div>
          )
          : (
            <>
              {/* Шапка листа как в тетради: «Дано» и «Найти» слева, чертёж
                  справа от них, а не под ними. 7 сентября схема цепи встала
                  под «Найти» посреди листа, и решение уехало вниз. */}
              {showHead && (
                <div className={`notebook-sheet-head${hasDiagram ? ' notebook-sheet-head-with-diagram' : ''}`}>
                  {headText}
                  {diagram}
                </div>
              )}
              {/* Черта между «Дано» и решением - как в тетради, во всю
                  рабочую ширину. Без «Дано» её нет. */}
              {solution.given.length > 0 && <span className="notebook-sheet-divider" aria-hidden="true" />}
              {steps}
            </>
          )}
        {/* Программа - не строка тетради.

            7 сентября информатика вернула код на Python, втиснутый в две
            строки листа: «Python: count = {0:1}; s = 0; ans = 0». Класть
            его было некуда. Теперь у него своё поле и свой блок:
            моноширинный, с отступами, с прокруткой внутри себя - лист по
            ширине он не растягивает. */}
        {solution.code?.text && (
          <section className="notebook-sheet-code">
            <h2>Программа</h2>
            <pre><code>{solution.code.text}</code></pre>
          </section>
        )}
        {solution.analysis && (
          <section className="notebook-sheet-analysis">
            <WrittenAnalysis analysis={solution.analysis} />
          </section>
        )}
        {/* У развёрнутого ответа «Ответа» нет: абзацы выше и есть ответ,
            вторая копия - дубль. */}
        {solution.answer && !essay && (
          <section className="notebook-sheet-answer">
            <h2>Ответ:</h2>
            <p><NotebookText text={solution.answer} /></p>
          </section>
        )}
      </div>
    </article>
  )
}
