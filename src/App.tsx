import { useState } from 'react'
import { fixtures, type NotebookFixture } from './fixtures'
import './App.css'

function TriangleDiagram({ fixture }: { fixture: NotebookFixture }) {
  const labels = fixture.diagram.labels

  return (
    <svg
      className="diagram"
      viewBox="0 0 320 230"
      role="img"
      aria-label={fixture.diagram.description}
    >
      <path className="diagram-line" d="M 44 190 L 274 190 L 164 35 Z" />
      {fixture.diagram.variant === 'isosceles' && (
        <>
          <path className="diagram-mark" d="M 94 111 L 107 120" />
          <path className="diagram-mark" d="M 222 120 L 235 111" />
        </>
      )}
      {fixture.diagram.variant === 'median' && (
        <>
          <path className="diagram-line diagram-auxiliary" d="M 164 35 L 159 190" />
          <path className="diagram-mark" d="M 144 181 L 144 199" />
          <path className="diagram-mark" d="M 174 181 L 174 199" />
        </>
      )}
      {fixture.diagram.variant === 'right' && (
        <path className="diagram-mark" d="M 61 190 L 61 174 L 77 174" />
      )}
      <text x="27" y="209">{labels[0]}</text>
      <text x="279" y="209">{labels[1]}</text>
      <text x="161" y="27">{labels[2]}</text>
      {fixture.diagram.variant === 'median' && <text x="150" y="209">M</text>}
    </svg>
  )
}

function NotebookPage({ fixture }: { fixture: NotebookFixture }) {
  return (
    <article className="notebook-page" aria-label={`Лист тетради: задача ${fixture.number}`}>
      <div className="margin-line" aria-hidden="true" />
      <div className="notebook-content">
        <p className="exercise-number">№ {fixture.number}</p>
        <section className="notebook-block">
          <h2>Дано:</h2>
          <p>{fixture.given}</p>
        </section>
        <section className="notebook-block goal-block">
          <h2>{fixture.goalTitle}:</h2>
          <p>{fixture.goal}</p>
        </section>
        <TriangleDiagram fixture={fixture} />
        <section className="notebook-block solution-block">
          <h2>Решение.</h2>
          {fixture.solution.map((line) => <p key={line}>{line}</p>)}
        </section>
        {fixture.answer && (
          <section className="notebook-block answer-block">
            <h2>Ответ:</h2>
            <p>{fixture.answer}</p>
          </section>
        )}
      </div>
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
      <header className="review-toolbar">
        <div>
          <p className="eyebrow">Geometry Notebook Engine</p>
          <h1>Тестовый лист</h1>
        </div>
        <div className="fixture-controls" aria-label="Выбор тестовой задачи">
          <button type="button" onClick={() => selectFixture(fixtureIndex - 1)}>←</button>
          <label>
            <span className="visually-hidden">Тестовая задача</span>
            <select value={fixtureIndex} onChange={(event) => setFixtureIndex(Number(event.target.value))}>
              {fixtures.map((item, index) => (
                <option key={item.id} value={index}>№ {item.number}</option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => selectFixture(fixtureIndex + 1)}>→</button>
        </div>
      </header>

      <section className="problem-context" aria-label="Условие задачи">
        <p className="problem-label">Условие</p>
        <p>{fixture.condition}</p>
        <p className="fixture-status">Фикстура · AI не подключён</p>
      </section>

      <section className="sheet-stage" aria-label="Готовый лист для переписывания">
        <NotebookPage fixture={fixture} />
      </section>
    </main>
  )
}

export default App
