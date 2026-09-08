import { describe, expect, it } from 'vitest'
import type { HomeworkSolution } from '../src/lib/homeworkContract.ts'
import { subjectRuleQuestions, verifySubjectRules } from './subjectRules.ts'

/* Правила предмета — это рецензент.

   Раньше проверять решение шёл третий вызов модели, и шёл он на каждой
   задаче. Школьные требования к записи мнения не требуют: единица измерения
   при ответе либо есть, либо нет. */

function solution(overrides: Partial<HomeworkSolution>): HomeworkSolution {
  return {
    engineVersion: 2,
    textbookId: 'mathematics',
    task: 'Задача',
    source: 'text',
    textbookEdition: 'по фото или тексту',
    sourceUrl: '',
    conditionNormalized: 'условие',
    subject: 'Математика',
    textbookTitle: 'Любой учебник',
    condition: 'Найдите длину маршрута, если турист прошёл 12 км.',
    given: ['12 км'],
    goal: { title: 'Найти', text: 'длину маршрута' },
    explanation: [
      'Задача на части: известна часть пути и её доля от целого маршрута.',
      'Целое находят делением известной части на её долю, а не умножением.',
    ],
    steps: ['12 : 1/4 = 48 км.'],
    answer: '48 км',
    diagram: { kind: 'none', description: '', vertices: [] },
    sourceVerified: true,
    taskType: 'calculation',
    quality: { diagramRequired: false, reviewPassed: true, symbolicShare: 0.9 },
    createdAt: '2026-08-31T12:00:00.000Z',
    ...overrides,
  }
}

describe('правила предмета', () => {
  it('пропускает решение, выполняющее правила', () => {
    expect(verifySubjectRules(solution({}))).toEqual([])
  })

  // Единицы теряются чаще всего, и работа за это снижается.
  it('ловит ответ без единицы измерения', () => {
    expect(verifySubjectRules(solution({ answer: '48' }))).toContain('В ответе нет единицы измерения')
  })

  /* Счётный ответ единицы не имеет. Живой отказ 5 сентября на проде:
     «Сколько сторон имеет выпуклый многоугольник, каждый угол которого
     равен 160°?» - в условии градус есть, у ответа «12» единицы нет. */
  it('не требует единицы у счётного ответа', () => {
    const sides = solution({
      textbookId: 'geometry',
      subject: 'Геометрия',
      condition: 'Сколько сторон имеет выпуклый многоугольник, каждый угол которого равен 160°?',
      goal: { title: 'Найти', text: 'n' },
      steps: ['(n - 2) · 180° = 160° · n', 'n = 12'],
      answer: '12',
    })

    expect(verifySubjectRules(sides)).not.toContain('В ответе нет единицы измерения')
  })

  it('всё ещё требует единицу там, где её спрашивают', () => {
    const length = solution({
      condition: 'Найдите сторону ромба, если его диагонали равны 10 см и 24 см.',
      goal: { title: 'Найти', text: 'AB' },
      steps: ['AB² = 5² + 12²', 'AB = 13 см'],
      answer: '13',
    })

    expect(verifySubjectRules(length)).toContain('В ответе нет единицы измерения')
  })

  it('ловит ответ-отговорку вместо числа', () => {
    const issues = verifySubjectRules(solution({ answer: 'смотри решение' }))
    expect(issues).toContain('В ответе нет найденного числа')
  })

  it('ловит решение без единого вычисления', () => {
    expect(verifySubjectRules(solution({ steps: ['Рассуждаем и получаем ответ.'] })))
      .toContain('В решении нет ни одного вычисления')
  })

  /* Правила зависят от предмета.

     У русского языка нет ни единиц измерения, ни вычислений, зато есть свои
     требования: разобрал по составу — покажи морфемы, спросили способ
     образования — назови его. */
  it('спрашивает с русского языка своё, а не арифметическое', () => {
    const morphology = solution({
      textbookId: 'russian',
      subject: 'Русский язык',
      condition: 'Разберите по составу слово «подоконник» и укажите способ его образования.',
      taskType: 'mixed',
      steps: ['Слово состоит из частей.'],
      answer: 'подоконник',
    })

    const issues = verifySubjectRules(morphology)
    expect(issues).toContain('Способ образования не назван')
    expect(issues).not.toContain('В ответе нет единицы измерения')
  })

  it('не спрашивает способ образования там, где о нём не спрашивали', () => {
    const spelling = solution({
      textbookId: 'russian',
      subject: 'Русский язык',
      condition: 'Спишите текст, вставляя пропущенные буквы.',
      taskType: 'mixed',
      steps: ['Вставляем буквы по правилу.'],
      answer: 'Текст списан.',
    })

    expect(verifySubjectRules(spelling)).toEqual([])
  })

  it('ловит чертёж с кириллическими подписями точек', () => {
    const geometry = solution({
      textbookId: 'geometry',
      subject: 'Геометрия',
      condition: 'В треугольнике ABC найдите AB, если AC = 6 см, BC = 8 см.',
      answer: 'AB = 10 см',
      diagram: { kind: 'three-point-lines', description: 'Треугольник', vertices: ['А', 'B', 'C'] },
    })

    expect(verifySubjectRules(geometry)).toContain('Точки чертежа подписаны кириллицей вместо латиницы')
  })

  // Вопросы уходят в промпт: модель отвечает на них до выдачи решения
  // и сама чинит нарушенное — это дешевле отдельного рецензента.
  it('отдаёт вопросы правил для промпта', () => {
    const questions = subjectRuleQuestions('Химия')
    expect(questions.map((rule) => rule.id)).toContain('equation-balanced')
    expect(questions.every((rule) => rule.question.endsWith('?'))).toBe(true)
  })

  it('у незнакомого предмета остаются только общие правила', () => {
    expect(subjectRuleQuestions('Танцы').map((rule) => rule.id))
      .toEqual(['explanation-explains', 'impossibility-proved', 'parts-not-split', 'answer-answers-question'])
  })
})

/* Лист сдают учителю без разбора, и он обязан читаться сам по себе.

   Прогон 7 сентября: у семи точных предметов ответы верные, а запись
   несдаваемая. Эти правила - ровно про те семь случаев. */
describe('лист самодостаточен', () => {
  it('ловит обозначение, которого никто не вводил', () => {
    // Алгебра с параметром: «g(1) = -a < 0» при том, что g нигде нет.
    const issues = verifySubjectRules(solution({
      subject: 'Алгебра',
      textbookId: 'algebra',
      condition: 'Найти все значения параметра a, при которых уравнение имеет ровно три корня.',
      taskType: 'calculation',
      steps: ['x² - (4 + a)x + 3 = 0', 'g(1) = -a < 0, g(3) = -3a < 0 ⇒ 2 корня'],
      answer: 'a = 4 − 2√3',
    }))
    expect(issues.some((issue) => issue.includes('g(...)'))).toBe(true)
  })

  it('молчит, когда обозначение введено строкой выше', () => {
    const issues = verifySubjectRules(solution({
      subject: 'Алгебра',
      textbookId: 'algebra',
      condition: 'Найти все значения параметра a, при которых уравнение имеет ровно три корня.',
      taskType: 'calculation',
      steps: ['g(x) = x² - (4 + a)x + 3', 'g(1) = -a < 0, g(3) = -3a < 0 ⇒ 2 корня'],
      answer: 'a = 4 − 2√3',
    }))
    expect(issues.some((issue) => issue.includes('g(...)'))).toBe(false)
  })

  it('не требует вводить sin и C(n, k)', () => {
    const issues = verifySubjectRules(solution({
      taskType: 'calculation',
      steps: ['C(9, 4) = 126', 'sin(30°) = 0,5, значит высота равна 6 см'],
      answer: '126',
    }))
    expect(issues.some((issue) => issue.includes('использовано, но нигде не введено'))).toBe(false)
  })

  it('ловит комбинаторику из одной формулы без слов', () => {
    // 7 сентября: весь лист - «A(8,4) = 8 · 7 · 6 · 5 = 1680». Откуда 8 и 4,
    // на листе не сказано, всё рассуждение осталось в разборе.
    const issues = verifySubjectRules(solution({
      taskType: 'calculation',
      condition: 'Из цифр 1-9 составляют пятизначные числа без повторяющихся цифр. Найти количество чисел, кратных 5.',
      given: [],
      steps: ['A(8,4) = 8 · 7 · 6 · 5 = 1680'],
      answer: '1680',
    }))
    expect(issues).toContain('На листе только формула: скажи словами, что считает каждый множитель')
  })

  it('ловит направление без правила левой руки', () => {
    const issues = verifySubjectRules(solution({
      subject: 'Физика',
      textbookId: 'physics',
      taskType: 'calculation',
      condition: 'Стержень скользит по рельсам, B = 0,80 Тл. Найти силу тока и направление силы Ампера.',
      given: ['B = 0,80 Тл', 'R = 0,40 Ом'],
      steps: ['F_A = I · B · L', 'Сила Ампера направлена вертикально вверх', 'I = 5 А'],
      answer: 'I = 5 А, сила Ампера направлена вверх',
    }))
    expect(issues).toContain('Направление указано без обоснования: назови правило левой руки, Ленца или буравчика')
  })

  it('молчит, когда правило названо', () => {
    const issues = verifySubjectRules(solution({
      subject: 'Физика',
      textbookId: 'physics',
      taskType: 'calculation',
      condition: 'Найти направление силы Ампера.',
      given: ['B = 0,80 Тл'],
      steps: ['По правилу левой руки сила Ампера направлена вертикально вверх'],
      answer: 'вертикально вверх',
    }))
    expect(issues.some((issue) => issue.includes('правило левой руки'))).toBe(false)
  })

  it('ловит величину условия, потерянную в «Дано»', () => {
    const issues = verifySubjectRules(solution({
      subject: 'Физика',
      textbookId: 'physics',
      taskType: 'calculation',
      condition: 'Стержень массой 0,20 кг, длиной 0,50 м, R = 0,40 Ом, g = 10 м/с². Найти скорость.',
      given: ['m = 0,20 кг', 'L = 0,50 м', 'R = 0,40 Ом'],
      steps: ['По правилу левой руки сила Ампера направлена вверх', 'v = 5 м/с'],
      answer: 'v = 5 м/с',
    }))
    expect(issues.some((issue) => issue.includes('В «Дано» нет величины'))).toBe(true)
  })

  it('требует программу в своём поле, а не в строках решения', () => {
    // 7 сентября: «Python: count = {0:1}; s = 0; ans = 0» - код втиснут в
    // строку тетради, где нет ни отступов, ни переносов.
    const issues = verifySubjectRules(solution({
      subject: 'Информатика',
      textbookId: 'informatics',
      taskType: 'calculation',
      condition: 'Посчитать количество подмассивов с суммой, кратной k. Решение на Python.',
      given: [],
      steps: ['Python: count = {0:1}; s = 0; ans = 0', 'Ответ на тесте: 6'],
      answer: '6',
    }))
    expect(issues.some((issue) => issue.includes('Программа не приложена'))).toBe(true)
  })

  it('молчит, когда программа лежит в code', () => {
    const issues = verifySubjectRules(solution({
      subject: 'Информатика',
      textbookId: 'informatics',
      taskType: 'calculation',
      condition: 'Посчитать количество подмассивов с суммой, кратной k. Решение на Python.',
      given: [],
      steps: ['Идея: одинаковые остатки префиксных сумм дают подмассив, кратный k', 'На тесте получается 6'],
      code: { language: 'python', text: 'count = {0: 1}\ns = 0\nans = 0' },
      answer: '6',
    }))
    expect(issues.some((issue) => issue.includes('Программа не приложена'))).toBe(false)
  })

  it('ловит разбор одного случая, когда условие просит обосновать все', () => {
    const issues = verifySubjectRules(solution({
      subject: 'Алгебра',
      textbookId: 'algebra',
      taskType: 'calculation',
      condition: 'Найти все значения a, при которых уравнение имеет три корня. Обосновать количество корней при разных a.',
      given: [],
      steps: ['g(x) = x² - 4x + 3', 'D = 0 ⇒ a = 4 - 2√3'],
      answer: 'a = 4 − 2√3',
    }))
    expect(issues.some((issue) => issue.includes('разобран один'))).toBe(true)
  })
})

/* Задача 788 с прода: «зная, что a < b, сравните».

   Четыре пункта, метод во всех один, а на листе двенадцать строк - на
   каждый пункт разность, знак и вывод отдельно. Тетрадь пронумеровала их
   своими 1..12 поверх авторских а)-г). Последний пункт закрыт словами
   «Сравнить невозможно» без единого примера. */
describe('запись не раздувается и не объявляет невозможность', () => {
  const task788 = (steps: string[], answer: string) => solution({
    subject: 'Алгебра',
    textbookId: 'algebra',
    taskType: 'calculation',
    condition: '788. Зная, что a < b, сравните числа: а) a - 1 и b + 6; б) a - 14 и b + 1; в) b + 5 и a - 8; г) a + 2 и b - 6.',
    given: ['a < b'],
    steps,
    answer,
  })

  const split = [
    'а) (a - 1) - (b + 6) = a - b - 7',
    'Так как a < b, то a - b < 0, значит a - b - 7 < 0',
    'a - 1 < b + 6',
    'б) (a - 14) - (b + 1) = a - b - 15',
    'Так как a - b < 0, то a - b - 15 < 0',
    'a - 14 < b + 1',
    'в) (b + 5) - (a - 8) = b - a + 13',
    'Так как a < b, то b - a > 0, значит b - a + 13 > 0',
    'b + 5 > a - 8',
  ]

  const compact = [
    'а) (a - 1) - (b + 6) = a - b - 7 < 0, значит a - 1 < b + 6',
    'б) (a - 14) - (b + 1) = a - b - 15 < 0, значит a - 14 < b + 1',
    'в) (b + 5) - (a - 8) = b - a + 13 > 0, значит b + 5 > a - 8',
  ]

  it('ловит один и тот же ход, расписанный в каждом пункте', () => {
    const issues = verifySubjectRules(task788(split, 'а) a - 1 < b + 6; б) a - 14 < b + 1; в) b + 5 > a - 8'))
    expect(issues.some((issue) => issue.includes('один и тот же ход'))).toBe(true)
  })

  it('молчит, когда пункт занимает одну строку', () => {
    const issues = verifySubjectRules(task788(compact, 'а) a - 1 < b + 6; б) a - 14 < b + 1; в) b + 5 > a - 8'))
    expect(issues.some((issue) => issue.includes('один и тот же ход'))).toBe(false)
  })

  it('не принимает «сравнить невозможно» без примера', () => {
    const issues = verifySubjectRules(task788(
      [...compact, 'г) (a + 2) - (b - 6) = a - b + 8, знак может быть любым'],
      'г) сравнить невозможно',
    ))
    expect(issues.some((issue) => issue.includes('Невозможность заявлена'))).toBe(true)
  })

  it('принимает её с двумя наборами чисел', () => {
    const issues = verifySubjectRules(task788(
      [
        ...compact,
        'г) (a + 2) - (b - 6) = a - b + 8, знак зависит от значений',
        'при a = 0, b = 1: a + 2 = 2 > -5 = b - 6',
        'при a = 0, b = 100: a + 2 = 2 < 94 = b - 6',
      ],
      'г) сравнить нельзя: знак разности меняется',
    ))
    expect(issues.some((issue) => issue.includes('Невозможность заявлена'))).toBe(false)
  })
})
