export const homeworkDiagramKinds = [
  'construction',
  'triangle',
  'three-point-lines',
  'three-point-extended-lines',
  'three-lines-cases',
  'three-collinear-one-off-lines',
  'isosceles-triangle',
  'median-triangle',
  'right-triangle',
  'intersecting-segments',
  'parallel-line-triangle',
  'parallelogram',
  'rectangle',
  'rhombus',
  'square',
  'trapezoid',
  'circle',
  'schematic',
  'none',
] as const

export type HomeworkDiagramKind = typeof homeworkDiagramKinds[number]

/* Схема - рисунок из условных обозначений.

   Физика и химия чертят не координаты, а знаки: схему цепи, силы на теле,
   ход лучей, установку для опыта. Схема - это элементы из фиксированной
   библиотеки, поставленные в поле 0..100, и соединения между ними.
   Значки рисует лист, модель только выбирает их и расставляет. */
export const homeworkSchematicSymbols = [
  // электричество
  'battery', 'resistor', 'lamp', 'switch', 'ammeter', 'voltmeter', 'capacitor', 'node', 'bell', 'motor',
  // механика
  'body', 'incline', 'ground', 'wall', 'spring', 'pulley', 'rope', 'vector',
  // оптика
  'lens-converging', 'lens-diverging', 'mirror', 'ray', 'object-arrow', 'eye', 'prism',
  // химия и установки
  'beaker', 'flask', 'test-tube', 'burner', 'tube', 'gas-bubbles', 'funnel', 'thermometer', 'arrow', 'text',
] as const
export type HomeworkSchematicSymbol = typeof homeworkSchematicSymbols[number]

export const homeworkSchematicKinds = ['circuit', 'forces', 'optics', 'setup'] as const
export type HomeworkSchematicKind = typeof homeworkSchematicKinds[number]

export type HomeworkSchematic = {
  kind: HomeworkSchematicKind
  elements: Array<{
    id: string
    symbol: HomeworkSchematicSymbol
    x: number
    y: number
    /** Поворот в градусах: 0 - горизонтально, 90 - вертикально; у vector и ray - направление. */
    rotation: number
    /** Длина в единицах поля: у vector, ray, incline, rope, tube. */
    length: number
    label: string
    /* К какому элементу приложена стрелка.

       Сила приложена к телу, а не висит рядом с ним. 7 сентября на проде в
       задаче про стержень на рельсах стрелки F_A и m·g оказались оторваны
       от самого стержня: у стрелки не было ссылки на тело, поэтому она
       рисовалась от собственной точки, а проверка схемы вдобавок разводила
       её со стержнем как два независимых значка. */
    anchor?: string
  }>
  connections: Array<{
    from: string
    to: string
    /** wire - провод с прямыми углами, line - прямая, dashed - пунктир. */
    kind: 'wire' | 'line' | 'dashed'
    label: string
  }>
}
// number — задача по номеру в размеченном учебнике;
// photo  — фотография задачи;
// text   — условие, вписанное учеником вручную. Последний путь работает
//          с любым учебником и любым предметом: индекс для него не нужен.
export type HomeworkSource = 'number' | 'photo' | 'text'

/* Предел условия одной задачи.

   Тетрадная страница держит четырнадцать строк решения, поэтому вставленная
   простыня из сотен примеров всё равно не пройдёт проверку - а три-четыре
   вызова модели за неё будут оплачены. Ограничение общее для формы и сервера:
   форма не даёт набрать больше, сервер не берёт в работу больше. */
export const maxConditionLength = 1500

/* Версия решателя. Поднимается, когда меняется состав готового решения:
   по ней отличается запись, собранная нынешним движком, от сохранённой
   прежним. Версия 3 - один проход умной моделью и объяснение перед
   решением. */
export const homeworkSolutionEngineVersion = 3

export const homeworkTaskTypes = ['construction', 'calculation', 'proof', 'mixed'] as const
export type HomeworkTaskType = typeof homeworkTaskTypes[number]

/* Форма записи: тетрадная строка или связный текст.

   Живёт в контракте, потому что нужна с обеих сторон: сервер меряет по ней
   пределы строк и проверяет запись, страница по ней решает, нумеровать шаги
   или ставить абзацы. Нумерованный список из четырёх абзацев сочинения по
   литературе читается как перечень, а не как ответ.

   Предмета мало: обществознание считает налог строкой на вычисление и оно же
   пишет развёрнутый ответ. Поэтому решает пара «предмет плюс тип задачи»: у
   гуманитарных предметов расчёт остаётся записью, остальное - текстом. */
export function homeworkSolutionForm(subject: string, taskType: HomeworkTaskType = 'mixed') {
  const normalized = subject.toLocaleLowerCase('ru-RU')
  const notebookSubject = ['геометр', 'алгебр', 'математ', 'физик', 'хими', 'информат', 'астроном']
    .some((entry) => normalized.includes(entry))
  if (notebookSubject || taskType === 'calculation' || taskType === 'construction') return 'notebook' as const
  return 'essay' as const
}

/* «curve» - график функции по формуле от x; рисуется только на сцене с
   осями (axes), где координаты точек - математические, а не поле 0..100. */
export const homeworkSceneObjectKinds = ['line', 'segment', 'ray', 'circle', 'polyline', 'polygon', 'curve'] as const
export type HomeworkSceneObjectKind = typeof homeworkSceneObjectKinds[number]

export const homeworkSceneMarkKinds = ['angle', 'right-angle', 'equal-segment', 'parallel'] as const
export type HomeworkSceneMarkKind = typeof homeworkSceneMarkKinds[number]

export const homeworkSceneConstraintKinds = [
  'collinear',
  'not-collinear',
  'between',
  'not-on-line',
  'parallel',
  'perpendicular',
  'equal-length',
  'midpoint',
  'on-circle',
] as const
export type HomeworkSceneConstraintKind = typeof homeworkSceneConstraintKinds[number]

/* Координатная плоскость.

   Задачи про графики - «постройте график», «решите графически», «найдите
   точку пересечения прямых» - на поле 0..100 не ложатся: там нет осей,
   единичного отрезка и подписей делений. Когда axes задан, координаты
   всех точек сцены - математические, ось y смотрит вверх, а лист сам
   рисует оси, стрелки и деления через unit. */
export type HomeworkSceneAxes = {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
  unit: number
  xLabel: string
  yLabel: string
}

export type HomeworkDiagramScene = {
  axes?: HomeworkSceneAxes
  points: Array<{
    id: string
    label: string
    x: number
    y: number
    visible: boolean
  }>
  objects: Array<{
    kind: HomeworkSceneObjectKind
    points: string[]
    label: string
    auxiliary: boolean
    /** Формула графика для kind = curve: выражение от x, например «x² - 4x + 1». */
    formula?: string
    /* Ребро тела, закрытое от наблюдателя.

       В стереометрии невидимые рёбра чертят пунктиром - иначе куб читается
       как плоский шестиугольник с диагоналями. Это не то же, что auxiliary:
       вспомогательная линия тонкая и построенная нами, скрытое ребро -
       настоящее ребро тела, просто за гранью. */
    hidden?: boolean
  }>
  marks: Array<{
    kind: HomeworkSceneMarkKind
    points: string[]
    label: string
  }>
  constraints: Array<{
    kind: HomeworkSceneConstraintKind
    points: string[]
  }>
}

export type HomeworkDiagram = {
  kind: HomeworkDiagramKind
  description: string
  vertices: string[]
  apexAngle?: string
  auxiliaryKind?: 'median' | 'bisector' | 'height'
  auxiliaryLabel?: string
  rightAngleAt?: string
  parallelTo?: string
  exteriorAngle?: string
  scene?: HomeworkDiagramScene
  /** Для kind = schematic: схема из условных обозначений. */
  schematic?: HomeworkSchematic
}

export type HomeworkDecisionSummary = {
  taskGoal: string
  diagramRequired: boolean
  diagramReason: string
  requiredElements: string[]
  notebookFormat: string
  selfChecks: string[]
}

export type HomeworkVerificationCheck = {
  label: string
  passed: boolean
  note: string
}

export type HomeworkSolutionVerification = {
  version: 1
  author: HomeworkDecisionSummary
  authorIssues: string[]
  reviewer: HomeworkDecisionSummary
  reviewerApproved: boolean
  reviewerIssues: string[]
  checks: HomeworkVerificationCheck[]
  /* Сошлись ли независимые проходы в ответе и был ли у них для этого краткий
     ключ сверки. Ученику не показывается: это след того, как решение
     проверялось. Осталось от двух проходов: с 4 сентября проход один,
     и поле заполняется только у решений, сохранённых до этого. */
  agreement?: {
    sameAnswer: boolean
    answerKeysPresent: boolean
  }
}

export type HomeworkSolution = {
  engineVersion?: number
  textbookId: string
  task: string
  source: HomeworkSource
  textbookEdition: string
  sourceUrl: string
  sourcePage?: number
  conditionNormalized: string
  subject: string
  textbookTitle: string
  condition: string
  given: string[]
  goal: {
    title: 'Найти' | 'Доказать' | 'Построить'
    text: string
  }
  /* Объяснение перед решением: почему задача решается именно так.

     Продукт — «сфоткал и понял», а не «сфоткал и списал»: сначала разбор
     обычными словами, потом готовая запись. Без объяснения сервис читается
     как списывание, и на этом основании его отказываются подключать
     платёжные системы. Необязательно: решения, сохранённые до появления
     объяснения, остаются читаемыми. */
  explanation?: string[]
  steps: string[]
  answer: string
  diagram: HomeworkDiagram
  sourceVerified: boolean
  taskType?: HomeworkTaskType
  quality?: {
    diagramRequired: boolean
    reviewPassed: boolean
    symbolicShare: number
  }
  verification?: HomeworkSolutionVerification
  /** Размеченный разбор: готовая запись для тетради поверх обычных шагов решения. */
  analysis?: HomeworkWrittenAnalysis
  createdAt: string
  ownerId?: string
}

export type SolveHomeworkRequest = {
  textbookId: string
  task: string
  source: HomeworkSource
  subject: string
  grade: string
  textbookTitle: string
  authors: string
  edition: string
  condition?: string
  /* Пометка ученика к фотографии: «реши только б)», «задача 1 сверху».
     Условием она не является - условие на снимке, - но модели без неё
     непонятно, что именно решать. Отдельным полем именно поэтому: как
     `condition` она однажды поехала в промпт «проверенным условием», и
     модель разобрала подпись вместо задачи. */
  note?: string
  sourceUrl?: string
  sourcePage?: number
  imageDataUrl?: string
  idempotencyKey: string
}

/* Размеченный разбор — единый формат «готовой записи» для всех предметов.
   Идея: любой школьный разбор раскладывается на строки, строка — на токены,
   а у токена может быть школьный значок (черта, волнистая, дуга, рамка)
   и короткая подпись сверху или снизу.
   Одним форматом описываются синтаксический разбор предложения, разбор слова
   по составу, уравнение реакции со степенями окисления, физическая формула
   с подстановкой и разбор цитаты. */

export const homeworkAnnotationMarks = [
  'none',
  'single',    // одна черта снизу — подлежащее
  'double',    // две черты снизу — сказуемое
  'wavy',      // волнистая снизу — определение
  'dashed',    // пунктир снизу — дополнение
  'dash-dot',  // штрихпунктир снизу — обстоятельство
  'stem',      // скобка снизу — основа слова
  'prefix',    // значок ¬ сверху — приставка
  'root',      // дуга сверху — корень
  'suffix',    // значок ∧ сверху — суффикс
  'ending',    // рамка вокруг — окончание
  'box',       // рамка вокруг — выделенная величина, ответ, коэффициент
  'circle',    // обводка — отмеченный элемент записи
] as const

export type HomeworkAnnotationMark = typeof homeworkAnnotationMarks[number]

export type HomeworkAnnotatedToken = {
  /** Кусок записи: слово, морфема, формула, число с единицей. */
  text: string
  /** Школьный значок над, под или вокруг куска записи. */
  mark?: HomeworkAnnotationMark
  /** Короткая надстрочная пометка: степень окисления, время глагола, часть речи. */
  label?: string
  labelPlacement?: 'above' | 'below'
  /** Что означает значок именно здесь; попадает в условные обозначения под разбором. */
  note?: string
  /** Токен пишется вплотную к предыдущему — так собираются морфемы одного слова. */
  tight?: boolean
}

export const homeworkAnnotatedLineKinds = ['sentence', 'word', 'formula', 'equation', 'quote', 'plain'] as const
export type HomeworkAnnotatedLineKind = typeof homeworkAnnotatedLineKinds[number]

export type HomeworkAnnotatedLine = {
  /** Влияет только на начертание строки: формулы и уравнения пишутся моноширинным. */
  kind?: HomeworkAnnotatedLineKind
  /** Пометка на поле слева от строки: «1.», «Формула», «Подстановка». */
  lead?: string
  tokens: HomeworkAnnotatedToken[]
  /** Пояснение под строкой обычной записью. */
  caption?: string
}

export type HomeworkAnnotationLegendEntry = {
  mark: HomeworkAnnotationMark
  label: string
}

export type HomeworkAnnotatedBlock = {
  title?: string
  lines: HomeworkAnnotatedLine[]
  /** Условные обозначения. Если не заданы, собираются из note токенов. */
  legend?: HomeworkAnnotationLegendEntry[]
}

export const homeworkAnalysisKinds = [
  'sentence-parse',
  'morphemes',
  'word-analysis',
  'equation',
  'formula',
  'quote',
  'generic',
] as const
export type HomeworkAnalysisKind = typeof homeworkAnalysisKinds[number]

export type HomeworkWrittenAnalysis = {
  version: 1
  kind: HomeworkAnalysisKind
  /** Заголовок разбора; без него берётся стандартное название по kind. */
  title?: string
  blocks: HomeworkAnnotatedBlock[]
}
