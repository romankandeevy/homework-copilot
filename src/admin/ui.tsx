/* Общие детали интерфейса админки: панели, таблицы с серверной
   пагинацией, графики на SVG, окна, уведомления и состояние в адресе.
   Внешних библиотек нет: всё рисуется на токенах сайта. */

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, CaretLeft, CaretRight, CaretUpDown, CircleNotch, Copy, DownloadSimple, X } from '@phosphor-icons/react'
import { formatNumber, formatShortDate, shiftDate, todayMsk } from './api'

/* ---------- Кнопки и метки ---------- */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** primary - чернила, accent - вермильон (одно главное действие на экран), secondary - контур. */
  variant?: 'primary' | 'accent' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md'
  loading?: boolean
  icon?: ReactNode
}

export function Button({ variant = 'secondary', size = 'md', loading = false, icon, children, className = '', disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={`adm-button is-${variant} is-${size}${className ? ` ${className}` : ''}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? <CircleNotch className="adm-spin" size={16} weight="bold" aria-hidden="true" /> : icon}
      {children && <span>{children}</span>}
    </button>
  )
}

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent'

export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span className={`adm-badge is-${tone}`} title={title}>{children}</span>
}

export function CopyButton({ value, label = 'Скопировать' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="adm-icon-button is-small"
      aria-label={label}
      title={copied ? 'Скопировано' : label}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1400)
        })
      }}
    >
      <Copy size={14} weight="bold" aria-hidden="true" />
    </button>
  )
}

/* ---------- Панели и показатели ---------- */

export function Panel({ title, description, actions, children, className = '', id }: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  id?: string
}) {
  return (
    <section className={`adm-panel${className ? ` ${className}` : ''}`} id={id}>
      {(title || actions) && (
        <header className="adm-panel-header">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {actions && <div className="adm-panel-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="adm-page-header">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="adm-page-actions">{actions}</div>}
    </header>
  )
}

export function DeltaMark({ value, invert = false }: { value: number | null; invert?: boolean }) {
  if (value === null) return <span className="adm-delta is-flat" title="Сравнивать не с чем">—</span>
  const rounded = Math.round(value * 10) / 10
  if (rounded === 0) return <span className="adm-delta is-flat">0 %</span>
  const good = invert ? rounded < 0 : rounded > 0
  return (
    <span className={`adm-delta ${good ? 'is-good' : 'is-bad'}`}>
      {rounded > 0 ? <ArrowUp size={12} weight="bold" aria-hidden="true" /> : <ArrowDown size={12} weight="bold" aria-hidden="true" />}
      {formatNumber(Math.abs(rounded))} %
    </span>
  )
}

export function Stat({ label, value, hint, delta, invert, tone }: {
  label: string
  value: ReactNode
  hint?: ReactNode
  delta?: number | null
  invert?: boolean
  tone?: Tone
}) {
  return (
    <div className={`adm-stat${tone ? ` is-${tone}` : ''}`}>
      <strong className="adm-stat-value">{value}</strong>
      <span className="adm-stat-label">{label}</span>
      <span className="adm-stat-foot">
        {delta !== undefined && <DeltaMark value={delta} invert={invert} />}
        {hint && <small>{hint}</small>}
      </span>
    </div>
  )
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="adm-stat-grid">{children}</div>
}

/* ---------- Состояния ---------- */

export function LoadingState({ label = 'Загружаем…' }: { label?: string }) {
  return <div className="adm-state" role="status"><CircleNotch className="adm-spin" size={20} weight="bold" aria-hidden="true" /> {label}</div>
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="adm-state is-empty">{children}</div>
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="adm-state is-error" role="alert">
      <span>{message}</span>
      {onRetry && <Button size="sm" onClick={onRetry}>Повторить</Button>}
    </div>
  )
}

/* ---------- Загрузка данных ---------- */

export function useAsync<T>(loader: () => Promise<T>, deps: readonly unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [version, setVersion] = useState(0)
  const loaderRef = useRef(loader)
  loaderRef.current = loader

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    loaderRef.current()
      .then((result) => { if (active) setData(result) })
      .catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : 'Не получилось загрузить данные.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version])

  const reload = useCallback(() => setVersion((current) => current + 1), [])
  return { data, error, loading, reload, setData }
}

/* ---------- Состояние в адресе ---------- */

/* Фильтры, сортировка и страница живут в адресе: ссылку на отфильтрованную
   таблицу можно отправить, а «назад» возвращает прежний вид.

   Адрес переживает перезагрузку, но не переход в раздел через меню или
   Ctrl+K: там адрес собирается заново, без фильтров. Поэтому раздел может
   попросить запоминать часть ключей (persist) в localStorage: если в адресе
   нет ни одного из них, берутся последние сохранённые и пишутся в адрес. */
type QueryStateOptions<T> = { storageKey?: string; persist?: readonly (keyof T & string)[] }

function readStoredQuery<T extends Record<string, string>>(storageKey: string, keys: readonly (keyof T & string)[]): Partial<T> | null {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? 'null')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const source = parsed as Record<string, unknown>
    const picked: Partial<T> = {}
    for (const key of keys) if (typeof source[key] === 'string') picked[key] = source[key] as T[typeof key]
    return picked
  } catch {
    return null
  }
}

function writeStoredQuery<T extends Record<string, string>>(storageKey: string, keys: readonly (keyof T & string)[], state: T) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(keys.map((key) => [key, state[key]]))))
  } catch {
    // Хранилище закрыто или переполнено - фильтры останутся только в адресе.
  }
}

export function useQueryState<T extends Record<string, string>>(defaults: T, options: QueryStateOptions<T> = {}) {
  const defaultsRef = useRef(defaults)
  const optionsRef = useRef(options)
  const read = useCallback((): T => {
    const params = new URLSearchParams(window.location.search)
    const next = { ...defaultsRef.current }
    for (const key of Object.keys(next) as (keyof T)[]) {
      const value = params.get(String(key))
      if (value !== null) next[key] = value as T[keyof T]
    }
    return next
  }, [])

  const writeUrl = useCallback((next: T, replace: boolean) => {
    const params = new URLSearchParams(window.location.search)
    for (const key of Object.keys(defaultsRef.current)) {
      const value = next[key]
      if (value === '' || value === defaultsRef.current[key]) params.delete(key)
      else params.set(key, value)
    }
    const query = params.toString()
    const url = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
    if (url === `${window.location.pathname}${window.location.search}${window.location.hash}`) return
    if (replace) window.history.replaceState(window.history.state, '', url)
    else window.history.pushState(window.history.state, '', url)
  }, [])

  const restored = useRef(false)
  const [state, setState] = useState<T>(() => {
    const fromUrl = read()
    const { storageKey, persist } = optionsRef.current
    if (!storageKey || !persist?.length) return fromUrl
    const params = new URLSearchParams(window.location.search)
    if (persist.some((key) => params.has(key))) return fromUrl
    const stored = readStoredQuery<T>(storageKey, persist)
    if (!stored) return fromUrl
    restored.current = true
    return { ...fromUrl, ...stored }
  })
  const stateRef = useRef(state)
  stateRef.current = state

  /* Восстановленные фильтры сразу видны и в адресе. Эффект - layout, а не
     обычный: пока соседний раздел грузится, Suspense не размонтирует
     прежний, а прячет его и потом показывает тот же экземпляр. Состояние
     при этом прежнее, useEffect заново не вызывается, а layout-эффекты
     подключаются снова - а адрес к этому моменту меню уже собрало без
     фильтров. */
  useLayoutEffect(() => {
    const { persist } = optionsRef.current
    const current = stateRef.current
    if (!restored.current && !persist?.length) return
    const params = new URLSearchParams(window.location.search)
    if (persist?.some((key) => params.has(key))) return
    const differs = Object.keys(defaultsRef.current).some((key) => current[key] !== '' && current[key] !== defaultsRef.current[key] && !params.has(key))
    if (restored.current || differs) writeUrl(current, true)
  }, [writeUrl])

  useEffect(() => {
    const onPop = () => setState(read())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [read])

  // Адрес и хранилище пишутся вне setState: функция-обновитель в строгом
  // режиме React вызывается дважды, и в истории появлялись дубли.
  const update = useCallback((patch: Partial<T>, updateOptions: { replace?: boolean } = {}) => {
    const next = { ...stateRef.current, ...patch }
    stateRef.current = next
    writeUrl(next, Boolean(updateOptions.replace))
    const { storageKey, persist } = optionsRef.current
    if (storageKey && persist?.length) writeStoredQuery(storageKey, persist, next)
    setState(next)
  }, [writeUrl])

  return [state, update] as const
}

/* ---------- Таблица ---------- */

export type Column<T> = {
  key: string
  header: ReactNode
  render: (row: T) => ReactNode
  sortKey?: string
  align?: 'left' | 'right' | 'center'
  className?: string
  mobile?: boolean
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  sort,
  direction,
  onSort,
  loading,
  empty = 'Ничего не найдено.',
  selectable = false,
  selected,
  onSelectedChange,
  onRowClick,
  rowClassName,
  rowLabel,
}: {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  sort?: string
  direction?: string
  onSort?: (key: string, direction: 'asc' | 'desc') => void
  loading?: boolean
  empty?: ReactNode
  selectable?: boolean
  selected?: Set<string>
  onSelectedChange?: (next: Set<string>) => void
  onRowClick?: (row: T) => void
  rowClassName?: (row: T) => string
  /** Подпись строки для чекбокса: «Выбрать: <подпись>». */
  rowLabel?: (row: T) => string
}) {
  const allSelected = selectable && rows.length > 0 && rows.every((row) => selected?.has(rowKey(row)))
  const someSelected = selectable && !allSelected && rows.some((row) => selected?.has(rowKey(row)))
  const toggleAll = () => {
    if (!onSelectedChange) return
    const next = new Set(selected)
    if (allSelected) rows.forEach((row) => next.delete(rowKey(row)))
    else rows.forEach((row) => next.add(rowKey(row)))
    onSelectedChange(next)
  }
  const toggle = (key: string) => {
    if (!onSelectedChange) return
    const next = new Set(selected)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onSelectedChange(next)
  }

  return (
    <div className="adm-table-wrap">
      <table className="adm-table">
        <thead>
          <tr>
            {selectable && (
              <th className="adm-table-check">
                <label className="adm-check">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(node) => { if (node) node.indeterminate = someSelected }}
                    onChange={toggleAll}
                    aria-label="Выбрать все строки на странице"
                  />
                </label>
              </th>
            )}
            {columns.map((column) => {
              const sortable = Boolean(column.sortKey && onSort)
              const active = sortable && sort === column.sortKey
              // Сортируемый столбец всегда объявляет порядок: none - пока не выбран.
              const ariaSort = !sortable ? undefined : active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'
              return (
                <th key={column.key} className={`${column.align ? `is-${column.align}` : ''}${column.mobile === false ? ' adm-hide-mobile' : ''}${column.className ? ` ${column.className}` : ''}`} aria-sort={ariaSort}>
                  {sortable ? (
                    <button type="button" className={`adm-sort${active ? ' is-active' : ''}`} onClick={() => onSort!(column.sortKey!, active && direction === 'desc' ? 'asc' : 'desc')}>
                      {column.header}
                      {!active && <CaretUpDown className="adm-sort-icon" size={14} weight="bold" aria-hidden="true" />}
                      {active && (direction === 'asc'
                        ? <ArrowUp className="adm-sort-icon" size={14} weight="bold" aria-hidden="true" />
                        : <ArrowDown className="adm-sort-icon" size={14} weight="bold" aria-hidden="true" />)}
                    </button>
                  ) : column.header}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {loading && rows.length === 0 && (
            <tr><td colSpan={columns.length + (selectable ? 1 : 0)}><LoadingState /></td></tr>
          )}
          {!loading && rows.length === 0 && (
            <tr><td colSpan={columns.length + (selectable ? 1 : 0)}><EmptyState>{empty}</EmptyState></td></tr>
          )}
          {rows.map((row) => {
            const key = rowKey(row)
            return (
              <tr
                key={key}
                className={`${onRowClick ? 'is-clickable' : ''}${selected?.has(key) ? ' is-selected' : ''}${rowClassName ? ` ${rowClassName(row)}` : ''}${loading ? ' is-stale' : ''}`}
                onClick={onRowClick ? (event) => {
                  const target = event.target as HTMLElement
                  if (target.closest('button, a, input, select, label')) return
                  onRowClick(row)
                } : undefined}
              >
                {selectable && (
                  <td className="adm-table-check">
                    <label className="adm-check">
                      <input type="checkbox" checked={selected?.has(key) ?? false} onChange={() => toggle(key)} aria-label={rowLabel ? `Выбрать: ${rowLabel(row)}` : 'Выбрать строку'} />
                    </label>
                  </td>
                )}
                {columns.map((column) => (
                  <td key={column.key} className={`${column.align ? `is-${column.align}` : ''}${column.mobile === false ? ' adm-hide-mobile' : ''}${column.className ? ` ${column.className}` : ''}`}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return (
    <nav className="adm-pagination" aria-label="Страницы таблицы">
      <span>{formatNumber(from)}–{formatNumber(to)} из {formatNumber(total)}</span>
      <div>
        <button type="button" className="adm-icon-button" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Предыдущая страница"><CaretLeft size={16} weight="bold" aria-hidden="true" /></button>
        <span className="adm-pagination-page">{page} / {pages}</span>
        <button type="button" className="adm-icon-button" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Следующая страница"><CaretRight size={16} weight="bold" aria-hidden="true" /></button>
      </div>
    </nav>
  )
}

export function ExportButton({ onExport, loading, label = 'CSV', variant = 'secondary', size = 'sm' }: {
  onExport: () => void
  loading?: boolean
  label?: string
  variant?: 'primary' | 'secondary'
  size?: 'sm' | 'md'
}) {
  return <Button size={size} variant={variant} onClick={onExport} loading={loading} icon={<DownloadSimple size={16} weight="bold" aria-hidden="true" />}>{label}</Button>
}

/* ---------- Поля ---------- */

export function Field({ label, children, hint, className = '' }: { label: string; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <label className={`adm-field${className ? ` ${className}` : ''}`}>
      <span className="adm-field-label">{label}</span>
      {children}
      {hint && <small className="adm-field-hint">{hint}</small>}
    </label>
  )
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; label: string }) {
  return (
    <div className="adm-segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" className={value === option.value ? 'is-selected' : ''} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: { value: T; label: string; badge?: number }[]; onChange: (value: T) => void }) {
  return (
    <div className="adm-tabs" role="tablist">
      {tabs.map((tab) => (
        <button key={tab.value} type="button" role="tab" aria-selected={value === tab.value} className={value === tab.value ? 'is-selected' : ''} onClick={() => onChange(tab.value)}>
          {tab.label}
          {tab.badge ? <span className="adm-tab-badge">{formatNumber(tab.badge)}</span> : null}
        </button>
      ))}
    </div>
  )
}

export type DateRangeValue = { from: string; to: string }

export function DateRangePicker({ value, onChange }: { value: DateRangeValue; onChange: (value: DateRangeValue) => void }) {
  const today = todayMsk()
  const presets = [
    { label: 'День', from: today, to: today },
    { label: '7 дней', from: shiftDate(today, -6), to: today },
    { label: '30 дней', from: shiftDate(today, -29), to: today },
    { label: '90 дней', from: shiftDate(today, -89), to: today },
  ]
  const active = presets.find((preset) => preset.from === value.from && preset.to === value.to)
  return (
    <div className="adm-range">
      <div className="adm-segmented" role="group" aria-label="Период">
        {presets.map((preset) => (
          <button key={preset.label} type="button" className={active?.label === preset.label ? 'is-selected' : ''} aria-pressed={active?.label === preset.label} onClick={() => onChange({ from: preset.from, to: preset.to })}>{preset.label}</button>
        ))}
      </div>
      <div className="adm-range-custom">
        <input type="date" value={value.from} max={value.to} onChange={(event) => event.target.value && onChange({ ...value, from: event.target.value })} aria-label="Начало периода" />
        <span aria-hidden="true">–</span>
        <input type="date" value={value.to} min={value.from} max={today} onChange={(event) => event.target.value && onChange({ ...value, to: event.target.value })} aria-label="Конец периода" />
      </div>
    </div>
  )
}

/* ---------- Окна ---------- */

/* Окна открываются друг над другом (карточка пользователя → лог задачи).
   Escape и удержание фокуса достаются только верхнему, иначе одно нажатие
   закрывало всю стопку разом. */
const dialogStack: symbol[] = []

export function useDialogFocus(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    if (!open) return
    const id = Symbol('dialog')
    dialogStack.push(id)
    const isTop = () => dialogStack[dialogStack.length - 1] === id
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const node = ref.current
    const selector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    window.requestAnimationFrame(() => {
      const initial = node?.querySelector<HTMLElement>('[data-initial-focus]') ?? node?.querySelector<HTMLElement>(selector)
      initial?.focus()
    })
    const onKey = (event: KeyboardEvent) => {
      if (!isTop()) return
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !node) return
      const items = Array.from(node.querySelectorAll<HTMLElement>(selector))
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      const index = dialogStack.indexOf(id)
      if (index >= 0) dialogStack.splice(index, 1)
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      previous?.focus()
    }
  }, [open])
  return ref
}

export function Drawer({ open, title, subtitle, onClose, children, wide = false }: { open: boolean; title: ReactNode; subtitle?: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useDialogFocus(open, onClose)
  const titleId = useId()
  if (!open) return null
  return (
    <div className="adm-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={ref} className={`adm-drawer${wide ? ' is-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="adm-drawer-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="adm-icon-button" onClick={onClose} aria-label="Закрыть"><X size={18} weight="bold" aria-hidden="true" /></button>
        </header>
        <div className="adm-drawer-body">{children}</div>
      </div>
    </div>
  )
}

export function Modal({ open, title, onClose, children, footer }: { open: boolean; title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useDialogFocus(open, onClose)
  const titleId = useId()
  if (!open) return null
  return (
    <div className="adm-overlay is-centered" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={ref} className="adm-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="adm-drawer-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="adm-icon-button" onClick={onClose} aria-label="Закрыть"><X size={18} weight="bold" aria-hidden="true" /></button>
        </header>
        <div className="adm-modal-body">{children}</div>
        {footer && <footer className="adm-modal-footer">{footer}</footer>}
      </div>
    </div>
  )
}

/* ---------- Уведомления ---------- */

type Toast = { id: number; tone: 'success' | 'error' | 'info'; text: string }
type ToastApi = { success: (text: string) => void; error: (text: string) => void; info: (text: string) => void }

const ToastContext = createContext<ToastApi>({ success: () => {}, error: () => {}, info: () => {} })

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((tone: Toast['tone'], text: string) => {
    const id = Date.now() + Math.random()
    setToasts((current) => [...current.slice(-3), { id, tone, text }])
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), tone === 'error' ? 7000 : 4000)
  }, [])
  const api = useMemo<ToastApi>(() => ({
    success: (text) => push('success', text),
    error: (text) => push('error', text),
    info: (text) => push('info', text),
  }), [push])
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="adm-toasts" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`adm-toast is-${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
            <span>{toast.text}</span>
            <button type="button" onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))} aria-label="Скрыть"><X size={14} weight="bold" aria-hidden="true" /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}

/* Действие с индикатором и сообщением об итоге: повторяется в каждом разделе. */
export function useAction() {
  const toast = useToast()
  const [pending, setPending] = useState<string | null>(null)
  const run = useCallback(async <T,>(key: string, action: () => Promise<T>, success?: string | ((result: T) => string)) => {
    setPending(key)
    try {
      const result = await action()
      if (success) toast.success(typeof success === 'function' ? success(result) : success)
      return result
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Операция не выполнилась.')
      return undefined
    } finally {
      setPending(null)
    }
  }, [toast])
  return { pending, run }
}

/* ---------- JSON ---------- */

export function JsonView({ value, maxHeight = 420 }: { value: unknown; maxHeight?: number }) {
  const text = useMemo(() => JSON.stringify(value, null, 2), [value])
  return (
    <div className="adm-json">
      <div className="adm-json-actions"><CopyButton value={text} label="Скопировать JSON" /></div>
      <pre style={{ maxHeight }}>{text}</pre>
    </div>
  )
}

/* ---------- Графики ---------- */

export type ChartSeries = { name: string; values: number[]; tone?: 1 | 2 | 3 | 4 | 5 | 6 }

function niceMax(value: number) {
  if (value <= 0) return 1
  const exponent = Math.pow(10, Math.floor(Math.log10(value)))
  const fraction = value / exponent
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10
  return nice * exponent
}

export function LineChart({ labels, series, format = formatNumber, height = 220, kind = 'line' }: {
  labels: string[]
  series: ChartSeries[]
  format?: (value: number) => string
  height?: number
  kind?: 'line' | 'bar'
}) {
  const [hover, setHover] = useState<number | null>(null)
  const width = 720
  const padding = { top: 12, right: 12, bottom: 26, left: 56 }
  const innerWidth = width - padding.left - padding.right
  const innerHeight = height - padding.top - padding.bottom
  const max = niceMax(Math.max(0, ...series.flatMap((item) => item.values)))
  const count = labels.length
  const x = (index: number) => padding.left + (count <= 1 ? innerWidth / 2 : (index / (count - 1)) * innerWidth)
  const y = (value: number) => padding.top + innerHeight - (value / max) * innerHeight
  const step = Math.max(1, Math.ceil(count / 8))
  const barGroup = count > 0 ? innerWidth / count : innerWidth
  const barWidth = Math.max(2, (barGroup * 0.72) / Math.max(1, series.length))

  if (count === 0) return <EmptyState>Данных за период нет.</EmptyState>

  return (
    <div className="adm-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={series.map((item) => item.name).join(', ')} onMouseLeave={() => setHover(null)}>
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
          <g key={ratio}>
            <line x1={padding.left} x2={width - padding.right} y1={y(max * ratio)} y2={y(max * ratio)} className="adm-chart-grid" />
            <text x={padding.left - 8} y={y(max * ratio) + 4} textAnchor="end" className="adm-chart-axis">{format(max * ratio)}</text>
          </g>
        ))}
        {labels.map((label, index) => ((index % step === 0 && count - 1 - index >= step / 2) || index === count - 1) && (
          <text key={`axis-${label}`} x={kind === 'bar' ? padding.left + barGroup * index + barGroup / 2 : x(index)} y={height - 8} textAnchor="middle" className="adm-chart-axis">{formatShortDate(label)}</text>
        ))}
        {kind === 'line' && series.map((item, seriesIndex) => (
          <g key={item.name} className={`adm-series-${item.tone ?? seriesIndex + 1}`}>
            <path d={item.values.map((value, index) => `${index === 0 ? 'M' : 'L'}${x(index)},${y(value)}`).join(' ')} className="adm-chart-line" />
            {count <= 45 && item.values.map((value, index) => <circle key={`${item.name}-${labels[index]}`} cx={x(index)} cy={y(value)} r={hover === index ? 4 : 2.2} className="adm-chart-dot" />)}
          </g>
        ))}
        {kind === 'bar' && series.map((item, seriesIndex) => (
          <g key={item.name} className={`adm-series-${item.tone ?? seriesIndex + 1}`}>
            {item.values.map((value, index) => (
              <rect
                key={`${item.name}-${labels[index]}`}
                x={padding.left + barGroup * index + (barGroup - barWidth * series.length) / 2 + barWidth * seriesIndex}
                y={y(value)}
                width={barWidth}
                height={Math.max(0, padding.top + innerHeight - y(value))}
                className="adm-chart-bar"
                rx={1.5}
              />
            ))}
          </g>
        ))}
        {labels.map((label, index) => (
          <rect
            key={`hit-${label}`}
            x={kind === 'bar' ? padding.left + barGroup * index : x(index) - innerWidth / Math.max(1, count - 1) / 2}
            y={padding.top}
            width={kind === 'bar' ? barGroup : innerWidth / Math.max(1, count - 1)}
            height={innerHeight}
            fill="transparent"
            onMouseEnter={() => setHover(index)}
          />
        ))}
        {hover !== null && kind === 'line' && <line x1={x(hover)} x2={x(hover)} y1={padding.top} y2={padding.top + innerHeight} className="adm-chart-cursor" />}
      </svg>
      <div className="adm-chart-legend">
        {series.map((item, index) => (
          <span key={item.name} className={`adm-series-${item.tone ?? index + 1}`}>
            <i />{item.name}{hover !== null && <b>{format(item.values[hover] ?? 0)}</b>}
          </span>
        ))}
        {hover !== null && <span className="adm-chart-legend-date">{formatShortDate(labels[hover])}</span>}
      </div>
    </div>
  )
}

export function StackedBars({ labels, stacks, height = 220 }: { labels: string[]; stacks: { name: string; values: number[] }[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const width = 720
  const padding = { top: 12, right: 12, bottom: 26, left: 40 }
  const innerWidth = width - padding.left - padding.right
  const innerHeight = height - padding.top - padding.bottom
  const totals = labels.map((_, index) => stacks.reduce((sum, stack) => sum + (stack.values[index] ?? 0), 0))
  const max = niceMax(Math.max(0, ...totals))
  const group = labels.length ? innerWidth / labels.length : innerWidth
  const barWidth = Math.max(2, group * 0.7)
  const step = Math.max(1, Math.ceil(labels.length / 8))
  if (!labels.length) return <EmptyState>Данных за период нет.</EmptyState>
  return (
    <div className="adm-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Задачи по дням и предметам" onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((ratio) => (
          <g key={ratio}>
            <line x1={padding.left} x2={width - padding.right} y1={padding.top + innerHeight * (1 - ratio)} y2={padding.top + innerHeight * (1 - ratio)} className="adm-chart-grid" />
            <text x={padding.left - 6} y={padding.top + innerHeight * (1 - ratio) + 4} textAnchor="end" className="adm-chart-axis">{formatNumber(max * ratio)}</text>
          </g>
        ))}
        {labels.map((label, index) => {
          let offset = 0
          return (
            <g key={label} onMouseEnter={() => setHover(index)}>
              <rect x={padding.left + group * index} y={padding.top} width={group} height={innerHeight} fill="transparent" />
              {stacks.map((stack, stackIndex) => {
                const value = stack.values[index] ?? 0
                const barHeight = (value / max) * innerHeight
                offset += barHeight
                return <rect key={stack.name} className={`adm-chart-bar adm-series-fill-${(stackIndex % 8) + 1}`} x={padding.left + group * index + (group - barWidth) / 2} y={padding.top + innerHeight - offset} width={barWidth} height={barHeight} />
              })}
              {((index % step === 0 && labels.length - 1 - index >= step / 2) || index === labels.length - 1) && <text x={padding.left + group * index + group / 2} y={height - 8} textAnchor="middle" className="adm-chart-axis">{formatShortDate(label)}</text>}
            </g>
          )
        })}
      </svg>
      <div className="adm-chart-legend">
        {stacks.map((stack, index) => (
          <span key={stack.name} className={`adm-series-fill-${(index % 8) + 1}`}>
            <i />{stack.name}{hover !== null && <b>{formatNumber(stack.values[hover] ?? 0)}</b>}
          </span>
        ))}
        {hover !== null && <span className="adm-chart-legend-date">{formatShortDate(labels[hover])} · всего {formatNumber(totals[hover])}</span>}
      </div>
    </div>
  )
}

export function Sparkline({ values, label }: { values: number[]; label?: string }) {
  const max = Math.max(1, ...values)
  const width = 84
  const height = 22
  const points = values.map((value, index) => `${values.length <= 1 ? 0 : (index / (values.length - 1)) * width},${height - (value / max) * (height - 2) - 1}`).join(' ')
  return (
    <svg className="adm-sparkline" viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label ?? values.join(', ')}>
      <polyline points={points} />
    </svg>
  )
}

export function HorizontalBars({ items, format = formatNumber }: { items: { label: string; value: number; hint?: string }[]; format?: (value: number) => string }) {
  const max = Math.max(1, ...items.map((item) => item.value))
  if (!items.length) return <EmptyState>Данных нет.</EmptyState>
  return (
    <ol className="adm-hbars">
      {items.map((item) => (
        <li key={item.label}>
          <span className="adm-hbars-label">{item.label}</span>
          <span className="adm-hbars-track"><i style={{ width: `${Math.max(1.5, (item.value / max) * 100)}%` }} /></span>
          <span className="adm-hbars-value">{format(item.value)}{item.hint && <small>{item.hint}</small>}</span>
        </li>
      ))}
    </ol>
  )
}
