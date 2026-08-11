import { fixtures, task105Fixture, type NotebookFixture } from './fixtures'
import './App.css'

function PerpendicularDiagram({ fixture }: { fixture: NotebookFixture }) {
  return (
    <svg
      className="diagram construction-diagram"
      viewBox="0 0 420 250"
      role="img"
      aria-label={fixture.diagram.description}
    >
      <path className="diagram-line" d="M 24 130 H 396" />
      <path className="diagram-line" d="M 128 45 V 130" />
      <path className="diagram-line" d="M 294 130 V 215" />
      <path className="diagram-mark" d="M 128 113 H 145 V 130" />
      <path className="diagram-mark" d="M 277 130 H 294 V 147" />
      <circle className="diagram-point" cx="128" cy="45" r="3.8" />
      <circle className="diagram-point" cx="294" cy="215" r="3.8" />
      <text className="diagram-label" x="99" y="38">A</text>
      <text className="diagram-label" x="310" y="226">B</text>
      <text className="diagram-small-label" x="122" y="151">C</text>
      <text className="diagram-small-label" x="303" y="119">D</text>
      <text className="line-label" x="370" y="119">a</text>
    </svg>
  )
}

function TriangleDiagram({ fixture }: { fixture: NotebookFixture }) {
  const labels = fixture.diagram.labels

  return (
    <svg
      className="diagram"
      viewBox="0 0 420 250"
      role="img"
      aria-label={fixture.diagram.description}
    >
      <path className="diagram-line" d="M 60 180 L 340 180 L 200 55 Z" />
      {fixture.diagram.variant === 'isosceles' && (
        <>
          <path className="diagram-mark" d="M 119 109 L 136 121" />
          <path className="diagram-mark" d="M 270 121 L 287 109" />
          <path className="angle-mark" d="M 182 73 Q 200 91 218 73" />
          <text className="angle-value" x="200" y="111">40*</text>
        </>
      )}
      {fixture.diagram.variant === 'median' && (
        <>
          <path className="diagram-auxiliary" d="M 200 55 L 200 180" />
          <path className="diagram-mark" d="M 183 171 L 183 189" />
          <path className="diagram-mark" d="M 217 171 L 217 189" />
          <text className="diagram-small-label" x="191" y="203">M</text>
        </>
      )}
      {fixture.diagram.variant === 'right' && (
        <path className="diagram-mark" d="M 76 180 L 76 164 L 92 164" />
      )}
      <text className="diagram-label label-a" x="-14" y="225">{labels[0]}</text>
      <text className="diagram-label label-c" x="378" y="225">{labels[1]}</text>
      <text className="diagram-label label-b" x="190" y="62">{labels[2]}</text>
    </svg>
  )
}

function SolutionSheet({ fixture }: { fixture: NotebookFixture }) {
  const goalItems = fixture.goalItems ?? [fixture.goal]
  const givenLines = fixture.givenLines ?? fixture.given.split(', ')

  return (
    <article
      className={`solution-page${fixture.diagram.kind === 'perpendiculars' ? ' construction-page' : ''}`}
      aria-label={`Лист тетради: задача ${fixture.number}`}
    >
      {fixture.id === task105Fixture.id && <p className="exercise-number">№ 105</p>}
      <section className="given-panel">
        <h2>Дано:</h2>
        {givenLines.map((line) => <p key={line}>{line}</p>)}
      </section>
      <div className="given-divider" aria-hidden="true" />
      <div className="goal-divider" aria-hidden="true" />
      <section className="goal-panel">
        <h2>{fixture.goalTitle}:</h2>
        <div className="goal-items">
          {goalItems.map((goalItem) => <p key={goalItem}>{goalItem}</p>)}
        </div>
      </section>

      {fixture.diagram.kind === 'perpendiculars'
        ? <PerpendicularDiagram fixture={fixture} />
        : <TriangleDiagram fixture={fixture} />}

      <section className="solution-copy">
        <h2>{fixture.solutionTitle ?? 'Решение'}</h2>
        <div className="solution-lines">
          {fixture.solution.map((line) => <p key={line}>{line}</p>)}
        </div>
      </section>

      {fixture.answer && <p className="answer-line">Ответ:&nbsp;{fixture.answer}</p>}
    </article>
  )
}

function App() {
  return (
    <main className="review-shell">
      <section className="sheet-stage" aria-label="Готовые листы для переписывания">
        <SolutionSheet fixture={fixtures[0]} />
        <SolutionSheet fixture={task105Fixture} />
      </section>
    </main>
  )
}

export default App
