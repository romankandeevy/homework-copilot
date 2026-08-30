import { useEffect, useMemo, useState } from 'react'
import type { TextbookTaskSourceRegion, VerifiedTextbookTaskSource } from './taskCatalog'
import { renderTextbookTaskSourceImage } from './textbookTaskSource'

// Сканы учебников на сайте больше не хранятся, поэтому вырезку из страницы
// показать неоткуда. Условие мы знаем текстом — из собственного индекса,
// его и показываем. Компонент остаётся на случай, когда источник всё-таки
// доступен: например, когда ученик сам загрузил свой файл учебника.
export default function TextbookTaskSourcePreview({
  task,
  includeCondition = false,
}: {
  task: VerifiedTextbookTaskSource
  includeCondition?: boolean
}) {
  const [imageUrls, setImageUrls] = useState<string[]>([])
  const [unavailable, setUnavailable] = useState(false)
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
    setUnavailable(false)

    void Promise.all(entries.map(({ region }) => renderTextbookTaskSourceImage(task.sourceUrl, region)))
      .then((result) => {
        if (!cancelled) setImageUrls(result)
      })
      .catch(() => {
        // Файла учебника нет — это штатная ситуация, а не ошибка.
        if (!cancelled) setUnavailable(true)
      })

    return () => {
      cancelled = true
    }
  }, [entries, task.sourceUrl])

  if (unavailable) {
    return (
      <figure className="task-source-preview is-text">
        <figcaption>Условие задачи № {task.task}</figcaption>
        <blockquote>{task.condition}</blockquote>
        {task.hasDiagram && (
          <p className="task-source-note">
            В учебнике к этой задаче есть чертёж. Добавь фото задачи, чтобы решение учитывало его.
          </p>
        )}
      </figure>
    )
  }

  return (
    <div className="task-source-previews">
      {imageUrls.length > 0 ? imageUrls.map((imageUrl, index) => (
        <figure className="task-source-preview" key={`${entries[index].region.page}:${entries[index].region.x}:${entries[index].region.y}`}>
          <figcaption>{entries[index].figure ? `Рисунок ${entries[index].figure} из учебника` : 'Точное условие из учебника'}</figcaption>
          <img src={imageUrl} alt={entries[index].figure ? `Рисунок ${entries[index].figure} из учебника для задачи № ${task.task}` : `Фрагмент страницы ${task.sourcePage ?? task.sourceRegion.page} с условием задачи № ${task.task}`} />
        </figure>
      )) : (
        <div className="task-source-preview-loading" role="status">Открываем условие…</div>
      )}
    </div>
  )
}
