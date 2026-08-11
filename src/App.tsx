import { useState } from 'react'
import { GeometryNotebookLayoutV1 } from './notebook/GeometryNotebookLayoutV1'
import { fixtures } from './fixtures'
import './App.css'

function App() {
  const [fixtureIndex, setFixtureIndex] = useState(0)
  const fixture = fixtures[fixtureIndex]
  const canvasMode = new URLSearchParams(window.location.search).get('canvas') === '1'

  if (canvasMode) {
    return (
      <main className="canvas-mode">
        <GeometryNotebookLayoutV1 spec={fixtures[0]} />
      </main>
    )
  }

  return (
    <main className="review-shell">
      <header className="review-toolbar">
        <div>
          <p className="eyebrow">Geometry Notebook Engine</p>
          <h1>Тестовый лист</h1>
        </div>
        <div className="fixture-controls" aria-label="Выбор тестовой задачи">
          <button type="button" onClick={() => setFixtureIndex((fixtureIndex - 1 + fixtures.length) % fixtures.length)}>←</button>
          <label>
            <span className="visually-hidden">Тестовая задача</span>
            <select value={fixtureIndex} onChange={(event) => setFixtureIndex(Number(event.target.value))}>
              {fixtures.map((item, index) => <option key={item.id} value={index}>№ {item.number}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => setFixtureIndex((fixtureIndex + 1) % fixtures.length)}>→</button>
        </div>
      </header>

      <section className="problem-context" aria-label="Условие задачи">
        <p className="problem-label">Условие</p>
        <p>{fixture.condition}</p>
        <p className="fixture-status">Фикстура · AI не подключён</p>
      </section>

      <section className="sheet-stage" aria-label="Готовый лист для переписывания">
        <GeometryNotebookLayoutV1 spec={fixture} />
      </section>
    </main>
  )
}

export default App
