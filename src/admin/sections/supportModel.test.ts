import { describe, expect, it } from 'vitest'
import { toCsv } from '../api'
import {
  asPeriod,
  csvDate,
  formatMinutes,
  inboxCsvColumns,
  isTextEntry,
  neighbourId,
  parseInbox,
  parseStats,
  parseTags,
  parseThread,
  plural,
  resolveHotkey,
  updatedAgo,
} from './supportModel'

const key = (code: string, extra: Partial<{ key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({
  key: extra.key ?? code.replace(/^Key/, '').toLowerCase(),
  code,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...extra,
})

describe('метки поддержки', () => {
  it('оставляет только известные метки в порядке словаря', () => {
    expect(parseTags(['idea', 'zzz', 'bug', 'bug', 3, 'payment'])).toEqual(['bug', 'payment', 'idea'])
    expect(parseTags(null as never)).toEqual([])
  })
})

describe('разбор ответов', () => {
  it('читает счётчики и метки входящих', () => {
    const inbox = parseInbox({
      total: 1,
      slaMinutes: 20,
      counts: { open: 3, pendingOwner: 2, overdue: 1, unassigned: 1, mine: 0 },
      items: [{ id: 'c1', tags: ['payment'], waitingMinutes: 25, slaBreached: true }],
    })
    expect(inbox.counts).toEqual({ open: 3, pendingOwner: 2, overdue: 1, unassigned: 1, mine: 0 })
    expect(inbox.items[0]).toMatchObject({ id: 'c1', tags: ['payment'], waitingMinutes: 25, slaBreached: true, status: 'pending_owner' })
  })

  it('без счётчиков от старой базы не падает', () => {
    expect(parseInbox({ items: [] }).counts).toBeNull()
  })

  it('берёт историю ученика из переписки', () => {
    const thread = parseThread({
      conversation: { id: 'c1', tags: ['bug'] },
      history: [{ id: 'c0', subject: 'Старое', status: 'resolved', tags: ['question'], createdAt: '2026-09-01T10:00:00Z', rating: 5 }],
      historyTotal: 4,
    })
    expect(thread?.conversation.tags).toEqual(['bug'])
    expect(thread?.history).toEqual([{ id: 'c0', subject: 'Старое', category: 'general', status: 'resolved', tags: ['question'], createdAt: '2026-09-01T10:00:00Z', lastMessageAt: null, resolvedAt: null, rating: 5 }])
    expect(thread?.historyTotal).toBe(4)
  })

  it('читает сводку и отбрасывает незнакомые метки', () => {
    const stats = parseStats({ period: 'week', days: 7, created: 14, perDay: 2, resolvedShare: 50, byTag: [{ tag: 'bug', count: 3 }, { tag: 'other', count: 1 }] })
    expect(stats).toMatchObject({ period: 'week', days: 7, created: 14, perDay: 2, resolvedShare: 50, firstResponseAvgMinutes: null })
    expect(stats.byTag).toEqual([{ tag: 'bug', count: 3 }])
  })
})

describe('горячие клавиши', () => {
  it('понимает буквы по положению клавиши, в любой раскладке', () => {
    expect(resolveHotkey(key('KeyJ', { key: 'о' }), null)).toBe('next')
    expect(resolveHotkey(key('KeyK'), null)).toBe('prev')
    expect(resolveHotkey(key('KeyR'), null)).toBe('reply')
    expect(resolveHotkey(key('KeyE', { key: 'у' }), null)).toBe('resolve')
    expect(resolveHotkey(key('Escape', { key: 'Escape' }), null)).toBe('back')
    expect(resolveHotkey(key('Digit7', { key: '?', shiftKey: true }), null)).toBe('help')
    expect(resolveHotkey(key('Slash', { key: ',', shiftKey: true }), null)).toBe('help')
  })

  it('не перехватывает сочетания браузера и ввод текста', () => {
    expect(resolveHotkey(key('KeyA', { ctrlKey: true }), null)).toBeNull()
    expect(resolveHotkey(key('KeyE', { ctrlKey: true }), null)).toBeNull()
    expect(resolveHotkey(key('KeyE', { altKey: true }), null)).toBeNull()
    expect(resolveHotkey(key('KeyE', { shiftKey: true }), null)).toBeNull()
    const textarea = document.createElement('textarea')
    const search = document.createElement('input')
    search.type = 'search'
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    expect(resolveHotkey(key('KeyJ'), textarea)).toBeNull()
    expect(resolveHotkey(key('KeyJ'), search)).toBeNull()
    expect(isTextEntry(document.createElement('select'))).toBe(true)
    expect(resolveHotkey(key('KeyJ'), checkbox)).toBe('next')
  })

  it('листает список и не выходит за края', () => {
    const ids = ['a', 'b', 'c']
    expect(neighbourId(ids, '', 1)).toBe('a')
    expect(neighbourId(ids, '', -1)).toBe('c')
    expect(neighbourId(ids, 'a', 1)).toBe('b')
    expect(neighbourId(ids, 'c', 1)).toBeNull()
    expect(neighbourId(ids, 'a', -1)).toBeNull()
    expect(neighbourId([], 'a', 1)).toBeNull()
  })
})

describe('форматы', () => {
  it('пишет длительность и склонения', () => {
    expect(formatMinutes(null)).toBe('-')
    expect(formatMinutes(0.4)).toBe('меньше минуты')
    expect(formatMinutes(42.6)).toBe('43 мин')
    expect(formatMinutes(120)).toBe('2 ч')
    expect(formatMinutes(135)).toBe('2 ч 15 мин')
    expect(formatMinutes(60 * 72)).toBe('3 дн')
    expect(plural(1, 'обращение', 'обращения', 'обращений')).toBe('обращение')
    expect(plural(3, 'обращение', 'обращения', 'обращений')).toBe('обращения')
    expect(plural(11, 'обращение', 'обращения', 'обращений')).toBe('обращений')
    expect(plural(21, 'обращение', 'обращения', 'обращений')).toBe('обращение')
  })

  it('говорит, когда список обновлялся', () => {
    const now = Date.parse('2026-09-12T10:00:00Z')
    expect(updatedAgo(0, now)).toBe('ещё не обновлялось')
    expect(updatedAgo(now - 3_000, now)).toBe('обновлено только что')
    expect(updatedAgo(now - 42_000, now)).toBe('обновлено 42 с назад')
    expect(updatedAgo(now - 5 * 60_000, now)).toBe('обновлено 5 мин назад')
  })

  it('неизвестный период считает «всё время»', () => {
    expect(asPeriod('week')).toBe('week')
    expect(asPeriod('year')).toBe('all')
  })

  it('выгружает обращения в CSV по московскому времени', () => {
    expect(csvDate('2026-09-12T07:28:00Z')).toBe('2026-09-12 10:28')
    expect(csvDate(null)).toBe('')
    const [item] = parseInbox({ items: [{ id: 'c1', fullName: 'Алина', email: 'a@example.test', subject: 'Списалось; не пришло', tags: ['payment', 'refund'], createdAt: '2026-09-12T07:28:00Z', slaBreached: true, rating: 4 }] }).items
    const csv = toCsv([item], inboxCsvColumns)
    const [header, row] = csv.replace('﻿', '').split('\r\n')
    expect(header.split(';')[0]).toBe('ID')
    expect(row).toContain('"Списалось; не пришло"')
    expect(row).toContain('Платёж, Возврат')
    expect(row).toContain('2026-09-12 10:28')
    expect(row.endsWith(';да;4')).toBe(true)
  })
})
