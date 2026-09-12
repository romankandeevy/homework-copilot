import { act, render, renderHook, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { DataTable, useQueryState } from './ui'

const defaults = { u_seen: '', u_sort: 'last_seen', u_page: '1' }
const options = { storageKey: 'test:filters', persist: ['u_seen', 'u_sort'] as const }

describe('useQueryState', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.history.replaceState({}, '', '/admin?section=users')
  })

  it('без сохранения ведёт себя по-старому: только адрес', () => {
    window.localStorage.setItem('test:filters', JSON.stringify({ u_seen: '7d' }))
    const { result } = renderHook(() => useQueryState(defaults))
    expect(result.current[0].u_seen).toBe('')
  })

  it('берёт последние фильтры из хранилища, если в адресе их нет, и пишет их в адрес', () => {
    window.localStorage.setItem('test:filters', JSON.stringify({ u_seen: '7d', u_sort: 'balance' }))
    const { result } = renderHook(() => useQueryState(defaults, options))
    expect(result.current[0]).toMatchObject({ u_seen: '7d', u_sort: 'balance' })
    expect(window.location.search).toBe('?section=users&u_seen=7d&u_sort=balance')
  })

  it('адрес важнее сохранённого', () => {
    window.localStorage.setItem('test:filters', JSON.stringify({ u_seen: '7d' }))
    window.history.replaceState({}, '', '/admin?section=users&u_seen=30d')
    const { result } = renderHook(() => useQueryState(defaults, options))
    expect(result.current[0].u_seen).toBe('30d')
  })

  it('изменение пишет адрес и хранилище, значение по умолчанию из адреса убирает', () => {
    const { result } = renderHook(() => useQueryState(defaults, options))
    act(() => result.current[1]({ u_seen: 'today', u_page: '2' }))
    expect(window.location.search).toBe('?section=users&u_seen=today&u_page=2')
    expect(JSON.parse(window.localStorage.getItem('test:filters') ?? '{}')).toEqual({ u_seen: 'today', u_sort: 'last_seen' })
    act(() => result.current[1]({ u_seen: '', u_page: '1' }))
    expect(window.location.search).toBe('?section=users')
  })

  it('закрытое хранилище не ломает раздел', () => {
    const original = Storage.prototype.getItem
    Storage.prototype.getItem = () => { throw new Error('blocked') }
    try {
      const { result } = renderHook(() => useQueryState(defaults, options))
      expect(result.current[0].u_seen).toBe('')
    } finally {
      Storage.prototype.getItem = original
    }
  })
})

describe('DataTable', () => {
  it('объявляет порядок сортировки у каждого сортируемого столбца', () => {
    render(
      <DataTable
        columns={[
          { key: 'name', header: 'Имя', render: (row: { id: string }) => row.id, sortKey: 'name' },
          { key: 'balance', header: 'Баланс', render: () => '0', sortKey: 'balance' },
          { key: 'note', header: 'Заметка', render: () => '' },
        ]}
        rows={[{ id: 'a' }, { id: 'b' }]}
        rowKey={(row) => row.id}
        sort="balance"
        direction="asc"
        onSort={() => {}}
        selectable
        selected={new Set(['a'])}
        onSelectedChange={() => {}}
        rowLabel={(row) => row.id}
      />,
    )
    expect(screen.getByRole('columnheader', { name: /Баланс/ }).getAttribute('aria-sort')).toBe('ascending')
    expect(screen.getByRole('columnheader', { name: /Имя/ }).getAttribute('aria-sort')).toBe('none')
    expect(screen.getByRole('columnheader', { name: 'Заметка' }).hasAttribute('aria-sort')).toBe(false)
    const all = screen.getByRole('checkbox', { name: 'Выбрать все строки на странице' }) as HTMLInputElement
    expect(all.indeterminate).toBe(true)
    expect((screen.getByRole('checkbox', { name: 'Выбрать: a' }) as HTMLInputElement).checked).toBe(true)
  })
})
