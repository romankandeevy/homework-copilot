/* Ежедневная сводка: что в ней, когда и сколько раз.

   До 15 сентября 2026 у сводки был один час отправки, а состав был зашит в
   текст в базе. Владелец попросил настраивать и содержание, и время, и
   число отправок. Настройки живут в app_settings (ключ daily_summary),
   проверяет их база (private.normalize_daily_summary), текст собирает
   она же: предпросмотр ниже - ровно то, что уйдёт. Каналы - Telegram и
   почта - настраиваются в «Правилах», у события «Дневная сводка». */

import { useEffect, useState } from 'react'
import type { Json } from '../../lib/database.types'
import { adminRpc, obj, str } from '../api'
import { Button, Panel, Segmented, useAction } from '../ui'
import { Check } from './settingsParts'
import './settings.css'

export type SummaryConfig = {
  hours: number[]
  days: number[]
  period: 'yesterday' | 'today'
  blocks: string[]
}

export const summaryBlocks: { id: string; label: string }[] = [
  { id: 'revenue', label: 'Пришло денег' },
  { id: 'consumption', label: 'Списано с кошельков' },
  { id: 'llm_cost', label: 'Расход на модели' },
  { id: 'registrations', label: 'Регистрации' },
  { id: 'active', label: 'Активные ученики' },
  { id: 'solved', label: 'Решено и не решено' },
  { id: 'subjects', label: 'Предметы дня' },
  { id: 'speed', label: 'Среднее время решения' },
  { id: 'errors', label: 'Ошибки' },
  { id: 'fraud', label: 'Открытые флаги фрода' },
  { id: 'support', label: 'Обращения без ответа' },
  { id: 'wallets', label: 'Деньги на кошельках' },
]

const defaultBlocks = ['revenue', 'llm_cost', 'registrations', 'active', 'solved', 'errors', 'fraud', 'support']
const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const maxSendsPerDay = 6

function numbers(value: unknown, min: number, max: number) {
  return Array.isArray(value)
    ? [...new Set(value.filter((entry): entry is number => Number.isInteger(entry) && entry >= min && entry <= max))].sort((a, b) => a - b)
    : []
}

/* Настройки из ответа базы. Нет их (миграция ещё не применена) - прежний
   час и прежний состав, как у сводки до 15 сентября. */
export function parseSummaryConfig(value: unknown, fallbackHour: number): SummaryConfig {
  const source = obj(value as Json)
  const hours = numbers(source.hours, 0, 23)
  const days = numbers(source.days, 1, 7)
  const known = new Set(summaryBlocks.map((block) => block.id))
  const blocks = Array.isArray(source.blocks) ? source.blocks.filter((entry): entry is string => typeof entry === 'string' && known.has(entry)) : []
  return {
    hours: hours.length > 0 ? hours : [Math.min(Math.max(fallbackHour, 0), 23)],
    days: days.length > 0 ? days : [1, 2, 3, 4, 5, 6, 7],
    period: source.period === 'today' ? 'today' : 'yesterday',
    blocks: blocks.length > 0 ? blocks : defaultBlocks,
  }
}

/* «пн-пт в 09:00 и 21:00 МСК, итоги вчерашнего дня» - то же расписание словами. */
export function describeSchedule(config: SummaryConfig) {
  const days = config.days.length === 7
    ? 'каждый день'
    : config.days.join(',') === '1,2,3,4,5'
      ? 'по будням'
      : config.days.join(',') === '6,7'
        ? 'по выходным'
        : config.days.map((day) => dayNames[day - 1].toLocaleLowerCase('ru-RU')).join(', ')
  const hours = config.hours.map((hour) => `${String(hour).padStart(2, '0')}:00`)
  const times = hours.length === 1 ? hours[0] : `${hours.slice(0, -1).join(', ')} и ${hours[hours.length - 1]}`
  const period = config.period === 'today' ? 'итоги сегодняшнего дня к моменту отправки' : 'итоги вчерашнего дня'
  return `${days} в ${times} МСК, ${period}`
}

function missingMigration(message: string) {
  return /PGRST202|could not find the function/iu.test(message)
    ? 'Нужно применить миграцию 20260915210000: без неё база знает только час сводки.'
    : message
}

function toggle(list: number[], value: number) {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value].sort((a, b) => a - b)
}

export function DailySummaryEditor({ initial, onSaved }: { initial: SummaryConfig; onSaved: () => void }) {
  const { pending, run } = useAction()
  const [config, setConfig] = useState<SummaryConfig>(initial)
  /* Точка отсчёта «есть несохранённое» - последнее сохранённое, а не
     проп. Иначе после сохранения форма оставалась «грязной», пока обзор не
     перечитается, и «Отправить сейчас» была серой. */
  const [baseline, setBaseline] = useState<SummaryConfig>(initial)
  const [preview, setPreview] = useState<{ text: string; day: string } | null>(null)
  const [previewError, setPreviewError] = useState('')

  const configKey = JSON.stringify(config)
  const dirty = configKey !== JSON.stringify(baseline)
  const problem = config.hours.length === 0
    ? 'Выбери хотя бы один час.'
    : config.hours.length > maxSendsPerDay
      ? `Не больше ${maxSendsPerDay} отправок в день.`
      : config.days.length === 0
        ? 'Выбери хотя бы один день.'
        : config.blocks.length === 0
          ? 'Оставь в сводке хотя бы один блок.'
          : ''

  useEffect(() => {
    if (problem) return
    let active = true
    const timer = window.setTimeout(() => {
      adminRpc<Json>('admin_daily_summary_preview', { p_config: JSON.parse(configKey) as Json })
        .then((result) => {
          if (!active) return
          const data = obj(result)
          setPreview({ text: str(data.text), day: str(data.day) })
          setPreviewError('')
        })
        .catch((failure: unknown) => {
          if (active) setPreviewError(missingMigration(failure instanceof Error ? failure.message : 'Предпросмотр не загрузился.'))
        })
    }, 400)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [configKey, problem])

  const save = async () => {
    if (problem) return
    const saved = config
    const result = await run('summary', () => adminRpc('admin_setting_save', { p_key: 'daily_summary', p_value: saved as unknown as Json }), 'Сводка сохранена.')
    if (result === undefined) return
    setBaseline(saved)
    onSaved()
  }

  const sendNow = async () => {
    await run('summary-now', () => adminRpc('admin_daily_summary_send_now'), 'Сводка в очереди - уйдёт в течение минуты.')
  }

  return (
    <Panel
      title="Ежедневная сводка"
      description="Что приходит, когда и сколько раз в день. Куда - Telegram или почта - выбирается в «Правилах» у события «Дневная сводка»."
      actions={<Button size="sm" onClick={() => void sendNow()} loading={pending === 'summary-now'} disabled={dirty} title={dirty ? 'Сначала сохрани изменения: отправится сохранённая сводка.' : undefined}>Отправить сейчас</Button>}
    >
      <form className="ntf-summary" onSubmit={(event) => { event.preventDefault(); void save() }}>
        <div className="ntf-summary-row">
          <span className="ntf-summary-label">За какой период</span>
          <Segmented
            label="Период сводки"
            value={config.period}
            onChange={(period) => setConfig((current) => ({ ...current, period }))}
            options={[{ value: 'yesterday', label: 'Вчера целиком' }, { value: 'today', label: 'Сегодня к часу отправки' }]}
          />
        </div>

        {/* Кнопки часов и дней - в fieldset, а не в <label> поля: клик по
            подписи <label> отдаёт первой кнопке, и «По каким дням» включало
            бы понедельник. */}
        <fieldset className="ntf-fieldset">
          <legend className="ntf-summary-label">{`Во сколько, МСК - до ${maxSendsPerDay} раз в день`}</legend>
          <div className="ntf-chips" role="group" aria-label="Часы отправки">
            {Array.from({ length: 24 }, (_, hour) => (
              <button
                key={hour}
                type="button"
                className="ntf-chip"
                aria-pressed={config.hours.includes(hour)}
                onClick={() => setConfig((current) => ({ ...current, hours: toggle(current.hours, hour) }))}
              >
                {String(hour).padStart(2, '0')}
              </button>
            ))}
          </div>
          <small className="adm-field-hint">Несколько отправок удобно с периодом «сегодня»: утром и вечером придут разные цифры.</small>
        </fieldset>

        <fieldset className="ntf-fieldset">
          <legend className="ntf-summary-label">По каким дням</legend>
          <div className="ntf-chips" role="group" aria-label="Дни отправки">
            {dayNames.map((name, index) => (
              <button
                key={name}
                type="button"
                className="ntf-chip is-wide"
                aria-pressed={config.days.includes(index + 1)}
                onClick={() => setConfig((current) => ({ ...current, days: toggle(current.days, index + 1) }))}
              >
                {name}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="ntf-blocks">
          <legend className="ntf-summary-label">Что в сводке</legend>
          {summaryBlocks.map((block) => (
            <Check
              key={block.id}
              label={block.label}
              checked={config.blocks.includes(block.id)}
              onChange={(checked) => setConfig((current) => ({
                ...current,
                blocks: summaryBlocks.map((item) => item.id).filter((id) => (id === block.id ? checked : current.blocks.includes(id))),
              }))}
            />
          ))}
        </fieldset>

        <p className="ntf-summary-schedule">{problem || `Уйдёт ${describeSchedule(config)}.`}</p>

        <section className="ntf-preview-wrap" aria-label="Предпросмотр сводки">
          <span className="ntf-summary-label">Так она выглядит{preview?.day ? ` - по данным за ${preview.day.split('-').reverse().join('.')}` : ''}</span>
          {previewError
            ? <p className="set-form-error" role="alert">{previewError}</p>
            : <pre className="ntf-preview">{preview?.text ?? 'Собираем предпросмотр…'}</pre>}
        </section>

        <div className="ntf-summary-actions">
          <Button type="submit" variant="primary" disabled={!dirty || Boolean(problem)} loading={pending === 'summary'}>Сохранить сводку</Button>
          {dirty && <Button onClick={() => setConfig(baseline)}>Отменить изменения</Button>}
        </div>
      </form>
    </Panel>
  )
}
