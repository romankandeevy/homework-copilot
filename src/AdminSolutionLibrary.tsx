import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  BookOpenText,
  CircleNotch,
  MagnifyingGlass,
  Trash,
  WarningCircle,
} from '@phosphor-icons/react'
import type { Json } from './lib/database.types'
import { supabase } from './lib/supabase'
import './AdminSolutionLibrary.css'

type LibrarySolution = {
  id: string
  textbookId: string
  textbookTitle: string
  edition: string
  subject: string
  task: string
  sourcePage: number | null
  condition: string
  answer: string
  accessCount: number
  createdAt: string
}

type LibraryData = {
  total: number
  totalAccesses: number
  items: LibrarySolution[]
}

const emptyLibrary: LibraryData = { total: 0, totalAccesses: 0, items: [] }

function isRecord(value: Json | undefined | null): value is Record<string, Json | undefined> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: Json | undefined, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: Json | undefined, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function parseLibrary(value: Json | null): LibraryData {
  const source = isRecord(value) ? value : {}
  const items = Array.isArray(source.items) ? source.items : []
  return {
    total: asNumber(source.total),
    totalAccesses: asNumber(source.totalAccesses),
    items: items.flatMap((item) => {
      const row = isRecord(item) ? item : null
      if (!row || !asString(row.id)) return []
      return [{
        id: asString(row.id),
        textbookId: asString(row.textbookId),
        textbookTitle: asString(row.textbookTitle, 'Учебник'),
        edition: asString(row.edition),
        subject: asString(row.subject),
        task: asString(row.task),
        sourcePage: typeof row.sourcePage === 'number' ? row.sourcePage : null,
        condition: asString(row.condition),
        answer: asString(row.answer),
        accessCount: asNumber(row.accessCount),
        createdAt: asString(row.createdAt),
      }]
    }),
  }
}

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

/* База выданных решений. Удаление - только у владельца: оно закрывает
   решение у всех, кто его открывал, и не возвращает деньги. */
export default function AdminSolutionLibrary({ canDelete = false }: { canDelete?: boolean }) {
  const [search, setSearch] = useState('')
  const [data, setData] = useState<LibraryData>(emptyLibrary)
  const [loading, setLoading] = useState(false)
  const [deleteCandidate, setDeleteCandidate] = useState<LibrarySolution | null>(null)
  const [deleteReason, setDeleteReason] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const loadLibrary = useCallback(async (query: string) => {
    if (!supabase) return
    setLoading(true)
    const { data: payload, error: listError } = await supabase.rpc('admin_list_solution_library', {
      p_search: query.trim(),
      p_limit: 100,
    })
    if (listError) setError('Не получилось загрузить базу решений.')
    else setData(parseLibrary(payload))
    setLoading(false)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadLibrary(search) }, 180)
    return () => window.clearTimeout(timer)
  }, [loadLibrary, search])

  const requestDelete = (item: LibrarySolution) => {
    setDeleteCandidate(item)
    setDeleteReason('')
    setNotice('')
    setError('')
  }

  const deleteSolution = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!deleteCandidate || actionLoading || !supabase) return
    const reason = deleteReason.trim()
    if (reason.length < 3 || reason.length > 160) {
      setError('Укажи причину удаления от 3 до 160 символов.')
      return
    }

    setActionLoading(true)
    setError('')
    const { error: deleteError } = await supabase.rpc('admin_delete_solution', {
      p_solution_id: deleteCandidate.id,
      p_reason: reason,
    })
    if (deleteError) {
      setError('Не получилось удалить решение. Обнови список и попробуй ещё раз.')
    } else {
      setNotice(`Решение № ${deleteCandidate.task} удалено из базы.`)
      setDeleteCandidate(null)
      setDeleteReason('')
      await loadLibrary(search)
    }
    setActionLoading(false)
  }

  return (
    <section className="admin-solution-library" id="solution-library" aria-labelledby="admin-solution-library-title">
      <header className="admin-solution-library-heading">
        <div>
          <h2 id="admin-solution-library-title">База решений</h2>
          <p>Решения, выданные ученикам. {canDelete ? 'Удаление закрывает доступ к решению у всех, кто его открывал.' : 'Удалять решения может только владелец.'}</p>
        </div>
        <dl aria-label="Статистика базы решений">
          <div><dt>Решений</dt><dd>{data.total.toLocaleString('ru-RU')}</dd></div>
          <div><dt>Открытий</dt><dd>{data.totalAccesses.toLocaleString('ru-RU')}</dd></div>
        </dl>
        <label className="admin-solution-search">
          <MagnifyingGlass size={18} weight="bold" aria-hidden="true" />
          <span className="sr-only">Поиск решения</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Номер, условие или учебник" />
        </label>
      </header>

      <div className="admin-solution-columns" aria-hidden="true">
        <span>Решение</span><span>Открытия</span><span>Добавлено</span><span />
      </div>

      {loading ? (
        <div className="admin-solution-state" role="status"><CircleNotch className="admin-solution-spinner" size={22} weight="bold" aria-hidden="true" /> Загружаем решения…</div>
      ) : data.items.length ? (
        <ol className="admin-solution-list">
          {data.items.map((item) => (
            <li key={item.id} className={deleteCandidate?.id === item.id ? 'is-confirming' : ''}>
              <div className="admin-solution-row">
                <div className="admin-solution-main">
                  <span><BookOpenText size={17} weight="duotone" aria-hidden="true" /> {item.subject} · № {item.task}</span>
                  <strong>{item.condition || item.textbookTitle}</strong>
                  <small>{item.textbookTitle}{item.sourcePage ? ` · стр. ${item.sourcePage}` : ''}{item.answer ? ` · Ответ: ${item.answer}` : ''}</small>
                </div>
                <span className="admin-solution-accesses">{item.accessCount.toLocaleString('ru-RU')}</span>
                <time>{formatDate(item.createdAt)}</time>
                {canDelete ? (
                  <button className="admin-solution-delete" type="button" onClick={() => requestDelete(item)} aria-label={`Удалить решение задачи № ${item.task}`}>
                    <Trash size={18} weight="bold" aria-hidden="true" />
                  </button>
                ) : <span />}
              </div>

              {canDelete && deleteCandidate?.id === item.id && (
                <form className="admin-solution-confirm" onSubmit={deleteSolution}>
                  <WarningCircle size={22} weight="duotone" aria-hidden="true" />
                  <div>
                    <strong>Удалить решение № {item.task}?</strong>
                    <p>Оно исчезнет у {item.accessCount.toLocaleString('ru-RU')} пользователей, которые его открывали. Баланс автоматически не возвращается.</p>
                    <label><span>Причина удаления</span><input autoFocus value={deleteReason} onChange={(event) => setDeleteReason(event.target.value)} minLength={3} maxLength={160} placeholder="Например, неверное решение" /></label>
                    <div className="admin-solution-confirm-actions">
                      <button type="button" onClick={() => { setDeleteCandidate(null); setDeleteReason('') }} disabled={actionLoading}>Отмена</button>
                      <button className="is-danger" type="submit" disabled={actionLoading}>{actionLoading ? 'Удаляем…' : 'Удалить решение'}</button>
                    </div>
                  </div>
                </form>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <div className="admin-solution-state"><BookOpenText size={24} weight="duotone" aria-hidden="true" /> {search ? 'По этому запросу решений нет.' : 'Выданных решений пока нет.'}</div>
      )}

      {(notice || error) && <p className={`admin-solution-feedback${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>{error || notice}</p>}
    </section>
  )
}
