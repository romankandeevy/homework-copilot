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
function NumberLineRegion({ from, to, y, closedLeft, closedRight }: {
  from: number
  to: number
  y: number
  closedLeft: boolean
  closedRight: boolean
}) {
  const top = y - capHeight
  /* Имя клипа собирается из собственных координат уголка.

     На листе с четырьмя пунктами каждая прямая - отдельная картинка, и
     счётчик useId у всех начинался заново: id совпадали, браузер брал
     первый clipPath документа, и штриховку остальных резал чужой
     прямоугольник - под уголком оставалась пустая рамка. */
  const clipId = `nl-${Math.round(from)}-${Math.round(to)}-${Math.round(y)}`
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

function NumberLineRow({ line, y, left, right, showLabel = true }: {
  line: Line
  y: number
  left: number
  right: number
  showLabel?: boolean
}) {
  const at = scaleOf(line, left, right)
  /* Уголок не заходит на остриё стрелки: иначе конец оси распухает и
     стрелка читается не как направление, а как часть штриховки. */
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
          <NumberLineRegion
            from={from}
            to={to}
            y={y}
            closedLeft={region.from !== null}
            closedRight={region.to !== null}
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

   В тетради прямая стоит не общим блоком наверху, а напротив своего
   пункта, рядом с его ответом. Поэтому у пункта своя картинка со своим
   окном: подпись «а)» там уже стоит в строке решения, и на самой прямой
   она не нужна. */
const figureBox = { width: 460, height: 126, padding: 18, axisY: 66 }

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
        .notebook-number-line .diagram-axis { fill: none; stroke: ${layout.colors.pencil}; stroke-width: ${layout.strokes.marker * 0.6}px; stroke-linecap: round; stroke-linejoin: round; }
        .notebook-number-line .diagram-axis-label { fill: ${layout.colors.pencil}; font-family: ${layout.typography.family}; font-weight: ${layout.typography.weight}; font-size: 22px; }
        .notebook-number-line .diagram-tick-label { fill: ${layout.colors.pencil}; font-family: ${layout.typography.family}; font-weight: ${layout.typography.weight}; font-size: 19px; }
        .notebook-number-line .number-line-cap { fill: none; stroke: ${layout.colors.pencil}; stroke-width: ${layout.strokes.marker * 0.6}px; stroke-linecap: round; stroke-linejoin: round; }
        .notebook-number-line .number-line-hatch { fill: none; stroke: ${layout.colors.pencil}; stroke-width: ${layout.strokes.marker * 0.5}px; stroke-linecap: round; }
        .notebook-number-line .number-line-point-filled { fill: ${layout.colors.pencil}; stroke: ${layout.colors.pencil}; stroke-width: ${layout.strokes.marker * 0.6}px; }
        .notebook-number-line .number-line-point-hollow { fill: ${layout.colors.paper}; stroke: ${layout.colors.pencil}; stroke-width: ${layout.strokes.marker * 0.6}px; }
      `}</style>
    </svg>
  )
}
