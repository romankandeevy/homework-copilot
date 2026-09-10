import { describe, expect, it } from 'vitest'
import { homeworkSolutionEngineVersion } from '../src/lib/homeworkContract.ts'
import type { HomeworkAnnotatedLine, HomeworkSolution, HomeworkWrittenAnalysis } from '../src/lib/homeworkContract.ts'
import { analysisRepeatsSteps, answersAgree, clampNotebookLine, isCurrentReviewedSolution, normalizeNotebookNotation, validateSolutionQuality } from './geometrySolutionEngine.ts'

const taskFiveSolution: HomeworkSolution = {
  engineVersion: homeworkSolutionEngineVersion,
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
  explanation: [
    'В задачах на построение ответом служит сам чертёж, а не вычисленное число.',
    'Признак: спрашивают расположение точек - на отрезке, на прямой вне отрезка, вне прямой.',
    'Частая ошибка - ставить точку на глаз: каждое условие проверяют по чертежу отдельно.',
  ],
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
    explanation: [
      'Разбор по составу — это поиск морфем: приставки, корня, суффикса и окончания.',
      'Признак задания: просят разобрать слово, а не объяснить его значение.',
      'Частая ошибка — принять часть корня за суффикс, поэтому сначала подбирают однокоренные.',
    ],
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

  // Строка без пробелов — формула: многоточие выводило её за предел,
  // и проверка тетради роняла верное решение из-за одного знака.
  it('укладывается в предел вместе с многоточием', () => {
    expect(clampNotebookLine('0,3x+0,1=-0,1x+0,5'.repeat(6), 40).length).toBeLessThanOrEqual(40)
    expect(clampNotebookLine('Слово '.repeat(20), 40).length).toBeLessThanOrEqual(40)
  })

  /* 7 сентября: разбор предложения по членам не дошёл до ученика с
     сообщением «Есть словесный абзац вместо школьной записи». Порог в
     двадцать четыре слова на строку стоял на всех предметах сразу, хотя
     доля математических обозначений для гуманитарных уже была обнулена. */
  it('не считает разбор предложения словесным абзацем', () => {
    const issues = validateSolutionQuality({
      ...morphology,
      task: 'Расставьте знаки препинания',
      condition: 'Расставьте знаки препинания и найдите грамматические основы: «Как ни старался Андрей убедить себя что всё случившееся было лишь нелепой случайностью мысль о том что кто-то заранее знал о его приезде не давала ему покоя».',
      given: [],
      goal: { title: 'Найти', text: 'Знаки препинания, грамматические основы и схему предложения' },
      steps: [
        'Как ни старался Андрей убедить себя, что всё случившееся было лишь нелепой случайностью, мысль о том, что кто-то заранее знал о его приезде, не давала ему покоя, и, когда за окном послышались шаги, он понял: ждать больше нельзя.',
        'Грамматические основы: старался убедить, всё случившееся было случайностью, кто-то знал, мысль не давала, послышались шаги, он понял, ждать нельзя - всего семь предикативных частей.',
        'После слова «понял» ставится двоеточие: бессоюзная часть раскрывает содержание сказуемого, то есть имеет изъяснительно-пояснительное значение.',
      ],
      answer: 'Семь грамматических основ, после «понял» - двоеточие.',
    })

    expect(issues).toEqual([])
  })

  /* Сочинение по литературе - связный текст на 200-250 слов. Пределы
     тетрадной строки резали его абзацы по 190 знаков и дописывали
     многоточие: ученик получал план и обрывок на двадцати словах. */
  it('пропускает развёрнутый ответ абзацами', () => {
    const paragraph = (start: string) => `${start} ${'Булгаков возвращается к этой мысли снова и снова, и каждый эпизод романа подтверждает её по-своему. '.repeat(3)}`
    const issues = validateSolutionQuality({
      ...morphology,
      textbookId: 'literature',
      subject: 'Литература',
      task: 'Почему Мастер получает «покой», а не «свет»',
      condition: 'Дайте связный ответ на 200-250 слов: почему Мастер получает «покой», а не «свет». Раскройте нравственный смысл финала и приведите не менее двух эпизодов.',
      given: [],
      goal: { title: 'Найти', text: 'Связный ответ на 200-250 слов о финале романа' },
      steps: [
        paragraph('«Свет» в романе достаётся тому, кто прошёл свой путь до конца, а Мастер от борьбы отказался.'),
        paragraph('Сожжение рукописи - отречение от собственного дела, и именно оно определяет посмертную судьбу героя.'),
        paragraph('Решение принимает Иешуа, а не Воланд: «покой» здесь не наказание, а мера, точно соответствующая выбору.'),
      ],
      answer: 'Мастер получает «покой», потому что отказался от борьбы за свой роман: «свет» достаётся тому, кто прошёл путь до конца.',
    })

    expect(issues).toEqual([])
  })

  /* Форма записи - от задачи, а не только от предмета: расчёт по
     обществознанию остаётся строкой на вычисление. */
  it('оставляет расчёту по словесному предмету тетрадную строку', () => {
    const issues = validateSolutionQuality({
      ...morphology,
      textbookId: 'social',
      subject: 'Обществознание',
      taskType: 'calculation',
      condition: 'Qd = 120 - 2P, Qs = 20 + 3P. Найдите равновесную цену и объём.',
      given: ['Qd = 120 - 2P', 'Qs = 20 + 3P'],
      goal: { title: 'Найти', text: 'P₀ и Q₀' },
      steps: [`120 - 2P = 20 + 3P, значит ${'равновесие находится там, где спрос равен предложению, '.repeat(8)}P = 20`],
      answer: 'P₀ = 20, Q₀ = 80',
    })

    expect(issues).toContain('Есть строка, не помещающаяся в тетрадь')
  })
})

describe('geometry solution quality gate', () => {
  it('accepts a compact construction with a mathematically consistent drawing', () => {
    expect(validateSolutionQuality(taskFiveSolution)).toEqual([])
    expect(isCurrentReviewedSolution(taskFiveSolution)).toBe(true)
  })

  /* 5 сентября на проде и в локальной пробе: верное решение про сумму углов
     десятиугольника - формула и подстановка - дважды отвергалось как
     «слишком много слов». Скобка с названием теоремы, которую промпт сам
     просит писать, перевешивала запись. */
  it('не считает обоснование в скобках словесным абзацем', () => {
    const issues = validateSolutionQuality({
      ...taskFiveSolution,
      source: 'text',
      condition: 'Найдите сумму углов выпуклого десятиугольника.',
      given: ['n = 10'],
      goal: { title: 'Найти', text: 'S' },
      explanation: [
        'Сумма углов выпуклого n-угольника равна (n − 2) · 180°: диагонали из одной вершины делят его на n − 2 треугольника.',
        'Признак такой задачи: спрашивают сумму углов, а сами углы неизвестны.',
        'Частая ошибка — умножить на n вместо n − 2: треугольников всегда на два меньше, чем сторон.',
      ],
      steps: [
        'S = (n - 2) · 180° (по теореме о сумме углов выпуклого n-угольника)',
        'S = (10 - 2) · 180° = 8 · 180° = 1440°',
      ],
      answer: '1440°',
      diagram: { kind: 'none', description: '', vertices: [] },
      taskType: 'calculation',
      quality: { diagramRequired: false, reviewPassed: true, symbolicShare: 0.9 },
    })
    expect(issues).toEqual([])
  })

  it('rejects a text wall even when it claims to be a construction', () => {
    const issues = validateSolutionQuality({
      ...taskFiveSolution,
      steps: ['Сначала проводим прямую, затем отмечаем на ней все нужные точки и после этого отдельно ставим остальные точки вне прямой.'],
    })
    expect(issues).toContain('Построительная задача перегружена текстом')
    expect(isCurrentReviewedSolution({ ...taskFiveSolution, steps: ['Длинный словесный пересказ решения без обозначений.'] })).toBe(false)
  })

  /* Задача 369 на проде 6 сентября. Ответ верный - ∠A = ∠B = ∠C = 75°,
     ∠D = 135°, - а чертёж нарисован равнобедренной трапецией: C и D по
     105°. Ученик перечерчивал фигуру, которая спорит с его же ответом.
     Ни одна прежняя проверка этого не видела: ограничение про
     параллельность координатам не противоречило. */
  /* Та же задача 369, первая строка решения: «∠1 + ∠2 + ∠3 = 180° (сумма
     углов треугольника)». Ни треугольника, ни углов с номерами в задаче
     нет - это обломок вывода теоремы о сумме углов четырёхугольника.
     В школьной записи ∠1 и ∠2 вводят на чертеже; нет пометки - ученик
     читает обозначение, которого никто не объяснил. */
  it('ловит обозначение угла, которого нет на чертеже', () => {
    const issues = validateSolutionQuality({
      ...taskFiveSolution,
      steps: ['∠1 + ∠2 + ∠3 = 180° (сумма углов треугольника).', '3∠A + 135° = 360°.'],
    })
    expect(issues.some((issue) => issue.includes('нигде не введены'))).toBe(true)
  })

  /* Физика на проде 6 сентября: «отношение масс водорода и кислорода
     всегда 1 : 8. Свидетельствует ли это в пользу существования атомов?»
     Модель внесла в «Дано» атомную массу кислорода - справочный факт,
     которого в условии нет, - и вывела из него те же 1 : 8. Арифметика
     верна, рассуждение вывернуто: атомы взяты как данность, чтобы
     доказать атомы. */
  /* Физика 8 класса дважды пришла с «m(H) : m(O) = 1 : 8 = const».
     В промпте это запрещено с утра, но промпт - просьба, а не правило:
     пока никто не проверяет, модель возвращается к своей скорописи. */
  /* Запись чинится кодом, а не отказом.

     6 сентября ученик увидел «Решение не дошло: в решении есть разметка
     вместо школьной записи; не пишут const». Все замечания были про
     запись, а не про математику: решение верное, а ученик не получил
     ничего. Разметку и чужие значки код правит сам - модель зовут только
     туда, где нужен смысл. */
  it('чинит const и разметку сам, не отменяя решение', () => {
    expect(normalizeNotebookNotation('m(H) : m(O) = 1 : 8 = const.'))
      .toBe('m(H) : m(O) = 1 : 8 - величина постоянная')
    expect(normalizeNotebookNotation('**S** = 180° · (n − 2)')).toBe('S = 180° · (n − 2)')
    expect(normalizeNotebookNotation('x := 5')).toBe('x = 5')
  })

  /* 7 сентября: всё, что проверка называет «технической разметкой» и
     «значками не из тетради», должно сниматься кодом до проверки - иначе
     верное решение снова уйдёт в «Решение не дошло» из-за записи. */
  it('снимает LaTeX, HTML и кванторы сам', () => {
    expect(normalizeNotebookNotation('\\sqrt{16} = 4^\\circ')).toBe('√(16) = 4°')
    expect(normalizeNotebookNotation('S = \\text{площадь} \\left( x^{10} \\right)')).toBe('S = площадь ( x¹⁰ )')
    expect(normalizeNotebookNotation('x_{12} <sup>2</sup> \\le \\pi')).toBe('x₁₂ 2 ≤ π')
    expect(normalizeNotebookNotation('∀ x ∃ y, Q.E.D.')).toBe('для любого x существует y, что и требовалось доказать')
  })

  it('ловит const и другие значки не из школьной тетради', () => {
    const issues = validateSolutionQuality({
      ...taskFiveSolution,
      steps: ['m(H) : m(O) = 1 : 8 = const.', 'Значит, состав постоянен.'],
    })
    expect(issues.some((issue) => issue.includes('не пишут «const»'))).toBe(true)
  })

  /* 7 сентября: система «y = -0,1x + 0,5 и y = 0,3x + 0,1» решилась верно,
     а чертить её было нечем - сцена знала только поле 0..100. Теперь
     задача про график требует осей, а точка пересечения проверяется
     подстановкой в формулу. */
  it('требует координатную плоскость для задачи про график', () => {
    const issues = validateSolutionQuality({
      ...taskFiveSolution,
      subject: 'Алгебра',
      condition: 'Решите графически систему уравнений y = -0,1x + 0,5 и y = 0,3x + 0,1',
      quality: { ...taskFiveSolution.quality!, diagramRequired: true },
    })
    expect(issues.some((issue) => issue.includes('scene.axes'))).toBe(true)
  })

  it('принимает графики с точкой пересечения на обеих прямых', () => {
    const graph = {
      ...taskFiveSolution,
      subject: 'Алгебра',
      taskType: 'calculation' as const,
      condition: 'Решите графически систему уравнений y = -0,1x + 0,5 и y = 0,3x + 0,1',
      given: ['y = -0,1x + 0,5', 'y = 0,3x + 0,1'],
      steps: ['-0,1x + 0,5 = 0,3x + 0,1', '0,4x = 0,4', 'x = 1', 'y = 0,4'],
      answer: '(1; 0,4)',
      quality: { ...taskFiveSolution.quality!, diagramRequired: true },
      diagram: {
        kind: 'construction' as const,
        description: 'Две прямые на координатной плоскости и точка их пересечения A',
        vertices: ['A'],
        scene: {
          axes: { xMin: -2, xMax: 4, yMin: -1, yMax: 2, unit: 1, xLabel: 'x', yLabel: 'y' },
          points: [{ id: 'A', label: 'A', x: 1, y: 0.4, visible: true }],
          objects: [
            { kind: 'curve' as const, points: ['A'], label: 'y = -0,1x + 0,5', auxiliary: false, formula: '-0,1x + 0,5' },
            { kind: 'curve' as const, points: ['A'], label: 'y = 0,3x + 0,1', auxiliary: false, formula: '0,3x + 0,1' },
          ],
          marks: [],
          constraints: [],
        },
      },
    }
    expect(validateSolutionQuality(graph).filter((issue) => /график|ос|точк|чертёж/iu.test(issue))).toEqual([])

    const wrong = validateSolutionQuality({
      ...graph,
      diagram: {
        ...graph.diagram,
        scene: { ...graph.diagram.scene, points: [{ id: 'A', label: 'A', x: 1, y: 1, visible: true }] },
      },
    })
    expect(wrong.some((issue) => issue.includes('не лежит на графике'))).toBe(true)
  })

  /* Схема физики: цепь обязана быть замкнутой и с источником, а задача
     «начертите схему цепи» - требовать именно схему, не геометрию. */
  it('проверяет схему цепи', () => {
    const base = {
      ...taskFiveSolution,
      subject: 'Физика',
      taskType: 'calculation' as const,
      condition: 'Начертите схему цепи из двух последовательно соединённых резисторов 4 Ом и 6 Ом и найдите общее сопротивление.',
      given: ['R₁ = 4 Ом', 'R₂ = 6 Ом'],
      steps: ['R = R₁ + R₂ = 4 + 6 = 10 Ом'],
      answer: 'R = 10 Ом',
      quality: { ...taskFiveSolution.quality!, diagramRequired: true },
    }
    const schematic = {
      kind: 'circuit' as const,
      elements: [
        { id: 'E', symbol: 'battery' as const, x: 50, y: 85, rotation: 0, length: 0, label: 'ε' },
        { id: 'R1', symbol: 'resistor' as const, x: 30, y: 15, rotation: 0, length: 0, label: 'R₁ = 4 Ом' },
        { id: 'R2', symbol: 'resistor' as const, x: 70, y: 15, rotation: 0, length: 0, label: 'R₂ = 6 Ом' },
      ],
      connections: [
        { from: 'E', to: 'R1', kind: 'wire' as const, label: '' },
        { from: 'R1', to: 'R2', kind: 'wire' as const, label: '' },
        { from: 'R2', to: 'E', kind: 'wire' as const, label: '' },
      ],
    }
    const good = validateSolutionQuality({
      ...base,
      diagram: { kind: 'schematic', description: 'Схема цепи: источник и два резистора последовательно', vertices: [], schematic },
    })
    expect(good.filter((issue) => /схем|цеп|элемент/iu.test(issue))).toEqual([])

    const open = validateSolutionQuality({
      ...base,
      diagram: {
        kind: 'schematic',
        description: 'Схема цепи: источник и два резистора последовательно',
        vertices: [],
        schematic: { ...schematic, connections: schematic.connections.slice(0, 2) },
      },
    })
    expect(open.some((issue) => issue.includes('не замкнута'))).toBe(true)

    const geometry = validateSolutionQuality(base)
    expect(geometry.some((issue) => issue.includes('kind=schematic'))).toBe(true)
  })

  /* Координатная прямая. 9 сентября решение неравенств а-г с прода ушло
     ученику без чертежа: условие просило изобразить множество решений на
     координатной прямой, а модель сочла достаточными скобки промежутков. */
  it('требует координатную прямую там, где её просит условие', () => {
    const base = {
      ...taskFiveSolution,
      subject: 'Алгебра',
      taskType: 'calculation' as const,
      condition: 'Решите неравенство и изобразите на координатной прямой множество его решений: а) 6 + 2x > 1; в) 1 - 0,4x ≤ 1.',
      given: [],
      steps: ['а) 6 + 2x > 1; 2x > -5; x > -2,5', 'в) 1 - 0,4x ≤ 1; -0,4x ≤ 0; x ≥ 0'],
      answer: 'а) x ∈ (-2,5; +∞); в) x ∈ [0; +∞)',
      quality: { ...taskFiveSolution.quality!, diagramRequired: true },
    }
    const numberLine = {
      lines: [
        {
          label: 'а)',
          variable: 'x',
          answer: 'x ∈ (-2,5; +∞)',
          marks: [{ value: -2.5, label: '-2,5', filled: false }],
          regions: [{ from: -2.5, to: null }],
        },
        {
          label: 'в)',
          variable: 'x',
          answer: 'x ∈ [0; +∞)',
          marks: [{ value: 0, label: '0', filled: true }],
          regions: [{ from: 0, to: null }],
        },
      ],
    }
    const good = validateSolutionQuality({
      ...base,
      diagram: { kind: 'number-line', description: 'Множества решений на координатной прямой', vertices: [], numberLine },
    })
    expect(good.filter((issue) => /прям|чертёж|промежут/iu.test(issue))).toEqual([])

    const explained = validateSolutionQuality({
      ...base,
      steps: ['а) 6 + 2x > 1', '2x > -5 (переносим 6 с другим знаком)', 'x > -2,5', 'в) 1 - 0,4x ≤ 1', '-0,4x ≤ 0', 'x ≥ 0'],
      diagram: { kind: 'number-line', description: 'Множества решений на координатной прямой', vertices: [], numberLine },
    })
    expect(explained.some((issue) => issue.includes('пояснение словами'))).toBe(true)

    const missing = validateSolutionQuality({
      ...base,
      diagram: { kind: 'none', description: '', vertices: [] },
    })
    expect(missing.some((issue) => issue.includes('number-line'))).toBe(true)

    const loose = validateSolutionQuality({
      ...base,
      diagram: {
        kind: 'number-line',
        description: 'Множества решений',
        vertices: [],
        numberLine: { lines: [{ ...numberLine.lines[0], marks: [{ value: 3, label: '3', filled: false }] }] },
      },
    })
    expect(loose.some((issue) => issue.includes('не отмечен точкой'))).toBe(true)
  })

  /* Лента через стрелки. 9 сентября запись неравенств с прода уместилась
     в четыре строки только потому, что каждый пункт был склеен в цепочку
     «⇒ ... ⇒ ...» - в тетради так не пишут. */
  it('ловит преобразования, склеенные в строку через ⇒', () => {
    const chained = validateSolutionQuality({
      ...taskFiveSolution,
      subject: 'Алгебра',
      taskType: 'calculation' as const,
      condition: '862. Решите неравенство: а) 6 + 2x > 1.',
      given: [],
      steps: ['а) 6 + 2x > 1 ⇒ 2x > -5, откуда x > -2,5, т. е. x ∈ (-2,5; +∞)'],
      answer: 'а) x ∈ (-2,5; +∞)',
      diagram: { kind: 'none', description: '', vertices: [] },
    })
    expect(chained.some((issue) => issue.includes('стоит ⇒'))).toBe(true)

    const column = validateSolutionQuality({
      ...taskFiveSolution,
      subject: 'Алгебра',
      taskType: 'calculation' as const,
      condition: '862. Решите неравенство: а) 6 + 2x > 1.',
      given: [],
      steps: ['а) 6 + 2x > 1', '2x > 1 - 6 = -5', 'x > -5 / 2 = -2,5', 'x ∈ (-2,5; +∞)'],
      answer: 'а) x ∈ (-2,5; +∞)',
      diagram: { kind: 'none', description: '', vertices: [] },
    })
    expect(column.some((issue) => issue.includes('стоит ⇒'))).toBe(false)
  })

  it('ловит подставленный ответ в «Дано» качественного вопроса', () => {
    const issues = validateSolutionQuality({
      ...taskFiveSolution,
      condition: 'При образовании воды отношение масс водорода и кислорода всегда равно 1 : 8. '
        + 'Свидетельствует ли этот факт в пользу существования атомов и молекул? Аргументируйте.',
      given: ['m(H) : m(O) = 1 : 8', 'm_a(O) = 16 · m_a(H)'],
      steps: ['m(H) / m(O) = 2 / 16 = 1 / 8.'],
      answer: 'Да, свидетельствует.',
    })
    expect(issues.some((issue) => issue.includes('которого нет в условии'))).toBe(true)
  })

  it('не придирается к «Дано» расчётной задачи', () => {
    const issues = validateSolutionQuality({
      ...taskFiveSolution,
      condition: 'Определите количество теплоты при полном сгорании 200 г спирта. Удельная теплота сгорания 2,7 Дж/кг.',
      given: ['m = 200 г = 0,2 кг', 'q = 2,7 Дж/кг'],
      steps: ['Q = q · m.'],
      answer: 'Q = 5,4 Дж',
    })
    expect(issues.some((issue) => issue.includes('которого нет в условии'))).toBe(false)
  })

  /* Прод, вечер 6 сентября: верное решение про четырёхугольник упало с
     «У выпуклой фигуры не бывает угла 360°». В строке
     «∠A + ∠B + ∠C + ∠D = 360°» проверка выхватила хвост «∠D = 360°».
     Сумма углов - не угол. */
  it('не принимает сумму углов за один угол', () => {
    const issues = validateSolutionQuality({
      ...taskFiveSolution,
      condition: 'Найдите углы выпуклого четырёхугольника ABCD, если ∠D = 135°.',
      steps: ['∠A + ∠B + ∠C + ∠D = 360° (сумма углов четырёхугольника).', '∠A = 75°.'],
      answer: '∠A = ∠B = ∠C = 75°',
    })
    expect(issues.some((issue) => issue.includes('не бывает угла'))).toBe(false)
  })

  it('ловит угол от 180° у выпуклой фигуры', () => {
    const issues = validateSolutionQuality({
      ...taskFiveSolution,
      condition: 'Найдите углы выпуклого четырёхугольника ABCD, если ∠D = 135°.',
      steps: ['3∠A + 135° = 360°.', '∠A = 200°.'],
      answer: '∠A = 200°',
    })
    expect(issues.some((issue) => issue.includes('не бывает угла 200°'))).toBe(true)
  })

  it('ловит чертёж, где подписанный градус расходится с нарисованным', () => {
    const quadrilateral = {
      ...taskFiveSolution,
      diagram: {
        kind: 'construction' as const,
        description: 'Выпуклый четырёхугольник ABCD.',
        vertices: ['A', 'B', 'C', 'D'],
        scene: {
          points: [
            { id: 'A', label: 'A', x: 20, y: 75, visible: true },
            { id: 'B', label: 'B', x: 80, y: 75, visible: true },
            { id: 'C', label: 'C', x: 72, y: 46, visible: true },
            { id: 'D', label: 'D', x: 28, y: 46, visible: true },
          ],
          objects: [{ kind: 'polygon' as const, points: ['A', 'B', 'C', 'D'], label: '', auxiliary: false }],
          marks: [{ kind: 'angle' as const, points: ['C', 'D', 'A'], label: '135°' }],
          constraints: [],
        },
      },
    }
    const issues = validateSolutionQuality(quadrilateral)
    expect(issues.some((issue) => issue.includes('Угол подписан 135°, а на чертеже 105°'))).toBe(true)
  })

  it('ловит углы, помеченные равными, но нарисованные разными', () => {
    const quadrilateral = {
      ...taskFiveSolution,
      diagram: {
        kind: 'construction' as const,
        description: 'Выпуклый четырёхугольник ABCD.',
        vertices: ['A', 'B', 'C', 'D'],
        scene: {
          points: [
            { id: 'A', label: 'A', x: 20, y: 75, visible: true },
            { id: 'B', label: 'B', x: 80, y: 75, visible: true },
            { id: 'C', label: 'C', x: 72, y: 46, visible: true },
            { id: 'D', label: 'D', x: 28, y: 46, visible: true },
          ],
          objects: [{ kind: 'polygon' as const, points: ['A', 'B', 'C', 'D'], label: '', auxiliary: false }],
          marks: [
            { kind: 'angle' as const, points: ['D', 'A', 'B'], label: '∠A = ∠B = ∠C' },
            { kind: 'angle' as const, points: ['B', 'C', 'D'], label: '∠A = ∠B = ∠C' },
          ],
          constraints: [],
        },
      },
    }
    const issues = validateSolutionQuality(quadrilateral)
    expect(issues.some((issue) => issue.includes('помечены как равные'))).toBe(true)
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

/* Разбор существует ради школьной разметки: морфем, членов предложения,
   степеней окисления. 7 сентября на физике и химии вместо него всплывала
   старая карточка - те же формулы решения, обведённые рамкой. */
describe('разбор против дубля решения', () => {
  const analysisOf = (kind: 'formula' | 'morphemes', lines: HomeworkAnnotatedLine[]): HomeworkWrittenAnalysis => ({
    version: 1,
    kind,
    blocks: [{ title: 'Разбор', lines, legend: [] }],
  })

  /* Порог «половина строк» такую карточку пропускал: подстановка и
     результат записаны иначе, чем в решении - другой порядок множителей,
     свёрнутые степени, - и эхо засчитывалось одно из трёх. */
  it('вырезает карточку «формула, подстановка, ответ»', () => {
    const card = analysisOf('formula', [
      { kind: 'formula', lead: 'Формула', tokens: [{ text: 'v = mgR / (B²L²)' }] },
      { kind: 'formula', lead: 'Подстановка', tokens: [{ text: 'v = 0,20 · 10 · 0,40 / (0,64 · 0,25)' }] },
      { kind: 'formula', lead: 'Ответ', tokens: [{ text: 'v = 5 м/с', mark: 'box' }] },
    ])
    const steps = [
      'v = m·g·R/(B²·L²)',
      'v = 0,2·10·0,4/(0,8²·0,5²) = 5 м/с',
      'Сила Ампера направлена вертикально вверх, против движения стержня.',
    ]

    expect(analysisRepeatsSteps(card, steps)).toBe(true)
  })

  // Те же буквы, что и в решении, но со значками морфем: это и есть та
  // запись, которую ученик перечерчивает в тетрадь.
  it('оставляет разбор по составу', () => {
    const morphemes = analysisOf('morphemes', [{
      kind: 'word',
      tokens: [
        { text: 'под', mark: 'prefix' },
        { text: 'окон', mark: 'root', tight: true },
        { text: 'ник', mark: 'suffix', tight: true },
        { text: '∅', mark: 'ending', tight: true },
      ],
    }])

    expect(analysisRepeatsSteps(morphemes, ['под-окон-ник-∅'])).toBe(false)
  })
})

/* Стереометрия: чертёж тела без пунктира - плоская картинка.

   7 сентября на проде куб к задаче про скрещивающиеся прямые вышел
   шестиугольником с диагоналями: невидимые рёбра отметить было нечем. */
describe('чертёж тела', () => {
  const cubeSolution = (hidden: boolean): HomeworkSolution => ({
    ...taskFiveSolution,
    source: 'text',
    task: 'Куб ABCDA₁B₁C₁D₁',
    condition: 'Куб ABCDA₁B₁C₁D₁ с ребром 6. M - середина BB₁. Найдите расстояние между скрещивающимися прямыми DM и A₁N.',
    given: ['a = 6'],
    goal: { title: 'Найти', text: 'd(DM, A₁N)' },
    explanation: [
      'Расстояние между скрещивающимися прямыми - длина их общего перпендикуляра, и её удобно считать через объём.',
      'Признак такой задачи: две прямые не пересекаются и не параллельны, значит они скрещиваются.',
      'Частая ошибка - взять расстояние между точками вместо расстояния между прямыми.',
    ],
    steps: ['d = 12/√53 = 12√53/53'],
    answer: 'd = 12√53/53',
    taskType: 'calculation',
    diagram: {
      kind: 'construction',
      description: 'Куб ABCDA₁B₁C₁D₁ с отмеченными точками M и N.',
      vertices: ['A', 'B', 'D', 'A₁'],
      scene: {
        points: [
          { id: 'A', label: 'A', x: 20, y: 70, visible: true },
          { id: 'B', label: 'B', x: 60, y: 70, visible: true },
          { id: 'D', label: 'D', x: 34, y: 56, visible: true },
          { id: 'A1', label: 'A₁', x: 20, y: 30, visible: true },
        ],
        objects: [
          { kind: 'segment', points: ['A', 'B'], label: '', auxiliary: false },
          { kind: 'segment', points: ['A', 'A1'], label: '', auxiliary: false },
          { kind: 'segment', points: ['A', 'D'], label: '', auxiliary: false, ...(hidden ? { hidden: true } : {}) },
        ],
        marks: [],
        constraints: [],
      },
    },
  })

  it('требует пунктир на невидимых рёбрах', () => {
    expect(validateSolutionQuality(cubeSolution(false)))
      .toContain('Это чертёж тела: невидимые рёбра обязаны быть помечены hidden=true и начерчены пунктиром')
  })

  it('пропускает чертёж тела с помеченными рёбрами', () => {
    expect(validateSolutionQuality(cubeSolution(true)))
      .not.toContain('Это чертёж тела: невидимые рёбра обязаны быть помечены hidden=true и начерчены пунктиром')
  })
})

/* Запись, которую ученик перепишет от руки.

   Прогон 7 сентября: стереометрия вернула «vec(DM) · vec(A₁N) = -48», а
   астрономия - «10⁰,536». Первое пишут в программе, а не в тетради; второе
   не читается вовсе: степень поднялась наполовину, а хвост остался внизу. */
describe('нотация точных предметов', () => {
  it('ставит стрелку вектору вместо слова vec', () => {
    expect(normalizeNotebookNotation('vec(DM) · vec(A₁N) = -48'))
      .toBe('DM⃗ · A₁N⃗ = -48')
    expect(normalizeNotebookNotation(String.raw`\vec{AB} + \vec{BC}`)).toBe('AB⃗ + BC⃗')
  })

  it('не рвёт дробную степень пополам', () => {
    expect(normalizeNotebookNotation('L/L☉ = 10^0,536 ≈ 3,42')).toBe('L/L☉ = 10^0,536 ≈ 3,42')
  })

  it('целую степень по-прежнему поднимает', () => {
    expect(normalizeNotebookNotation('S = a^2 + b^10')).toBe('S = a² + b¹⁰')
  })
})
