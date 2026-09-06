/* Живая проба моделей на предмете.

   Гоняет ПОЛНЫЙ запрос решателя — со строгой схемой, промптом предмета и
   проверкой качества — по каждой модели и печатает время, ответ и цену.
   Нужна, когда меняется голова пула в `server/homeworkModels.ts`: «эта
   модель решает предмет лучше» проверяется замером, а не рассуждением.

   Голый вопрос моделью проходится совсем не так, как запрос решателя:
   5 сентября gpt-5-6-terra отвечала на комбинаторику верно за 69 секунд, а
   под решателем — 201 секунду и неверно. Поэтому проба гоняет решатель.

   Запуск (ключ берётся из .env.local):

     node --experimental-strip-types scripts/probe-subject-models.mjs
     node --experimental-strip-types scripts/probe-subject-models.mjs --subject Математика
     node --experimental-strip-types scripts/probe-subject-models.mjs \
       --subject Физика --models gpt-5-6-sol,gemini-3-6-flash-openai
     node --experimental-strip-types scripts/probe-subject-models.mjs \
       --subject Алгебра --condition "Решите уравнение ..." --expect "x = 4"

   Каждый вызов стоит денег: цена печатается по остатку кредитов KIE. */
import { readFileSync } from 'node:fs'
import { homeworkModelsForSubject, solveHomeworkWithReview, validateSolutionQuality }
  from '../server/geometrySolutionEngine.ts'
import { verifySubjectRules } from '../server/subjectRules.ts'
import { findSubjectByName } from '../src/lib/subjects.ts'

const args = new Map()
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index]
  if (argument.startsWith('--')) args.set(argument.slice(2), process.argv[index + 1] ?? '')
}

const apiKey = readFileSync('.env.local', 'utf8').match(/^KIE_API_KEY=(.+)$/mu)?.[1].trim()
if (!apiKey) throw new Error('KIE_API_KEY не найден в .env.local')

/* Задача по умолчанию для каждого предмета: одна, зато с известным ответом.
   Комбинаторика проверена перебором (9744 и 29/405), ромб — школьной
   теоремой Пифагора (13 см), остальные считаются в одно-два действия. */
const probeTasks = {
  'Математика': {
    grade: '8 класс',
    condition: 'Из цифр 0-9 составляют шестизначные числа без повторяющихся цифр, первая цифра не 0. '
      + 'Найти: количество чисел, делящихся на 15; вероятность того, что случайное такое число делится на 15.',
    expect: '9744',
  },
  'Алгебра': {
    grade: '9 класс',
    condition: 'Найдите сумму всех целых решений неравенства x^2 - 7x + 10 < 0.',
    expect: '7',
  },
  'Геометрия': {
    grade: '8 класс',
    condition: 'Диагонали ромба ABCD равны 10 см и 24 см. Постройте чертёж и найдите сторону ромба.',
    expect: '13',
  },
  'Физика': {
    grade: '8 класс',
    condition: 'Определите количество теплоты при полном сгорании 200 г спирта. '
      + 'Удельная теплота сгорания спирта 2,7·10^7 Дж/кг.',
    expect: '5,4',
  },
  'Химия': {
    grade: '8 класс',
    condition: 'К 200 г 10-процентного раствора хлорида бария добавили избыток серной кислоты. '
      + 'Найдите массу выпавшего осадка.',
    expect: '22,4',
  },
  'Биология': {
    grade: '9 класс',
    condition: 'Скрещиваются два гетерозиготных растения гороха с жёлтыми семенами (Aa). '
      + 'Определите долю растений с зелёными семенами в потомстве.',
    expect: '25',
  },
  'Информатика': {
    grade: '8 класс',
    condition: 'Сколько единиц содержит двоичная запись числа 200?',
    expect: '3',
  },
  'Русский язык': {
    grade: '5 класс',
    condition: 'Сколько букв и сколько звуков в слове «ёлка»? Объясните расхождение.',
    expect: '5',
  },
  'Литература': {
    grade: '9 класс',
    condition: 'Определите стихотворный размер строки «Мой дядя самых честных правил» и объясните разбор.',
    expect: 'ямб',
  },
  'Английский язык': {
    grade: '6 класс',
    condition: 'Раскройте скобки и объясните выбор формы: He (to go) to school every day.',
    expect: 'goes',
  },
  'История': {
    grade: '6 класс',
    condition: 'В каком году произошло Ледовое побоище и чем оно закончилось?',
    expect: '1242',
  },
  'Обществознание': {
    grade: '9 класс',
    condition: 'Назовите три ветви государственной власти в Российской Федерации и приведите по одному органу каждой.',
    expect: 'судебн',
  },
  'География': {
    grade: '8 класс',
    condition: 'В Москве (UTC+3) 10 часов. Определите поясное время в Иркутске (UTC+8).',
    expect: '15',
  },
  'Астрономия': {
    grade: '11 класс',
    condition: 'Годичный параллакс звезды равен 0,1 секунды дуги. Найдите расстояние до звезды в парсеках.',
    expect: '10',
  },
}

const subject = args.get('subject') || 'Математика'
const known = findSubjectByName(subject)
if (!known) throw new Error(`Предмет «${subject}» не из списка solvableSubjects`)

const probe = probeTasks[known.name]
const condition = args.get('condition') || probe?.condition
if (!condition) throw new Error(`Для предмета «${known.name}» нет задачи по умолчанию — задай --condition`)
const expect = args.has('expect') ? args.get('expect') : (probe?.expect ?? '')
const grade = args.get('grade') || probe?.grade || '8 класс'
const models = args.has('models')
  ? args.get('models').split(',').map((model) => model.trim()).filter(Boolean)
  : homeworkModelsForSubject(known.name)

const credits = async () => {
  const response = await fetch('https://api.kie.ai/api/v1/chat/credit', {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  return (await response.json()).data
}

console.log(`Предмет: ${known.name} · ${grade}`)
console.log(`Задача: ${condition}`)
console.log(`Ожидаемый ответ содержит: ${expect || '(не проверяем)'}`)
console.log(`Модели: ${models.join(', ')}\n`)

for (const model of models) {
  const startedAt = Date.now()
  const before = await credits()
  const stages = []
  try {
    const solution = await solveHomeworkWithReview({
      textbookId: known.id,
      task: condition.slice(0, 60),
      source: 'text',
      subject: known.name,
      grade,
      textbookTitle: 'Любой учебник',
      authors: 'Проба моделей',
      edition: 'по тексту',
      condition,
      idempotencyKey: `probe-${model}-${Date.now()}`,
    }, {
      apiKey,
      model,
      onStage: (stage) => stages.push(`${stage}@${((Date.now() - startedAt) / 1000).toFixed(0)}с`),
    })
    const seconds = (Date.now() - startedAt) / 1000
    await new Promise((resolve) => { setTimeout(resolve, 2000) })
    const spent = before - await credits()
    const issues = [...validateSolutionQuality(solution), ...verifySubjectRules(solution)]
    const correct = !expect || solution.answer.toLocaleLowerCase('ru-RU').includes(expect.toLocaleLowerCase('ru-RU'))
    console.log(`=== ${model}: ${seconds.toFixed(0)} с · ${spent.toFixed(2)} кр ≈ ${(spent * 0.5).toFixed(2)} ₽ · ${correct ? 'ВЕРНО' : 'НЕВЕРНО'} ===`)
    console.log(`стадии: ${stages.join(' → ')}`)
    console.log(`объяснение: ${solution.explanation?.join(' | ') ?? '(нет)'}`)
    console.log(`решение: ${solution.steps.join(' | ')}`)
    console.log(`ответ: ${solution.answer}`)
    if (issues.length > 0) console.log(`замечания проверки: ${issues.join('; ')}`)
    console.log('')
  } catch (error) {
    const seconds = (Date.now() - startedAt) / 1000
    await new Promise((resolve) => { setTimeout(resolve, 2000) })
    const spent = before - await credits()
    console.log(`=== ${model}: ${seconds.toFixed(0)} с · ${spent.toFixed(2)} кр — ОТКАЗ ===`)
    console.log(`стадии: ${stages.join(' → ') || '(нет)'}`)
    console.log(`${String(error)}\n`)
  }
}
