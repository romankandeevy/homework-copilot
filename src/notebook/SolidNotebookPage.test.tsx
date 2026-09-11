import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { solidGeometryFixture } from './fixtures'
import { GeometryNotebookLayoutV1 } from './GeometryNotebookLayoutV1'

/* 11 сентября: GeometryScene ставил невидимым рёбрам куба класс
   diagram-hidden, а стиль этого класса жил только в NotebookDiagram. На
   странице тетради у пути не было stroke, и задних рёбер не рисовалось
   вовсе. Прежний тест проверял наличие класса, а не то, что он виден. */
describe('тело на странице тетради', () => {
  it('рисует три скрытых ребра пунктиром', () => {
    const { container } = render(<GeometryNotebookLayoutV1 spec={solidGeometryFixture} />)

    expect(container.querySelectorAll('path.diagram-hidden')).toHaveLength(3)
    const styles = [...container.querySelectorAll('style')].map((node) => node.textContent ?? '').join('\n')
    const rule = /\.diagram-hidden\s*\{([^}]*)\}/u.exec(styles)?.[1] ?? ''
    expect(rule).toMatch(/stroke:\s*[^;\s]+/u)
    expect(rule).toMatch(/stroke-width:\s*[\d.]+px/u)
    expect(rule).toMatch(/stroke-dasharray:\s*\d/u)
    expect(rule).toMatch(/fill:\s*none/u)
  })
})
