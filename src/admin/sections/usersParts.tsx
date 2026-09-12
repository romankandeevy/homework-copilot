/* Детали раздела «Пользователи»: полоса цифр, быстрый поиск, ползунок
   баланса, меню действий в строке, статусы, активность и пустое состояние. */

import { useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { ClockCounterClockwise, DotsThree, MagnifyingGlass, X } from '@phosphor-icons/react'
import type { Json } from '../../lib/database.types'
import { adminRpc, bool, formatDateTime, formatKopecks, formatNumber, formatShortDate, num, obj, rows, str } from '../api'
import type { Row } from '../api'
import { readRecentUsers } from '../recentUsers'
import type { RecentUser } from '../recentUsers'
import { Button } from '../ui'
import type { Tone } from '../ui'
import { ACTIVITY_SINCE, ONLINE_MINUTES, balanceScale, isOnline, sinceText } from './usersModel'

const RISK_LABEL: Record<string, string> = { high: 'высокий', medium: 'средний', low: 'низкий' }

/* ---------- Полоса цифр ---------- */

export function UsersStats({ data, loading }: { data: Row | null; loading: boolean }) {
  const value = (key: string) => (data ? formatNumber(num(data[key])) : loading ? '…' : '-')
  const online = data ? num(data.online) : 0
  return (
    <dl className="adm-users-stats" aria-label="Пользователи в цифрах" aria-busy={(loading && !data) || undefined}>
      <div title="Все аккаунты, кроме администраторов.">
        <dt>Учеников</dt>
        <dd><strong>{value('students')}</strong></dd>
      </div>
      <div title="Зарегистрировались за последние 7 суток, без администраторов.">
        <dt>Новых за 7 дней</dt>
        <dd><strong>{value('new7d')}</strong></dd>
      </div>
      <div title="Сделали хотя бы одно подтверждённое пополнение. Сумма - пополнения за всё время за вычетом возвратов, без администраторов.">
        <dt>Платили</dt>
        <dd><strong>{value('payers')}</strong>{data && <small>на {formatKopecks(num(data.paidKopecks))}</small>}</dd>
      </div>
      <div title={`Были активны за последние ${ONLINE_MINUTES} минут, без администраторов.`}>
        <dt>Онлайн сейчас</dt>
        <dd><i className={`adm-users-dot${online > 0 ? ' is-online' : ''}`} aria-hidden="true" /><strong>{value('online')}</strong></dd>
      </div>
    </dl>
  )
}

/* ---------- Быстрый поиск ---------- */

type SearchOption = { id: string; title: string; hint: string }

/* Поле пишет поиск таблицы (с паузой, чтобы не дёргать базу на каждую
   букву) и одновременно показывает выпадающий список: пока пусто - недавно
   открытые карточки, с двух знаков - совпадения по всей базе. */
export function QuickSearch({ value, onCommit, onOpenUser }: { value: string; onCommit: (value: string) => void; onOpenUser: (id: string) => void }) {
  const inputId = useId()
  const listId = useId()
  const [draft, setDraft] = useState(value)
  const committed = useRef(value)
  const commitRef = useRef(onCommit)
  commitRef.current = onCommit
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [recent, setRecent] = useState<RecentUser[]>([])
  const [matches, setMatches] = useState<SearchOption[]>([])
  const [searching, setSearching] = useState(false)
  const term = draft.trim()
  const searchMode = term.length >= 2

  // Значение поменялось снаружи (сброс фильтров, «назад») - показываем его.
  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value
      setDraft(value)
    }
  }, [value])

  useEffect(() => {
    if (draft === committed.current) return
    const timer = window.setTimeout(() => {
      committed.current = draft
      commitRef.current(draft)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [draft])

  useEffect(() => {
    if (!open || !searchMode) {
      setMatches([])
      setSearching(false)
      return
    }
    let cancelled = false
    setSearching(true)
    const timer = window.setTimeout(async () => {
      try {
        const data = obj(await adminRpc<Json>('admin_users_list', { p_search: term, p_filters: {}, p_sort: 'last_seen', p_dir: 'desc', p_page: 1, p_page_size: 6 }))
        if (cancelled) return
        setMatches(rows(data.items).map((user) => {
          const name = str(user.fullName).trim()
          return { id: str(user.id), title: name || str(user.email), hint: name ? str(user.email) : '' }
        }))
      } catch {
        if (!cancelled) setMatches([])
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 200)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, searchMode, term])

  const options: SearchOption[] = searchMode
    ? matches
    : recent.map((user) => ({ id: user.id, title: user.name || user.email, hint: user.name ? user.email : '' }))
  const current = active >= 0 && active < options.length ? active : -1

  const show = () => {
    setRecent(readRecentUsers())
    setOpen(true)
  }
  const hide = () => {
    setOpen(false)
    setActive(-1)
  }
  const choose = (option: SearchOption) => {
    hide()
    onOpenUser(option.id)
  }
  const commitNow = (next: string) => {
    committed.current = next
    commitRef.current(next)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        show()
        setActive(event.key === 'ArrowDown' ? 0 : -1)
        return
      }
      if (!options.length) return
      if (event.key === 'ArrowDown') setActive((index) => (index + 1) % options.length)
      else setActive((index) => (index <= 0 ? options.length - 1 : index - 1))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (open && current >= 0) choose(options[current])
      else {
        if (draft !== committed.current) commitNow(draft)
        hide()
      }
      return
    }
    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault()
        event.stopPropagation()
        hide()
      } else if (draft) {
        event.preventDefault()
        setDraft('')
        commitNow('')
      }
      return
    }
    if (event.key === 'Tab') hide()
  }

  return (
    <div className="adm-qs">
      <label className="sr-only" htmlFor={inputId}>Поиск пользователей</label>
      <div className="adm-qs-field">
        <MagnifyingGlass size={18} weight="bold" aria-hidden="true" />
        <input
          id={inputId}
          className="adm-qs-input"
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && current >= 0 ? `${listId}-${current}` : undefined}
          value={draft}
          placeholder="Почта, имя или id"
          onChange={(event) => {
            setDraft(event.target.value)
            setActive(-1)
            if (!open) show()
          }}
          onFocus={show}
          onBlur={hide}
          onKeyDown={onKeyDown}
        />
        {draft && (
          <button
            type="button"
            className="adm-icon-button is-small adm-qs-clear"
            aria-label="Очистить поиск"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setDraft('')
              commitNow('')
            }}
          >
            <X size={14} weight="bold" aria-hidden="true" />
          </button>
        )}
      </div>
      {open && (
        // Нажатие внутри списка не должно уводить фокус из поля.
        <div className="adm-qs-pop" onMouseDown={(event) => event.preventDefault()}>
          <p className="adm-qs-head">
            {searchMode ? 'Совпадения' : <><ClockCounterClockwise size={14} weight="bold" aria-hidden="true" />Недавно открытые</>}
          </p>
          <ul id={listId} role="listbox" aria-label={searchMode ? 'Совпадения' : 'Недавно открытые'} className="adm-qs-list">
            {options.map((option, index) => (
              <li
                key={option.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === current}
                className={index === current ? 'is-active' : ''}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(option)}
              >
                <span className="adm-cell-main"><strong>{option.title}</strong>{option.hint && <small>{option.hint}</small>}</span>
              </li>
            ))}
          </ul>
          {options.length === 0 && (
            <p className="adm-qs-empty">
              {searchMode
                ? (searching ? 'Ищем…' : 'Никого не нашлось. Поиск идёт по почте, имени и id.')
                : 'Здесь появятся карточки, которые ты открывал. Набери почту, имя или id.'}
            </p>
          )}
          {options.length > 0 && <p className="adm-qs-foot">↑↓ выбрать · Enter открыть карточку · Esc закрыть</p>}
        </div>
      )}
    </div>
  )
}

/* ---------- Ползунок баланса ---------- */

/* Два нативных ползунка на одной дорожке: клавиатура (стрелки, PageUp/Down,
   Home/End) и чтение экранным диктором работают сами. Правый край - «без
   предела». В адрес значение пишется после паузы, а не на каждый шаг. */
export function BalanceRange({ min, max, ceiling, onCommit }: {
  min: number | null
  max: number | null
  ceiling: number
  onCommit: (min: number | null, max: number | null) => void
}) {
  const scale = balanceScale(ceiling, min ?? 0, max ?? 0)
  const [lo, setLo] = useState(min ?? 0)
  const [hi, setHi] = useState<number | null>(max)
  const dirty = useRef(false)
  const commitRef = useRef(onCommit)
  commitRef.current = onCommit

  useEffect(() => {
    dirty.current = false
    setLo(min ?? 0)
    setHi(max)
  }, [min, max])

  useEffect(() => {
    if (!dirty.current) return
    const timer = window.setTimeout(() => {
      dirty.current = false
      commitRef.current(lo > 0 ? lo : null, hi)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [lo, hi])

  const hiValue = hi ?? scale.max
  const pct = (value: number) => `${(Math.min(value, scale.max) / scale.max) * 100}%`
  const rub = (value: number) => formatKopecks(Math.round(value * 100))

  return (
    <div className="adm-range2">
      <div className="adm-range2-values" aria-hidden="true">
        <span>{rub(lo)}</span>
        <span className="adm-muted">-</span>
        <span>{hi === null ? 'без предела' : rub(hi)}</span>
      </div>
      <div className="adm-range2-track" style={{ '--lo': pct(lo), '--hi': pct(hiValue) } as CSSProperties}>
        <input
          className={`adm-range2-input${lo >= scale.max - scale.step ? ' is-top' : ''}`}
          type="range"
          min={0}
          max={scale.max}
          step={scale.step}
          value={Math.min(lo, scale.max)}
          aria-label="Баланс от"
          aria-valuetext={lo > 0 ? `от ${rub(lo)}` : 'от нуля'}
          onChange={(event) => {
            dirty.current = true
            setLo(Math.min(Number(event.target.value), hiValue))
          }}
        />
        <input
          className="adm-range2-input"
          type="range"
          min={0}
          max={scale.max}
          step={scale.step}
          value={hiValue}
          aria-label="Баланс до"
          aria-valuetext={hi === null ? 'без предела' : `до ${rub(hi)}`}
          onChange={(event) => {
            dirty.current = true
            const next = Math.max(Number(event.target.value), lo)
            setHi(next >= scale.max ? null : next)
          }}
        />
      </div>
      <div className="adm-range2-scale" aria-hidden="true"><span>0 ₽</span><span>{rub(scale.max)}</span></div>
    </div>
  )
}

/* ---------- Меню действий в строке ---------- */

export type RowMenuItem = { key: string; label: string; icon?: ReactNode; tone?: 'danger'; onSelect: () => void }

const MENU_WIDTH = 232

/* Меню - под кнопкой, а если внизу не хватает места - над ней; по
   горизонтали прижато к правому краю кнопки и не выходит за окно. */
function placeMenu(rect: DOMRect, itemCount: number) {
  const height = itemCount * 44 + 12
  const left = Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8))
  const below = rect.bottom + 6
  const top = below + height > window.innerHeight - 8 ? Math.max(8, rect.top - height - 6) : below
  return { top, left }
}

/* Меню фиксируется к окну, а не к ячейке: контейнер таблицы прокручивается
   вбок и обрезал бы выпадающий список. Прокрутка и смена размера окна его
   закрывают. */
export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const open = position !== null
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const menuId = useId()

  const menuItems = () => Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
  const focusItem = (index: number) => {
    const nodes = menuItems()
    if (nodes.length) nodes[((index % nodes.length) + nodes.length) % nodes.length].focus()
  }

  const itemCount = items.length

  const show = (focus: 'first' | 'last') => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    setPosition(placeMenu(rect, itemCount))
    window.requestAnimationFrame(() => focusItem(focus === 'first' ? 0 : -1))
  }

  const close = (restoreFocus: boolean) => {
    setPosition(null)
    if (restoreFocus) buttonRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      setPosition(null)
    }
    // Прокрутка (в том числе самой таблицы, когда фокус приводит кнопку в
    // видимую область) двигает меню за кнопкой; закрывает - только если
    // кнопка ушла из окна.
    const onViewport = () => {
      const rect = buttonRef.current?.getBoundingClientRect()
      if (!rect || rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
        setPosition(null)
        return
      }
      setPosition(placeMenu(rect, itemCount))
    }
    // Escape закрывает меню, даже если фокус остался на кнопке «…».
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setPosition(null)
      buttonRef.current?.focus()
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onViewport)
    window.addEventListener('scroll', onViewport, true)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onViewport)
      window.removeEventListener('scroll', onViewport, true)
    }
  }, [open, itemCount])

  const onMenuKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const index = menuItems().indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'ArrowDown') { event.preventDefault(); focusItem(index + 1) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); focusItem(index < 0 ? -1 : index - 1) }
    else if (event.key === 'Home') { event.preventDefault(); focusItem(0) }
    else if (event.key === 'End') { event.preventDefault(); focusItem(-1) }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true) }
    else if (event.key === 'Tab') close(false)
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="adm-icon-button adm-menu-trigger"
        aria-label={`Действия: ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : show('first'))}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            show(event.key === 'ArrowDown' ? 'first' : 'last')
          }
        }}
      >
        <DotsThree size={20} weight="bold" aria-hidden="true" />
      </button>
      {position && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={`Действия: ${label}`}
          className="adm-menu"
          style={{ top: position.top, left: position.left, width: MENU_WIDTH }}
          onKeyDown={onMenuKey}
          // Клик мимо пунктов не должен открывать карточку строки под меню.
          onClick={(event) => event.stopPropagation()}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={item.tone === 'danger' ? 'is-danger' : ''}
              onClick={() => {
                // Фокус - на кнопку «…»: окно подтверждения вернёт его туда же.
                close(true)
                item.onSelect()
              }}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </>
  )
}

/* ---------- Статусы и активность ---------- */

function Pill({ tone, title, children }: { tone: Tone; title?: string; children: ReactNode }) {
  return <span className={`adm-badge is-${tone} adm-users-pill`} title={title}>{children}</span>
}

export function StatusPills({ row }: { row: Row }) {
  const banned = bool(row.isBanned)
  const flags = num(row.openFlags)
  const risk = str(row.maxRisk)
  const until = str(row.bannedUntil)
  return (
    <div className="adm-users-badges">
      {banned && (
        <Pill tone="danger" title={until ? `Заблокирован до ${formatDateTime(until)}. Причина - в карточке.` : 'Заблокирован бессрочно. Причина - в карточке.'}>
          {until ? `Забанен до ${formatShortDate(until)}` : 'Забанен'}
        </Pill>
      )}
      {flags > 0 && (
        <Pill tone={risk === 'high' ? 'danger' : 'warning'} title={`Открытых флагов антифрода: ${flags}, риск ${RISK_LABEL[risk] ?? 'не указан'}. Разбор - в разделе «Антифрод».`}>
          Проверка антифрода{flags > 1 ? `: ${flags}` : ''}
        </Pill>
      )}
      {!banned && flags === 0 && <Pill tone="success" title="Не заблокирован, открытых флагов антифрода нет.">Активен</Pill>}
      {bool(row.isStaff) && <Pill tone="info" title="Аккаунт администратора. В цифрах над таблицей не считается.">Админ</Pill>}
      {bool(row.isInternal) && <Pill tone="info" title="Служебный аккаунт: свой, тестовый или демо. В статистике не считается.">Служебный</Pill>}
    </div>
  )
}

export function StatusLegend() {
  return (
    <details className="adm-users-legend">
      <summary>Что значат статусы</summary>
      <ul>
        <li><Pill tone="success">Активен</Pill><span>Не заблокирован, открытых флагов антифрода нет.</span></li>
        <li><Pill tone="danger">Забанен</Pill><span>Заблокирован администратором - бессрочно или до даты. Причина - в карточке.</span></li>
        <li><Pill tone="warning">Проверка антифрода</Pill><span>Правило антифрода отметило аккаунт, флаг ещё не разобран. Красная пилюля - высокий риск. Разбор - в разделе «Антифрод».</span></li>
        <li><Pill tone="info">Админ</Pill><span>Аккаунт из списка администраторов. В цифрах над таблицей не считается.</span></li>
        <li>
          <span className="adm-users-seen is-online"><i className="adm-users-dot is-online" aria-hidden="true" />онлайн</span>
          <span>Был активен в последние {ONLINE_MINUTES} минут. Серая точка - дольше. Активность пишется с {ACTIVITY_SINCE}, раньше поле было пустым у всех.</span>
        </li>
      </ul>
    </details>
  )
}

export function ActivityCell({ lastSeenAt, now }: { lastSeenAt: string; now: number }) {
  const online = isOnline(lastSeenAt, now)
  const since = sinceText(lastSeenAt, now)
  const title = online
    ? `В сети: был ${since}`
    : since
      ? `Был ${since} (${formatDateTime(lastSeenAt)})`
      : `Нет данных: активность пишется с ${ACTIVITY_SINCE}, после этого дня не заходил`
  return (
    <span className={`adm-users-seen${online ? ' is-online' : ''}`} title={title}>
      <i className={`adm-users-dot${online ? ' is-online' : ''}`} aria-hidden="true" />
      <span>{online ? 'онлайн' : since ?? 'нет данных'}</span>
    </span>
  )
}

/* ---------- Пустое состояние ---------- */

const GRID_X = [16, 32, 48, 64, 80, 96, 112, 128, 144]
const GRID_Y = [16, 32, 48, 64, 80, 96]

export function EmptyUsers({ filtered, onReset }: { filtered: boolean; onReset: () => void }) {
  return (
    <div className="adm-users-empty">
      <svg viewBox="0 0 160 112" width="160" height="112" aria-hidden="true" focusable="false">
        <g className="adm-users-empty-grid">
          {GRID_X.map((x) => <line key={`x${x}`} x1={x} x2={x} y1={0} y2={112} />)}
          {GRID_Y.map((y) => <line key={`y${y}`} x1={0} x2={160} y1={y} y2={y} />)}
        </g>
        <g className="adm-users-empty-ink">
          <rect x={20} y={20} width={92} height={68} rx={6} />
          <line x1={20} x2={112} y1={36} y2={36} />
          <line x1={30} x2={72} y1={52} y2={52} />
          <line x1={30} x2={60} y1={68} y2={68} />
          <circle cx={112} cy={72} r={18} />
          <line x1={125} y1={85} x2={142} y2={102} />
        </g>
        <g className="adm-users-empty-signal">
          <line x1={105} y1={65} x2={119} y2={79} />
          <line x1={119} y1={65} x2={105} y2={79} />
        </g>
      </svg>
      <h3>{filtered ? 'По этим условиям никого нет' : 'Пользователей пока нет'}</h3>
      <p>{filtered ? 'Ослабь фильтры или сбрось их. Поиск идёт по почте, имени и id.' : 'Они появятся здесь после первой регистрации.'}</p>
      {filtered && <Button variant="primary" onClick={onReset}>Сбросить фильтры</Button>}
    </div>
  )
}
