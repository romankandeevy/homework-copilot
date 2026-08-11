import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { geometryFixtures } from './fixtures'
import { GeometryNotebookLayoutV1 } from './GeometryNotebookLayoutV1'
import { assertGeometryNotebookLayoutV1, geometryNotebookLayoutV1 as layout } from './layouts/geometryNotebookLayoutV1'

describe('GeometryNotebookLayoutV1', () => {
  it('keeps the approved divider joint and diagram invariants', () => {
    expect(assertGeometryNotebookLayoutV1()).toBe(true)
    expect(layout.zones.divider.horizontal.endX).toBe(layout.zones.divider.vertical.x)
    expect(layout.invariants.angleArcCountAtB).toBe(1)
  })

  it('renders one angle arc at B for fixture 123', () => {
    const { container } = render(<GeometryNotebookLayoutV1 spec={geometryFixtures[0]} />)

    expect(container.querySelectorAll('[data-angle-arc="B"]')).toHaveLength(1)
    expect(screen.getByText('Решение.', { selector: '.notebook-title' })).toBeInTheDocument()
  })
})
