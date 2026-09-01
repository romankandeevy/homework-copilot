import { describe, expect, it } from 'vitest'
import type { HomeworkSolution } from '../src/lib/homeworkContract.ts'
import { answersAgree, clampNotebookLine, isCurrentReviewedSolution, normalizeNotebookNotation, validateSolutionQuality } from './geometrySolutionEngine.ts'

const taskFiveSolution: HomeworkSolution = {
  engineVersion: 2,
  textbookId: 'geometry',
  task: '5',
  source: 'number',
  textbookEdition: '14-е издание, Просвещение, 2023',
  sourceUrl: '/textbooks/geometry-7-9-atanasyan.pdf',
  sourcePage: 9,
  conditionNormalized: 'task-5-identity',
  subject: 'Геометрия',
  textbookTitle: 'Геометрия. 7-9 классы',
  condition: 'Проведите прямую a и отметьте на ней точки A и B. Отметьте: а) точки M и N, лежащие на отрезке AB; б) точки P и Q, лежащие на прямой a, но не лежащие на отрезке AB; в) точки R и S, не лежащие на прямой a.',
  given: ['A, B ∈ a', 'M, N ∈ [AB]', 'P, Q ∈ a; R, S ∉ a'],
  goal: { title: 'Построить', text: 'P, A, M, N, B, Q; R, S' },
  steps: ['M, N ∈ [AB]; P, Q ∈ a ∖ [AB]; R, S ∉ a.'],
  answer: '',
  diagram: {
    kind: 'construction',
    description: 'Точки на прямой a и вне её.',
    vertices: ['P', 'A', 'M', 'N', 'B', 'Q', 'R', 'S'],
    scene: {
      points: [
        { id: 'P', label: 'P', x: 5, y: 55, visible: true },
        { id: 'A', label: 'A', x: 20, y: 55, visible: true },
        { id: 'M', label: 'M', x: 40, y: 55, visible: true },
        { id: 'N', label: 'N', x: 55, y: 55, visible: true },
        { id: 'B', label: 'B', x: 72, y: 55, visible: true },
        { id: 'Q', label: 'Q', x: 95, y: 55, visible: true },
        { id: 'R', label: 'R', x: 30, y: 18, visible: true },
        { id: 'S', label: 'S', x: 78, y: 18, visible: true },
      ],
      objects: [{ kind: 'line', points: ['P', 'Q'], label: 'a', auxiliary: false }],
      marks: [],
      constraints: [
        { kind: 'collinear', points: ['P', 'A', 'M', 'N', 'B', 'Q'] },
        { kind: 'between', points: ['M', 'A', 'B'] },
        { kind: 'between', points: ['N', 'A', 'B'] },
        { kind: 'not-on-line', points: ['R', 'A', 'B'] },
        { kind: 'not-on-line', points: ['S', 'A', 'B'] },
      ],
    },
  },
  sourceVerified: true,
  taskType: 'construction',
  quality: { diagramRequired: true, reviewPassed: true, symbolicShare: 1 },
  createdAt: '2026-08-26T18:00:00.000Z',
}

/* Длина строки тетради — по предмету.

   Пределы были сняты с геометрии, у которой лист фиксированный, и уезжали
   в русский язык: «Найти: Разобрать слово «подоконник» по составу, указать
   способ его образования и объясн» — обрезано посреди слова. */
/* Сошлись ли проходы в ответе.

   Строгое равенство строк почти никогда не выполнялось, и рецензента звали
   на каждой задаче — 25-50 секунд из 43-78 в замере 31 августа на проде.
   Сравнивать надо по существу: числа с единицами, а не запись. */
describe('согласие проходов в ответе', () => {
  it('считает согласием одно и то же число с подписью величины и без неё', () => {
    expect(answersAgree('AB = 10 см', '10 см')).toBe(true)
    expect(answersAgree('Ответ: 48 км.', '48 км')).toBe(true)
    expect(answersAgree('S = 24 см²', '24 см²')).toBe(true)
  })

  it('не считает согласием разные числа', () => {
    expect(answersAgree('10 см', '12 см')).toBe(false)
    expect(answersAgree('48 км', '48 м')).toBe(false)
  })

  it('сводит запятую и точку в десятичной дроби', () => {
    expect(answersAgree('2,5 кг', '2.5 кг')).toBe(true)
  })

  it('сравнивает набор чисел независимо от порядка', () => {
    expect(answersAgree('AB = 10 см; S = 24 см²', 'S = 24 см², AB = 10 см')).toBe(true)
  })

  // Там, где чисел нет вовсе, остаётся сравнение слов — но уже без хвостовой
  // пунктуации, которой проходы отличаются чаще всего.
  it('сравнивает словесные ответы без хвостовой пунктуации', () => {
    expect(answersAgree('Приставочно-суффиксальный способ.', 'приставочно-суффиксальный способ')).toBe(true)
    expect(answersAgree('Суффиксальный способ', 'Приставочный способ')).toBe(false)
  })

  // У чистого построения ответа нет: сравнивать нечего, но и расхождения нет.
  it('считает согласием два пустых ответа', () => {
    expect(answersAgree('', '')).toBe(true)
    expect(answersAgree('', '10 см')).toBe(false)
  })

  /* Подписи величин выбрасывать нельзя.

     Без них «AB = 10 см» сходится с «10 см» — это и нужно. Но вместе с ними
     сошлись бы и перепутанные местами величины, а это разные ответы. */
  it('ловит перепутанные местами величины', () => {
    expect(answersAgree('AB = 10 см; BC = 8 см', 'AB = 8 см; BC = 10 см')).toBe(false)
    expect(answersAgree('AB = 10 см; BC = 8 см', 'BC = 8 см; AB = 10 см')).toBe(true)
  })

  /* Словесный ответ.

     У задачи по русскому в записи стоит предложение, и два прохода не напишут
     его одинаково. Сверяются они по краткому `answerKey`, но и там остаётся
     служебная обвязка вроде слова «способ». */
  it('не считает расхождением служебные слова в словесном ответе', () => {
    expect(answersAgree('приставочно-суффиксальный', 'приставочно-суффиксальный способ')).toBe(true)
    expect(answersAgree('суффиксальный способ', 'приставочно-суффиксальный способ')).toBe(false)
  })

  // Отрицание — не обвязка: «является» и «не является» разные ответы.
  it('различает утверждение и отрицание', () => {
    expect(answersAgree('является причастием', 'не является причастием')).toBe(false)
  })
})

describe('пределы строки тетради', () => {
  const morphology: HomeworkSolution = {
    ...taskFiveSolution,
    textbookId: 'russian',
    subject: 'Русский язык',
    task: 'Разберите по составу слово «подоконник»',
    condition: 'Разберите по составу слово «подоконник» и укажите способ его образования. Объясните написание приставки.',
    given: ['подоконник'],
    goal: {
      title: 'Найти',
      text: 'Разобрать слово «подоконник» по составу, указать способ его образования и объяснить написание приставки',
    },
    steps: [
      'под-окон-ник-∅',
      'окно → подоконник',
      'приставочно-суффиксальный способ образования',
      'под- — неизменяемая приставка, в ней всегда пишется буква о',
    ],
    answer: 'Под-окон-ник-∅. Слово образовано от слова «окно» приставочно-суффиксальным способом.',
    diagram: { kind: 'none', description: '', vertices: [] },
    taskType: 'mixed',
    quality: { diagramRequired: false, reviewPassed: true, symbolicShare: 0 },
  }

  it('пропускает развёрнутую цель и ответ по словесному предмету', () => {
    expect(validateSolutionQuality(morphology)).toEqual([])
  })

  // У геометрии лист фиксированный: длинная строка туда не влезет,
  // и ослаблять проверку под неё нельзя.
  it('оставляет геометрии прежнюю тесноту', () => {
    const issues = validateSolutionQuality({
      ...taskFiveSolution,
      goal: { title: 'Построить', text: 'Разобрать слово «подоконник» по составу, указать способ его образования и объяснить написание приставки' },
    })
    expect(issues).toContain('Цель задачи не оформлена кратко')
  })

  it('обрезает по границе слова, а не посреди него', () => {
    const line = 'Разобрать слово «подоконник» по составу и объяснить написание приставки'
    const clamped = clampNotebookLine(line, 40)

    expect(clamped.endsWith('…')).toBe(true)
    // Сохранённая часть кончается там же, где кончается слово в исходной
    // строке: следующий знак оригинала — пробел, а не буква.
    const kept = clamped.slice(0, -1)
    expect(line.startsWith(kept)).toBe(true)
    expect(line[kept.length]).toBe(' ')
    expect(clampNotebookLine('Короткая строка', 40)).toBe('Короткая строка')
  })
})

describe('geometry solution quality gate', () => {
  it('accepts a compact construction with a mathematically consistent drawing', () => {
    expect(validateSolutionQuality(taskFiveSolution)).toEqual([])
    expect(isCurrentReviewedSolution(taskFiveSolution)).toBe(true)
  })

  it('rejects a text wall even when it claims to be a construction', () => {
    const issues = validateSolutionQuality({
      ...taskFiveSolution,
      steps: ['Сначала проводим прямую, затем отмечаем на ней все нужные точки и после этого отдельно ставим остальные точки вне прямой.'],
    })
    expect(issues).toContain('Построительная задача перегружена текстом')
    expect(isCurrentReviewedSolution({ ...taskFiveSolution, steps: ['Длинный словесный пересказ решения без обозначений.'] })).toBe(false)
  })

  it('rejects a drawing whose coordinates contradict its constraints', () => {
    const scene = taskFiveSolution.diagram.scene!
    const issues = validateSolutionQuality({
      ...taskFiveSolution,
      diagram: {
        ...taskFiveSolution.diagram,
        scene: {
          ...scene,
          // Копия: scene — общая фикстура, правка на месте протекла бы в соседние тесты.
          // eslint-disable-next-line no-map-spread
          points: scene.points.map((point) => point.id === 'R' ? { ...point, y: 55 } : point),
        },
      },
    })
    expect(issues).toContain('not-on-line: точка изображена на указанной прямой')
  })

  it('checks point placement against the textbook wording, not only model constraints', () => {
    const scene = taskFiveSolution.diagram.scene!
    const issues = validateSolutionQuality({
      ...taskFiveSolution,
      diagram: {
        ...taskFiveSolution.diagram,
        scene: {
          ...scene,
          // Копия: scene — общая фикстура, правка на месте протекла бы в соседние тесты.
          // eslint-disable-next-line no-map-spread
          points: scene.points.map((point) => point.id === 'P' ? { ...point, x: 50 } : point),
        },
      },
    })
    expect(issues).toContain('P: точка не должна лежать на отрезке AB')
  })

  it('does not let a construction omit its drawing or add a fake word answer', () => {
    expect(validateSolutionQuality({
      ...taskFiveSolution,
      diagram: { kind: 'none', description: '', vertices: [] },
      quality: { ...taskFiveSolution.quality!, diagramRequired: false },
    })).toEqual(expect.arrayContaining(['Условие требует обязательный чертёж', 'Обязательный чертёж отсутствует']))
    expect(validateSolutionQuality({ ...taskFiveSolution, answer: 'Чертёж' }))
      .toContain('У чистого построения не должно быть словесного ответа')
  })

  it('rejects malformed marks and degenerate objects', () => {
    const scene = taskFiveSolution.diagram.scene!
    const issues = validateSolutionQuality({
      ...taskFiveSolution,
      diagram: {
        ...taskFiveSolution.diagram,
        scene: {
          ...scene,
          objects: [{ kind: 'line', points: ['A', 'A'], label: 'a', auxiliary: false }],
          marks: [{ kind: 'parallel', points: ['A', 'B'], label: '' }],
        },
      },
    })
    expect(issues).toEqual(expect.arrayContaining(['line: объект вырожден', 'parallel: нужны четыре точки']))
  })

  it('does not trust a legacy answer without a completed review', () => {
    expect(isCurrentReviewedSolution({ ...taskFiveSolution, engineVersion: 1 })).toBe(false)
    expect(isCurrentReviewedSolution({
      ...taskFiveSolution,
      quality: { ...taskFiveSolution.quality!, reviewPassed: false },
    })).toBe(false)
  })

  it('converts provider notation to ordinary school symbols', () => {
    expect(normalizeNotebookNotation('$A \\in a$, $C \\notin a$, $a \\parallel b$, x^{2}$')).toBe('A ∈ a, C ∉ a, a ∥ b, x²')
  })
})
