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
  'none',
] as const

export type HomeworkDiagramKind = typeof homeworkDiagramKinds[number]
// number — задача по номеру в размеченном учебнике;
// photo  — фотография задачи;
// text   — условие, вписанное учеником вручную. Последний путь работает
//          с любым учебником и любым предметом: индекс для него не нужен.
export type HomeworkSource = 'number' | 'photo' | 'text'

export const homeworkSolutionEngineVersion = 2

export const homeworkTaskTypes = ['construction', 'calculation', 'proof', 'mixed'] as const
export type HomeworkTaskType = typeof homeworkTaskTypes[number]

export const homeworkSceneObjectKinds = ['line', 'segment', 'ray', 'circle', 'polyline', 'polygon'] as const
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

export type HomeworkDiagramScene = {
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
