import { useEffect, useMemo, useState } from 'react'
import type { TextbookTaskSourceRegion, VerifiedTextbookTaskSource } from './taskCatalog'
import { renderTextbookTaskSourceImage } from './textbookTaskSource'

export default function TextbookTaskSourcePreview({ task, includeCondition = false }: { task: VerifiedTextbookTaskSource; includeCondition?: boolean }) {
  const [imageUrls, setImageUrls] = useState<string[]>([])
  const [error, setError] = useState('')
  const entries = useMemo<Array<{ region: TextbookTaskSourceRegion; figure?: number }>>(
    () => [
      ...(includeCondition ? [{ region: task.sourceRegion }] : []),
      ...task.diagramRegions.map((region) => ({ region, figure: region.figure })),
    ],
    [includeCondition, task.diagramRegions, task.sourceRegion],
  )

  useEffect(() => {
    let cancelled = false
    setImageUrls([])
    setError('')

    void Promise.all(entries.map(({ region }) => renderTextbookTaskSourceImage(task.sourceUrl, region)))
      .then((result) => {
        if (!cancelled) setImageUrls(result)
      })
      .catch(() => {
        if (!cancelled) setError('Не получилось показать фрагмент скана')
      })

    return () => {
      cancelled = true
    }
  }, [entries, task.sourceUrl])

  return (
    <div className="task-source-previews">
      {imageUrls.length > 0 ? imageUrls.map((imageUrl, index) => (
        <figure className="task-source-preview" key={`${entries[index].region.page}:${entries[index].region.x}:${entries[index].region.y}`}>
          <figcaption>{entries[index].figure ? `Рисунок ${entries[index].figure} из учебника` : 'Точное условие из учебника'}</figcaption>
          <img src={imageUrl} alt={entries[index].figure ? `Рисунок ${entries[index].figure} из учебника для задачи № ${task.task}` : `Фрагмент страницы ${task.sourcePage ?? task.sourceRegion.page} с условием задачи № ${task.task}`} />
        </figure>
      )) : error ? (
        <p role="alert">{error}</p>
      ) : (
        <div className="task-source-preview-loading" role="status">Открываем скан…</div>
      )}
    </div>
  )
}
