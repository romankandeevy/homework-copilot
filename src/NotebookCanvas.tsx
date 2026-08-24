import { fixtures } from './fixtures'
import { GeometryNotebookLayoutV1 } from './notebook/GeometryNotebookLayoutV1'

export default function NotebookCanvas() {
  return <main className="canvas-mode"><GeometryNotebookLayoutV1 spec={fixtures[0]} /></main>
}
