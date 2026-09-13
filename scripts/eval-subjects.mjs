/* Пакетная проверка качества решений по всем предметам.

   scripts/probe-subject-models.mjs сравнивает модели между собой на одной
   задаче предмета - это правильный инструмент, когда решаешь, какая модель
   должна возглавить пул. Здесь другая задача: понять, не отвалилось ли
   качество решений вообще - после смены промпта, модели или проверки, -
   не перечитывая руками ответ на каждую задачу по каждому предмету.

   Гоняет РЕАЛЬНЫЙ путь решателя (solveHomeworkWithReview) с тем пулом
   моделей, который используется в проде для предмета - без --models,
   отказ первой модели уходит в перебор пула точно так же, как у живого
   ученика. Каждая задача - реальный вызов модели и реальные деньги.

   Запуск (ключ берётся из .env.local):

     node --experimental-strip-types scripts/eval-subjects.mjs
     node --experimental-strip-types scripts/eval-subjects.mjs --subject Алгебра
     node --experimental-strip-types scripts/eval-subjects.mjs --out scripts/eval/results/2026-09-12.json

   Результат - таблица в консоли и подробный JSON в scripts/eval/results/:
   по каждой задаче verdict (ответ совпал с эталоном или нет), список
   замечаний проверки качества (validateSolutionQuality/verifySubjectRules),
   время и потраченные кредиты. Смотреть нужно только на красные строки -
   зелёные не перечитывать. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homeworkModelsForSubject, solveHomeworkWithReview, validateSolutionQuality }
  from '../server/geometrySolutionEngine.ts'
import { verifySubjectRules } from '../server/subjectRules.ts'
import { findSubjectByName } from '../src/lib/subjects.ts'
import { subjectTasks } from './eval/tasks.mjs'
import { answerMatchesExpectation } from './eval/compareAnswer.mjs'

const args = new Map()
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index]
  if (argument.startsWith('--')) args.set(argument.slice(2), process.argv[index + 1] ?? '')
}

const apiKey = readFileSync('.env.local', 'utf8').match(/^KIE_API_KEY=(.+)$/mu)?.[1].trim()
if (!apiKey) throw new Error('KIE_API_KEY не найден в .env.local')

const subjectFilter = args.get('subject')
const subjectNames = subjectFilter ? [subjectFilter] : Object.keys(subjectTasks)
for (const name of subjectNames) {
  if (!findSubjectByName(name)) throw new Error(`Предмет «${name}» не из списка solvableSubjects`)
  if (!subjectTasks[name]) throw new Error(`Для предмета «${name}» нет задач в scripts/eval/tasks.mjs`)
}

const credits = async () => {
  const response = await fetch('https://api.kie.ai/api/v1/chat/credit', {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  return (await response.json()).data
}

const results = []
let passCount = 0
let failCount = 0

for (const subjectName of subjectNames) {
  const subject = findSubjectByName(subjectName)
  const tasks = subjectTasks[subjectName]
  console.log(`\n=== ${subjectName} (пул: ${homeworkModelsForSubject(subjectName).join(', ')}) ===`)

  for (const [index, task] of tasks.entries()) {
    const label = `${subjectName} #${index + 1}`
    const startedAt = Date.now()
    // eslint-disable-next-line no-await-in-loop
    const before = await credits()

    try {
      // eslint-disable-next-line no-await-in-loop
      const solution = await solveHomeworkWithReview({
        textbookId: subject.id,
        task: task.condition.slice(0, 60),
        source: 'text',
        subject: subjectName,
        grade: task.grade,
        textbookTitle: 'Любой учебник',
        authors: 'Регрессия по предметам',
        edition: 'по тексту',
        condition: task.condition,
        idempotencyKey: `eval-${subjectName}-${index}-${Date.now()}`,
      }, { apiKey })

      const seconds = (Date.now() - startedAt) / 1000
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => { setTimeout(resolve, 2000) })
      // eslint-disable-next-line no-await-in-loop
      const spent = before - await credits()
      const issues = [...validateSolutionQuality(solution), ...verifySubjectRules(solution)]
      const correct = answerMatchesExpectation(task.expect, solution.answer)
      if (correct) passCount += 1; else failCount += 1

      console.log(`${correct ? 'ВЕРНО ' : 'НЕВЕРНО'} · ${label} · ${seconds.toFixed(0)} с · ${spent.toFixed(2)} кр`
        + (issues.length > 0 ? ` · замечаний: ${issues.length}` : ''))
      if (!correct) console.log(`  ожидали «${task.expect}», получили «${solution.answer}»`)
      if (issues.length > 0) console.log(`  ${issues.join('; ')}`)

      results.push({
        subject: subjectName, index, grade: task.grade, condition: task.condition,
        expect: task.expect, answer: solution.answer, correct, issues, seconds, creditsSpent: spent,
      })
    } catch (error) {
      failCount += 1
      const seconds = (Date.now() - startedAt) / 1000
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => { setTimeout(resolve, 2000) })
      // eslint-disable-next-line no-await-in-loop
      const spent = before - await credits()
      console.log(`ОТКАЗ  · ${label} · ${seconds.toFixed(0)} с · ${spent.toFixed(2)} кр · ${String(error)}`)
      results.push({
        subject: subjectName, index, grade: task.grade, condition: task.condition,
        expect: task.expect, error: String(error), correct: false, seconds, creditsSpent: spent,
      })
    }
  }
}

const total = passCount + failCount
console.log(`\nИтого: ${passCount} из ${total} прошли проверку ответа`
  + (failCount > 0 ? ` · ${failCount} нет - смотри их выше` : ''))

const outPath = args.get('out') || `scripts/eval/results/${new Date().toISOString().replace(/[:.]/gu, '-')}.json`
mkdirSync('scripts/eval/results', { recursive: true })
writeFileSync(outPath, JSON.stringify({ ranAt: new Date().toISOString(), passCount, failCount, results }, null, 2))
console.log(`Подробный отчёт: ${outPath}`)
