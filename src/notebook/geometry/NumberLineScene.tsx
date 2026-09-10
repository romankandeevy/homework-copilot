import type { HomeworkNumberLine } from '../../lib/homeworkContract'
import { geometryNotebookLayoutV1 as layout } from '../layouts/geometryNotebookLayoutV1'
import { keyed } from '../../lib/listKeys'

/* Координатная прямая.

   Школьный ответ к неравенству - не только промежуток в скобках, но и
   картинка: ось со стрелкой, выколотая или закрашенная точка на границе и
   множество решений, заштрихованное косыми штрихами прямо над осью. Без
   жирной линии поверх оси и без «крышки» над штриховкой: 10 сентября
   образец из тетради - штрихи растут от самой оси и обрываются у точки.

   Масштаб у каждой прямой свой: числа пунктов между собой не связаны, и
   общая шкала на -2,5 и 2/7 сжала бы обе картинки в точку у нуля. */

const sceneLayout = layout.zones.diagram.scene

/* Место под подпись пункта слева и под «x» справа: ось короче поля, иначе
   стрелка упирается в букву переменной, а «а)» налезает на начало оси. */
const gutterLeft = 74
const gutterRight = 44

const pointRadius = 11
const arrowLength = 16
const maxLineHeight = 132

/* Штриховка над множеством решений: высота штриха, его наклон и шаг.
   Штрих наклонён влево - «\», как рисуют от руки правой рукой. */
const hatchHeight = 40
const hatchLean = 24
const hatchStep = 16

type Line = HomeworkNumberLine['lines'][number]

/* Куда лечь числам этой прямой.

   Границы промежутков стоят не по краям оси, а внутри: за точкой должен
   остаться видимый кусок луча в обе стороны, иначе «x > -2,5» читается как
   «x кончается на -2,5». Одна точка - симметричные поля по единице. */
function scaleOf(line: Line, left: number, right: number) {
  const values = line.marks.map((mark) => mark.value)
  const min = values.length > 0 ? Math.min(...values) : 0
  const max = values.length > 0 ? Math.max(...values) : 1
  const span = max - min
  const pad = span > 1e-9 ? span * 0.6 : 1
  const from = min - pad
  const to = max + pad
  return (value: number) => left + ((value - from) / (to - from)) * (right - left)
}

/* Множество решений: косые штрихи над осью.

   Штрих растёт от оси вверх и влево. Штрихи режутся по полосе над самим
   промежутком, поэтому не заходят за граничную точку: где кончается
   штриховка, там кончается и множество. */
function NumberLineRegion({ from, to, y }: { from: number; to: number; y: number }) {
  const top = y - hatchHeight
  /* Имя клипа собирается из собственных координат полосы.

     На листе с четырьмя пунктами каждая прямая - отдельная картинка, и
     счётчик useId у всех начинался заново: id совпадали, браузер брал
     первый clipPath документа, и штриховку остальных резал чужой
     прямоугольник. */
  const clipId = `nl-${Math.round(from)}-${Math.round(to)}-${Math.round(y)}`
  const strokes: string[] = []
  for (let x = from; x < to + hatchLean; x += hatchStep) {
    strokes.push(`M ${x} ${y} L ${x - hatchLean} ${top}`)
  }

  return (
    <g className="number-line-region">
      <clipPath id={clipId}>
        <rect x={from} y={top - 2} width={to - from} height={hatchHeight + 2} />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>
        {keyed(strokes, (stroke) => stroke).map(({ key, item: stroke }) => (
          <path className="number-line-hatch" d={stroke} key={key} />
        ))}
      </g>
    </g>
  )
}

function NumberLineRow({ line, y, left, right, showLabel = true }: {
  line: Line
  y: number
  left: number
  right: number
  showLabel?: boolean
}) {
  const at = scaleOf(line, left, right)
  /* Штриховка не заходит на остриё стрелки: иначе стрелка читается не
     как направление, а как часть штриховки. */
  const clamp = (value: number) => Math.min(Math.max(value, left), right - arrowLength)
  const label = showLabel ? line.label.trim() : ''
  const variable = line.variable.trim() || 'x'

  return (
    <g className="number-line-row">
      {label && (
        <text className="diagram-axis-label" textAnchor="end" x={left - 22} y={y + 12}>{label}</text>
      )}
      <path className="diagram-axis" d={`M ${left} ${y} L ${right} ${y}`} />
      <path
        className="diagram-axis"
        d={`M ${right - arrowLength} ${y - arrowLength / 2} L ${right} ${y} L ${right - arrowLength} ${y + arrowLength / 2}`}
      />
      <text className="diagram-axis-label" textAnchor="start" x={right + 12} y={y + 14}>{variable}</text>
      {keyed(line.regions, (region) => `region-${region.from}-${region.to}`).map(({ key, item: region }) => {
        const from = clamp(region.from === null ? left : at(region.from))
        const to = clamp(region.to === null ? right : at(region.to))
        if (to - from < 1) return null
        return (
          <NumberLineRegion from={from} to={to} y={y} key={key} />
        )
      })}
      {keyed(line.marks, (mark) => `mark-${mark.value}`).map(({ key, item: mark }) => {
        const x = at(mark.value)
        return (
          <g key={key}>
            <circle
              className={mark.filled ? 'number-line-point-filled' : 'number-line-point-hollow'}
              cx={x}
              cy={y}
              r={pointRadius}
            />
            {mark.label.trim() && (
              <text className="diagram-tick-label" textAnchor="middle" x={x} y={y + 40}>{mark.label.trim()}</text>
            )}
          </g>
        )
      })}
    </g>
  )
}

export function NumberLineScene({ numberLine, description }: { numberLine: HomeworkNumberLine; description: string }) {
  const lines = numberLine.lines.slice(0, 6)
  if (lines.length === 0) return null

  /* Прямые делят поле поровну и стоят по его середине: две прямые не
     жмутся к верхнему краю, четыре не наезжают друг на друга подписями. */
  const step = Math.min(maxLineHeight, (sceneLayout.height - sceneLayout.padding * 2) / lines.length)
  const top = sceneLayout.y + sceneLayout.height / 2 - (step * lines.length) / 2 + step / 2

  return (
    <g className="geometry-diagram number-line" role="img" aria-label={description || 'Координатная прямая'}>
      {keyed(lines, (line) => `line-${line.label}`).map(({ key, item: line }, index) => (
        <NumberLineRow
          line={line}
          y={top + step * index}
          left={sceneLayout.x + sceneLayout.padding + gutterLeft}
          right={sceneLayout.x + sceneLayout.width - sceneLayout.padding - gutterRight}
          key={key}
        />
      ))}
    </g>
  )
}


/* Прямая одного пункта - отдельная картинка.

   В тетради прямая стоит не общим блоком наверху, а под своим пунктом,
   над его ответом. Поэтому у пункта своя картинка со своим окном: подпись
   «а)» там уже стоит в строке решения, и на самой прямой она не нужна. */
const figureBox = { width: 720, height: 128, padding: 18, axisY: 72 }

export function NumberLineFigure({ line, description }: { line: Line; description: string }) {
  return (
    <svg
      className="notebook-number-line"
      viewBox={`0 0 ${figureBox.width} ${figureBox.height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={description || `Множество решений: ${line.answer || line.label}`}
    >
      <g className="geometry-diagram number-line">
        <NumberLineRow
          line={line}
          y={figureBox.axisY}
          left={figureBox.padding}
          right={figureBox.width - figureBox.padding - 26}
          showLabel={false}
        />
      </g>
      {/* Своя картинка - свои стили: правила чертежа живут в <style> листа,
          а прямая пункта стоит отдельным svg внутри строк решения. */}
      <style>{`
        .notebook-number-line .geometry-diagram { opacity: ${layout.strokes.pencilOpacity}; }
        .notebook-number-line .diagram-axis { fill: none; stroke: ${layout.colors.ink}; stroke-width: ${layout.strokes.marker}px; stroke-linecap: round; stroke-linejoin: round; }
        .notebook-number-line .diagram-axis-label { fill: ${layout.colors.ink}; font-family: ${layout.typography.family}; font-weight: ${layout.typography.weight}; font-size: 30px; }
        .notebook-number-line .diagram-tick-label { fill: ${layout.colors.ink}; font-family: ${layout.typography.family}; font-weight: ${layout.typography.weight}; font-size: 28px; }
        .notebook-number-line .number-line-hatch { fill: none; stroke: ${layout.colors.ink}; stroke-width: ${layout.strokes.marker * 0.8}px; stroke-linecap: round; }
        .notebook-number-line .number-line-point-filled { fill: ${layout.colors.ink}; stroke: ${layout.colors.ink}; stroke-width: ${layout.strokes.marker}px; }
        .notebook-number-line .number-line-point-hollow { fill: ${layout.colors.paper}; stroke: ${layout.colors.ink}; stroke-width: ${layout.strokes.marker}px; }
      `}</style>
    </svg>
  )
}
