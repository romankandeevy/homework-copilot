import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { CaretDown, Check } from '@phosphor-icons/react'

/* Выбор класса - и в регистрации (окно входа), и на странице профиля.
   Живёт отдельно от окна: с 14 сентября 2026 профиль - страница, и тянуть
   ради одного поля весь чанк окна входа ей незачем. */

/* Классы те же, что в форме задачи (`solvableGrades`): 1-4 класс продукт не
   решает, и выбранный здесь класс подставлялся в задачу, которую форма не
   знает. «Университета» здесь нет: в профиле класс хранится числом 1-11. */
const gradeOptions: readonly number[] = [5, 6, 7, 8, 9, 10, 11]

export default function GradeSelect({ value, onChange, compact = false }: { value: string; onChange: (value: string) => void; compact?: boolean }) {
  const listboxId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(Number(value))

  useEffect(() => {
    if (!open) return

    const dismiss = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }

    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])

  useEffect(() => {
    if (!open) return
    containerRef.current?.querySelector<HTMLElement>(`[data-grade="${highlighted}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [highlighted, open])

  const choose = (grade: number) => {
    onChange(String(grade))
    setHighlighted(grade)
    setOpen(false)
    triggerRef.current?.focus()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
      return
    }

    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      if (!open) {
        setHighlighted(Number(value))
        setOpen(true)
        return
      }

      setHighlighted((current) => {
        if (event.key === 'Home') return gradeOptions[0] ?? current
        if (event.key === 'End') return gradeOptions[gradeOptions.length - 1] ?? current
        const index = gradeOptions.indexOf(current)
        const next = index === -1 ? 0 : Math.min(gradeOptions.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))
        return gradeOptions[next] ?? current
      })
      return
    }

    if (event.key === 'Enter' && open && event.target === triggerRef.current) {
      event.preventDefault()
      if (gradeOptions.includes(highlighted)) choose(highlighted)
    }
  }

  return (
    <div
      className="account-grade-select"
      ref={containerRef}
      onKeyDown={handleKeyDown}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <button
        ref={triggerRef}
        className="account-grade-trigger"
        type="button"
        role="combobox"
        aria-label="Класс"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open ? `${listboxId}-${highlighted}` : undefined}
        onClick={() => {
          setHighlighted(Number(value))
          setOpen((current) => !current)
        }}
      >
        <span>{value ? (compact ? value : `${value} класс`) : 'Выбери'}</span>
        <CaretDown size={15} weight="bold" aria-hidden="true" />
      </button>

      {open && (
        <div id={listboxId} className="account-grade-menu" role="listbox" aria-label="Выбрать класс">
          {gradeOptions.map((grade) => (
            <button
              id={`${listboxId}-${grade}`}
              key={grade}
              data-grade={grade}
              className={`account-grade-option${grade === highlighted ? ' is-highlighted' : ''}`}
              type="button"
              role="option"
              aria-selected={String(grade) === value}
              tabIndex={-1}
              onPointerEnter={() => setHighlighted(grade)}
              onClick={() => choose(grade)}
            >
              <span>{grade} класс</span>
              {String(grade) === value && <Check size={15} weight="bold" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
