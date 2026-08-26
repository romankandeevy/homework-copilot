import { useEffect, useMemo, useState } from 'react'
import type { VerifiedTextbookTaskSource } from './taskCatalog'
import { renderTextbookTaskSourceImage } from './textbookTaskSource'

export default function TextbookTaskSourcePreview({ task }: { task: VerifiedTextbookTaskSource }) {
  const [imageUrls, setImageUrls] = useState<string[]>([])
  const [error, setError] = useState('')
  const regions = useMemo(
    () => task.diagramRegions.length > 0 ? task.diagramRegions : [task.sourceRegion],
    [task.diagramRegions, task.sourceRegion],
  )

  useEffect(() => {
    let cancelled = false
    setImageUrls([])
    setError('')

    void Promise.all(regions.map((region) => renderTextbookTaskSourceImage(task.sourceUrl, region)))
      .then((result) => {
        if (!cancelled) setImageUrls(result)
      })
      .catch(() => {
        if (!cancelled) setError('Не получилось показать фрагмент скана')
      })

    return () => {
      cancelled = true
    }
  }, [regions, task.sourceUrl])

  return (
    <div className="task-source-previews">
      {imageUrls.length > 0 ? imageUrls.map((imageUrl, index) => (
        <figure className="task-source-preview" key={`${regions[index].page}:${regions[index].x}:${regions[index].y}`}>
          <figcaption>{task.diagramRegions[index] ? `Рисунок ${task.diagramRegions[index].figure} из учебника` : 'Точный фрагмент учебника'}</figcaption>
          <img src={imageUrl} alt={task.diagramRegions[index] ? `Рисунок ${task.diagramRegions[index].figure} из учебника для задачи № ${task.task}` : `Фрагмент страницы ${task.sourcePage ?? task.sourceRegion.page} с условием задачи № ${task.task}`} />
        </figure>
      )) : error ? (
        <p role="alert">{error}</p>
      ) : (
        <div className="task-source-preview-loading" role="status">Открываем скан…</div>
      )}
    </div>
  )
}
