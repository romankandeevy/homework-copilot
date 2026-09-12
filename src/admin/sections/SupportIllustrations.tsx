/* Иллюстрации пустых состояний поддержки: чертёж на клетке VERKSTAD.
   Только линии и токены - в тёмной теме переворачиваются вместе с ней. */

const GRID_X = [24, 48, 72, 96, 120, 144, 168, 192, 216]
const GRID_Y = [20, 44, 68, 92, 116, 140]

function Grid() {
  return (
    <g className="sup-art-grid" aria-hidden="true">
      {GRID_X.map((x) => <line key={`x${x}`} x1={x} y1={8} x2={x} y2={152} />)}
      {GRID_Y.map((y) => <line key={`y${y}`} x1={8} y1={y} x2={232} y2={y} />)}
    </g>
  )
}

function Cross({ x, y }: { x: number; y: number }) {
  return <path className="sup-art-dim" d={`M${x - 5} ${y}H${x + 5}M${x} ${y - 5}V${y + 5}`} />
}

/* Пустые входящие: открытый лоток и отметка «всё разобрано». */
export function InboxEmptyArt() {
  return (
    <svg className="sup-art" viewBox="0 0 240 160" role="presentation" aria-hidden="true" focusable="false">
      <Grid />
      <Cross x={24} y={20} />
      <Cross x={216} y={140} />
      <path className="sup-art-soft" d="M52 92H188L204 124H36Z" />
      <path className="sup-art-stroke" d="M52 92H188L204 124H36Z" />
      <path className="sup-art-stroke" d="M36 124V136H204V124" />
      <path className="sup-art-stroke" d="M80 92L92 108H148L160 92" />
      <path className="sup-art-dim" d="M36 146H204M36 142V150M204 142V150" />
      <path className="sup-art-dim" d="M214 92V124M210 92H218M210 124H218" />
      <circle className="sup-art-accent-fill" cx="120" cy="52" r="22" />
      <circle className="sup-art-accent" cx="120" cy="52" r="22" />
      <path className="sup-art-accent" d="M109 52L117 60L132 44" />
      <path className="sup-art-dim" d="M120 74V88" />
    </svg>
  )
}

/* Ничего не выбрано: две реплики переписки и курсор. */
export function PickConversationArt() {
  return (
    <svg className="sup-art" viewBox="0 0 240 160" role="presentation" aria-hidden="true" focusable="false">
      <Grid />
      <Cross x={24} y={20} />
      <Cross x={216} y={140} />
      <path className="sup-art-soft" d="M40 30H148A8 8 0 0 1 156 38V68A8 8 0 0 1 148 76H70L56 88V76H40A8 8 0 0 1 32 68V38A8 8 0 0 1 40 30Z" />
      <path className="sup-art-stroke" d="M40 30H148A8 8 0 0 1 156 38V68A8 8 0 0 1 148 76H70L56 88V76H40A8 8 0 0 1 32 68V38A8 8 0 0 1 40 30Z" />
      <path className="sup-art-stroke is-thin" d="M46 46H136M46 60H110" />
      <path className="sup-art-ink" d="M100 92H200A8 8 0 0 1 208 100V124A8 8 0 0 1 200 132H192V142L180 132H100A8 8 0 0 1 92 124V100A8 8 0 0 1 100 92Z" />
      <path className="sup-art-paper-line" d="M106 106H190M106 118H164" />
      <path className="sup-art-dim" d="M32 20H156M32 16V24M156 16V24" />
      <path className="sup-art-accent-fill" d="M168 52L168 80L175 73L181 86L186 84L180 71L190 71Z" />
      <path className="sup-art-accent" d="M168 52L168 80L175 73L181 86L186 84L180 71L190 71Z" />
    </svg>
  )
}
