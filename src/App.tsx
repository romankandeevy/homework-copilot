import { useState } from 'react'
import { fixtures, type NotebookFixture } from './fixtures'
import './App.css'

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

  return (
    <article className="solution-page" aria-label={`Лист тетради: задача ${fixture.number}`}>
      <section className="given-panel">
        <h2>Дано:</h2>
        <p>{fixture.given.split(', ')[0]}</p>
        <p>{fixture.given.split(', ')[1]}</p>
        <p>{fixture.given.split(', ')[2]}</p>
      </section>
      <div className="given-divider" aria-hidden="true" />
      <div className="goal-divider" aria-hidden="true" />
      <section className="goal-panel">
        <h2>Найти:</h2>
        <div className="goal-items">
          {goalItems.map((goalItem) => <p key={goalItem}>{goalItem}</p>)}
        </div>
      </section>

      <TriangleDiagram fixture={fixture} />

      <section className="solution-copy">
        <h2>Решение</h2>
        <div className="solution-lines">
          {fixture.solution.map((line) => <p key={line}>{line}</p>)}
        </div>
      </section>

      {fixture.answer && <p className="answer-line">Ответ:&nbsp;{fixture.answer}</p>}
    </article>
  )
}

function App() {
  const [fixtureIndex, setFixtureIndex] = useState(0)
  const fixture = fixtures[fixtureIndex]

  const selectFixture = (nextIndex: number) => {
    setFixtureIndex((nextIndex + fixtures.length) % fixtures.length)
  }

  return (
    <main className="review-shell">
      <section className="sheet-stage" aria-label="Готовый лист для переписывания">
        <SolutionSheet fixture={fixture} />
      </section>

      <footer className="review-controls" aria-label="Выбор тестовой задачи">
        <button type="button" onClick={() => selectFixture(fixtureIndex - 1)}>←</button>
        <label>
          <span className="visually-hidden">Тестовая задача</span>
          <select value={fixtureIndex} onChange={(event) => setFixtureIndex(Number(event.target.value))}>
            {fixtures.map((item, index) => (
              <option key={item.id} value={index}>Задача № {item.number}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => selectFixture(fixtureIndex + 1)}>→</button>
      </footer>
    </main>
  )
}

export default App
