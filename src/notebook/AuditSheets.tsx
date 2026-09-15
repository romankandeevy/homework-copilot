import { NotebookSheet } from './NotebookSheet'
import { auditSheetFixtures } from './auditFixtures'

/* Записи аудита 15 сентября 2026 - четырнадцать предметов одной страницей.

   Открывается только в разработке: `/?sheets=1`. Модель не зовётся,
   записи лежат в auditFixtures.ts в том виде, какой ждёт от модели
   нынешний промпт. По ним проверяется оформление листа: дробь столбиком,
   раскладка физики, таблица информатики, абзацы без «Решение» и «Ответ». */
export default function AuditSheets() {
  return (
    <main className="sheets-mode">
      {auditSheetFixtures.map((solution) => (
        <section key={solution.textbookId}>
          <h2>{solution.subject} · {solution.textbookEdition}</h2>
          <NotebookSheet solution={solution} />
        </section>
      ))}
    </main>
  )
}
