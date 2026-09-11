/* Раскладка подписей на чертеже.

   Раскладчиков было три и они не знали друг о друге: буквы вершин в
   GeometryScene, имена линий там же отдельной функцией и подписи элементов
   в SchematicScene. Подписи осей, делений, графиков и значков не
   участвовали ни в одной из них.

   Отсюда график по обществознанию с проде 7 сентября: «S₀» и «S₁» легли
   друг на друга и на саму кривую. Кривая не считалась препятствием, а
   подпись графика вставала у последней точки внутри поля, ни на кого не
   глядя.

   Второе: сравнивались точки-якоря, а не занятое место. «S₀ = 40» шире
   буквы «A» впятеро, но для прежнего счёта они были одинаковы. Здесь у
   подписи есть ширина и высота, и мерится перекрытие прямоугольников. */

export type LabelRect = { x: number; y: number; width: number; height: number }

export type Anchor = 'start' | 'middle' | 'end'

export type Segment = readonly [{ x: number; y: number }, { x: number; y: number }]

/* Ширина строки без измерения текста.

   Настоящую ширину знает только браузер, а чертёж считается и на сервере
   в тестах. Доля 0,55 от кегля - средняя ширина знака этого шрифта:
   заниженная оценка хуже завышенной, поэтому берём с запасом. */
const averageGlyphRatio = 0.55
// Индекс «₁» набран мельче буквы: считать его полным знаком значит
// отодвигать «T₁» и «A₁» от соседей дальше, чем нужно.
const subscriptGlyphRatio = 0.35
const subscriptGlyph = /[₀-₉ₐ-ₜ]/u

export function labelWidth(label: string, fontSize: number) {
  const units = [...label].reduce((sum, glyph) => sum + (subscriptGlyph.test(glyph) ? subscriptGlyphRatio : averageGlyphRatio), 0)
  return Math.max(averageGlyphRatio, units) * fontSize
}

export function labelRect(x: number, y: number, label: string, fontSize: number, anchor: Anchor = 'start'): LabelRect {
  const width = labelWidth(label, fontSize)
  const height = fontSize
  const left = anchor === 'end' ? x - width : anchor === 'middle' ? x - width / 2 : x
  // y текста в SVG - базовая линия: прямоугольник поднимаем над ней.
  return { x: left, y: y - height * 0.78, width, height }
}

export function rectsOverlap(first: LabelRect, second: LabelRect) {
  return first.x < second.x + second.width
    && second.x < first.x + first.width
    && first.y < second.y + second.height
    && second.y < first.y + first.height
}

/* Насколько прямоугольники разошлись.

   Ноль и меньше - наложились: чем глубже, тем хуже. Положительное число -
   зазор между ними по ближней оси. */
export function rectGap(first: LabelRect, second: LabelRect) {
  const horizontal = Math.max(second.x - (first.x + first.width), first.x - (second.x + second.width))
  const vertical = Math.max(second.y - (first.y + first.height), first.y - (second.y + second.height))
  return Math.max(horizontal, vertical)
}

export function segmentDistance(point: { x: number; y: number }, start: { x: number; y: number }, end: { x: number; y: number }) {
  const length = Math.hypot(end.x - start.x, end.y - start.y)
  if (length === 0) return Math.hypot(point.x - start.x, point.y - start.y)
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) / (length * length)))
  return Math.hypot(point.x - (start.x + (end.x - start.x) * t), point.y - (start.y + (end.y - start.y) * t))
}

/* Расстояние от прямоугольника подписи до отрезка чертежа.

   Меряем от середины и от четырёх углов: подпись, задевающая линию только
   краем, для расстояния по центру выглядела бы свободной. */
export function rectToSegment(rect: LabelRect, segment: Segment) {
  const [start, end] = segment
  const corners = [
    { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height },
    { x: rect.x + rect.width, y: rect.y + rect.height },
  ]
  return corners.reduce((closest, corner) => Math.min(closest, segmentDistance(corner, start, end)), Infinity)
}

/* Занятые места чертежа: подписи, которые уже поставлены.

   Копится по ходу отрисовки, поэтому порядок важен: сначала то, у чего
   места нет вовсе - оси, деления, значки, - потом то, что можно подвинуть. */
export class LabelLayout {
  private readonly taken: LabelRect[] = []

  reserve(rect: LabelRect) {
    this.taken.push(rect)
    return rect
  }

  reserveText(x: number, y: number, label: string, fontSize: number, anchor: Anchor = 'start') {
    if (!label) return null
    return this.reserve(labelRect(x, y, label, fontSize, anchor))
  }

  /* Насколько свободно место. Отрицательное - подпись на что-то легла. */
  clearance(rect: LabelRect) {
    return this.taken.reduce((closest, other) => Math.min(closest, rectGap(rect, other)), Infinity)
  }

  get rects(): readonly LabelRect[] {
    return this.taken
  }
}

/* Счёт места под подпись: чем дальше от линий, точек и чужих подписей, тем
   выше. Наложение на чужую подпись - тяжелее наложения на линию: буква
   поверх линии в тетради читается, буква поверх буквы - нет. */
export function placementScore(args: {
  rect: LabelRect
  layout: LabelLayout
  edges: readonly Segment[]
  points: readonly { x: number; y: number }[]
  clearance: number
}) {
  const { rect, layout, edges, points, clearance } = args
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }

  const fromLabels = layout.clearance(rect)
  const fromEdges = edges.reduce((closest, edge) => Math.min(closest, rectToSegment(rect, edge)), Infinity)
  const fromPoints = points.reduce((closest, point) => Math.min(closest, Math.hypot(center.x - point.x, center.y - point.y)), Infinity)

  /* Наложение - не «немного хуже», а отдельный разряд.

     Счёт был линейным, и место, где подпись задевала чужую на полпикселя,
     выигрывало у свободного места чуть ближе к линии: разница в пол-очка
     против нескольких очков за отход от чертежа. Поэтому у пересечения свой
     штраф, вне линейной шкалы, а глубина пересечения различает уже сами
     плохие места между собой. */
  const labelTerm = fromLabels >= 0
    ? Math.min(fromLabels, clearance * 2) * 2
    : fromLabels * 8 - clearance * 6

  return labelTerm
    + Math.min(fromEdges, clearance)
    + Math.min(fromPoints, clearance * 2)
}
