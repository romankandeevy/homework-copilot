import { describe, expect, it } from 'vitest'
import {
  isActiveJob,
  mergeJobs,
  nextRunnableJob,
  orderedActiveJobs,
  parseSolutionJob,
  queuePosition,
  stageState,
} from './solutionJobs'
import type { SolutionJob } from './solutionJobs'

function job(overrides: Partial<SolutionJob> & { idempotencyKey: string }): SolutionJob {
  return {
    id: `id-${overrides.idempotencyKey}`,
    deviceId: 'this-device',
    textbookId: 'algebra',
    task: 'Задача',
    source: 'text',
    subject: 'Алгебра',
    grade: '8 класс',
    conditionPreview: 'Условие',
    status: 'queued',
    stage: 'queued',
    error: '',
    createdAt: '2026-08-31T10:00:00.000Z',
    updatedAt: '2026-08-31T10:00:00.000Z',
    startedAt: '',
    finishedAt: '',
    ...overrides,
  }
}

describe('стадии решения', () => {
  it('делит шаги на пройденные, текущий и ожидающие', () => {
    expect(stageState('solving', 'reading')).toBe('done')
    expect(stageState('solving', 'solving')).toBe('current')
    expect(stageState('solving', 'checking')).toBe('waiting')
  })

  // Готовая задача не должна оставлять последний шаг незакрашенным: работа
  // дошла до конца, и показывать её незавершённой — врать.
  it('закрывает все шаги, когда решение готово', () => {
    expect(stageState('done', 'writing')).toBe('done')
    expect(stageState('done', 'reading')).toBe('done')
  })

  // Задача, о которой известно только «поставлена», ещё не начата: первый шаг
  // текущий, а не пройденный.
  it('ставит первый шаг текущим для только что поставленной задачи', () => {
    expect(stageState('queued', 'reading')).toBe('waiting')
  })
})

describe('очередь', () => {
  it('считает активными только незавершённые задачи', () => {
    expect(isActiveJob(job({ idempotencyKey: 'a', status: 'running' }))).toBe(true)
    expect(isActiveJob(job({ idempotencyKey: 'b', status: 'done' }))).toBe(false)
    expect(isActiveJob(job({ idempotencyKey: 'c', status: 'canceled' }))).toBe(false)
  })

  it('выстраивает очередь по времени постановки', () => {
    const jobs = [
      job({ idempotencyKey: 'late', createdAt: '2026-08-31T10:00:02.000Z' }),
      job({ idempotencyKey: 'early', createdAt: '2026-08-31T10:00:00.000Z' }),
      job({ idempotencyKey: 'done', createdAt: '2026-08-31T09:00:00.000Z', status: 'done' }),
    ]
    expect(orderedActiveJobs(jobs).map((entry) => entry.idempotencyKey)).toEqual(['early', 'late'])
    expect(queuePosition(jobs[0], jobs)).toBe(2)
  })

  it('берёт в работу только свои задачи и только до предела одновременных', () => {
    const jobs = [
      job({ idempotencyKey: 'mine-1', createdAt: '2026-08-31T10:00:00.000Z' }),
      job({ idempotencyKey: 'mine-2', createdAt: '2026-08-31T10:00:01.000Z' }),
      job({ idempotencyKey: 'theirs', createdAt: '2026-08-31T09:59:00.000Z', deviceId: 'phone' }),
    ]

    expect(nextRunnableJob(jobs, 'this-device', new Set(), 2)?.idempotencyKey).toBe('mine-1')
    expect(nextRunnableJob(jobs, 'this-device', new Set(['mine-1']), 2)?.idempotencyKey).toBe('mine-2')
    expect(nextRunnableJob(jobs, 'this-device', new Set(['mine-1', 'mine-2']), 2)).toBeNull()
  })

  // Задача с другого устройства выполняется там. Забрать её себе значит
  // отправить одно и то же условие в модель дважды и списать дважды.
  it('не забирает чужую задачу, даже когда своих нет', () => {
    const jobs = [job({ idempotencyKey: 'theirs', deviceId: 'phone' })]
    expect(nextRunnableJob(jobs, 'this-device', new Set(), 2)).toBeNull()
  })

  /* Перезаход во время решения.

     Вкладка не помнит, что отправляла, но решатель на сервере продолжает
     считать. Взяться за начатую строку заново — гнать вторую генерацию
     поверх работающей первой. */
  it('не перезапускает уже начатую задачу после перезахода', () => {
    const jobs = [job({ idempotencyKey: 'started', status: 'running', stage: 'solving' })]
    expect(nextRunnableJob(jobs, 'this-device', new Set(), 2)).toBeNull()
  })

  it('считает начатую задачу занятым местом в очереди', () => {
    const jobs = [
      job({ idempotencyKey: 'started', status: 'running', createdAt: '2026-08-31T10:00:00.000Z' }),
      job({ idempotencyKey: 'waiting-1', createdAt: '2026-08-31T10:00:01.000Z' }),
      job({ idempotencyKey: 'waiting-2', createdAt: '2026-08-31T10:00:02.000Z' }),
    ]
    expect(nextRunnableJob(jobs, 'this-device', new Set(), 2)?.idempotencyKey).toBe('waiting-1')
    expect(nextRunnableJob(jobs, 'this-device', new Set(['waiting-1']), 2)).toBeNull()
  })
})

describe('слияние состояния очереди', () => {
  it('доверяет стадию базе, а не вкладке', () => {
    const remote = [job({ idempotencyKey: 'a', status: 'running', stage: 'checking' })]
    const local = [job({ idempotencyKey: 'a', status: 'running', stage: 'queued' })]
    expect(mergeJobs(remote, local)[0].stage).toBe('checking')
  })

  // Запрос уходит из вкладки, и она знает о старте раньше базы. Показывать
  // в этот момент «ждёт очереди» — показывать несуществующее ожидание.
  it('пропускает вперёд местный старт, пока база о нём не знает', () => {
    const remote = [job({ idempotencyKey: 'a', status: 'queued', stage: 'queued' })]
    const local = [job({ idempotencyKey: 'a', status: 'running', stage: 'reading' })]
    const merged = mergeJobs(remote, local)
    expect(merged[0].status).toBe('running')
    expect(merged[0].stage).toBe('reading')
  })

  // О собственной неудаче вкладка узнаёт раньше базы: запрос упал прямо здесь.
  // Держать в этот момент «Решаем» — врать в лицо.
  it('пропускает вперёд местную неудачу, пока база о ней не знает', () => {
    const remote = [job({ idempotencyKey: 'a', status: 'running', stage: 'solving' })]
    const local = [job({ idempotencyKey: 'a', status: 'failed', stage: 'failed', error: 'Связь оборвалась' })]
    const merged = mergeJobs(remote, local)
    expect(merged[0].status).toBe('failed')
    expect(merged[0].error).toBe('Связь оборвалась')
  })

  it('оставляет за базой последнее слово, когда она уже закрыла задачу', () => {
    const remote = [job({ idempotencyKey: 'a', status: 'done', stage: 'done' })]
    const local = [job({ idempotencyKey: 'a', status: 'failed', stage: 'failed', error: 'Связь оборвалась' })]
    expect(mergeJobs(remote, local)[0].status).toBe('done')
  })

  it('показывает задачу, которую база ещё не завела', () => {
    expect(mergeJobs([], [job({ idempotencyKey: 'fresh' })])).toHaveLength(1)
  })
})

describe('чтение строки задачи', () => {
  it('разбирает строку базы целиком', () => {
    const parsed = parseSolutionJob({
      id: 'job-1',
      idempotency_key: 'solution-1',
      device_id: 'laptop',
      textbook_id: 'geometry',
      task: 'Задача про ромб',
      source: 'photo',
      subject: 'Геометрия',
      grade: '8 класс',
      condition_preview: 'Диагонали ромба',
      status: 'running',
      stage: 'solving',
      error: null,
      created_at: '2026-08-31T10:00:00.000Z',
      updated_at: '2026-08-31T10:00:05.000Z',
      started_at: '2026-08-31T10:00:01.000Z',
      finished_at: null,
    })

    expect(parsed).toMatchObject({
      id: 'job-1',
      idempotencyKey: 'solution-1',
      deviceId: 'laptop',
      source: 'photo',
      status: 'running',
      stage: 'solving',
      error: '',
    })
  })

  it('отбрасывает строку без опознавательных полей', () => {
    expect(parseSolutionJob({ status: 'running' })).toBeNull()
    expect(parseSolutionJob(null)).toBeNull()
  })
})
