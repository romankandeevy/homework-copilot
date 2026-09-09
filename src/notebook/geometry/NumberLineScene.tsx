import { useId } from 'react'
import type { HomeworkNumberLine } from '../../lib/homeworkContract'
import { geometryNotebookLayoutV1 as layout } from '../layouts/geometryNotebookLayoutV1'
import { keyed } from '../../lib/listKeys'

/* Координатная прямая.

   Школьный ответ к неравенству - не только промежуток в скобках, но и
   картинка: ось со стрелкой, выколотая или закрашенная точка на границе и
   множество решений, забранное сверху уголком и заштрихованное наискось.
   Именно так это чертят в тетради: не жирная линия поверх оси, а «крышка»
   от граничной точки вверх и вдоль луча, а под ней штриховка. Пунктов в
   задании обычно четыре, поэтому прямых на чертеже столько же и стоят они
   друг под другом, как в тетради.

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

/* Уголок над множеством решений: высота крышки и шаг штриховки. Штрихи
   идут под 45°, как рисуют от руки. */
const capHeight = 30
const hatchStep = 14

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

/* Множество решений: уголок над лучом и штриховка под ним.

   Вертикальная стенка ставится только у конечного конца - там, где стоит
   точка. Со стороны бесконечности уголок обрывается вместе с осью, как в
   тетради. Штрихи режутся по прямоугольнику уголка, поэтому не торчат за
   его края. */
function NumberLineRegion({ from, to, y, closedLeft, closedRight, clipId }: {
  from: number
  to: number
  y: number
  closedLeft: boolean
  closedRight: boolean
  clipId: string
}) {
  const top = y - capHeight
  const cap = [
    closedLeft ? `M ${from} ${y} L ${from} ${top}` : `M ${from} ${top}`,
    `L ${to} ${top}`,
    closedRight ? `L ${to} ${y}` : '',
  ].join(' ')
  const strokes: string[] = []
  for (let x = from - capHeight; x < to; x += hatchStep) {
    strokes.push(`M ${x} ${y} L ${x + capHeight} ${top}`)
  }

  return (
    <g className="number-line-region">
      <clipPath id={clipId}>
        <rect x={from} y={top} width={to - from} height={capHeight} />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>
        {keyed(strokes, (stroke) => stroke).map(({ key, item: stroke }) => (
          <path className="number-line-hatch" d={stroke} key={key} />
        ))}
      </g>
      <path className="number-line-cap" d={cap} />
    </g>
  )
}

function NumberLineRow({ line, y }: { line: Line; y: number }) {
  const left = sceneLayout.x + sceneLayout.padding + gutterLeft
  const right = sceneLayout.x + sceneLayout.width - sceneLayout.padding - gutterRight
  const at = scaleOf(line, left, right)
  /* Уголок не заходит на остриё стрелки: иначе конец оси распухает и
     стрелка читается не как направление, а как часть штриховки. */
  const clamp = (value: number) => Math.min(Math.max(value, left), right - arrowLength)
  const clipPrefix = useId()
  const label = line.label.trim()
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
      {keyed(line.regions, (region) => `region-${region.from}-${region.to}`).map(({ key, item: region }, index) => {
        const from = clamp(region.from === null ? left : at(region.from))
        const to = clamp(region.to === null ? right : at(region.to))
        if (to - from < 1) return null
        return (
          <NumberLineRegion
            from={from}
            to={to}
            y={y}
            closedLeft={region.from !== null}
            closedRight={region.to !== null}
            clipId={`${clipPrefix}-${index}`}
            key={key}
          />
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
              <text className="diagram-tick-label" textAnchor="middle" x={x} y={y + 44}>{mark.label.trim()}</text>
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
        <NumberLineRow line={line} y={top + step * index} key={key} />
      ))}
    </g>
  )
}
