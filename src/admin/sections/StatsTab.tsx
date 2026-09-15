/* Очистка статистики - только владельцу.

   15 сентября 2026 владелец попросил: статистика - только реальные данные,
   его собственные задачи в ней считаются, но после тестов её должно быть
   можно почистить. Удаляет база (admin_stats_purge): задачи и журнал
   решений, оценки, ошибки, журнал запросов, активность - за период,
   целиком или только своего аккаунта. Деньги - кошельки, пополнения,
   возвраты, заказы - не удаляются никогда: это бухгалтерия, а не
   статистика. Сначала подсчёт без удаления, потом удаление с
   подтверждением; каждое удаление пишется в журнал действий. */

import { useState } from 'react'
import type { Json } from '../../lib/database.types'
import { adminRpc, formatNumber, num, obj, shiftDate, todayMsk } from '../api'
import { useAdmin } from '../context'
import { Button, DateRangePicker, EmptyState, Field, Panel, Segmented, useAction } from '../ui'
import { Check, ConfirmModal } from './settingsParts'

const scopes = [
  { id: 'solutions', label: 'Задачи и журнал решений', hint: 'график задач, предметы, качество, расход на модели' },
  { id: 'ratings', label: 'Оценки решений', hint: '«помогло» и «не помогло»' },
  { id: 'errors', label: 'Ошибки', hint: 'события мониторинга; пустые группы пропадут' },
  { id: 'requests', label: 'Журнал запросов', hint: 'логи функций, 429 и 402' },
  { id: 'activity', label: 'Заходы и активность', hint: 'кто открывал приложение' },
] as const

const tableLabels: Record<string, string> = {
  solution_costs: 'Задачи (график, предметы, расход на модели)',
  solution_logs: 'Журнал решений',
  solution_ratings: 'Оценки решений',
  error_events: 'Ошибки',
  request_logs: 'Запросы',
  user_activity_events: 'События активности',
}

const confirmWord = 'очистить'

type Counts = { counts: Record<string, number>; total: number }

function parseCounts(value: unknown): Counts {
  const data = obj(value as Json)
  const counts: Record<string, number> = {}
  for (const [key, entry] of Object.entries(obj(data.counts))) counts[key] = num(entry)
  return { counts, total: num(data.total) }
}

export function StatsTab({ onChanged }: { onChanged: () => void }) {
  const { access } = useAdmin()
  if (!access.permissions.delete) {
    return <Panel title="Очистка статистики"><EmptyState>Очищать статистику может только владелец.</EmptyState></Panel>
  }
  return <StatsPurge onChanged={onChanged} />
}

function StatsPurge({ onChanged }: { onChanged: () => void }) {
  const today = todayMsk()
  const { pending, run } = useAction()
  const [selected, setSelected] = useState<string[]>(['solutions'])
  const [range, setRange] = useState({ from: shiftDate(today, -29), to: today })
  const [whose, setWhose] = useState<'mine' | 'all'>('mine')
  const [counted, setCounted] = useState<Counts | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [typed, setTyped] = useState('')

  const params = { p_scopes: selected, p_from: range.from, p_to: range.to, p_only_mine: whose === 'mine' }
  // Любая смена условий делает прежний подсчёт недействительным.
  const change = (apply: () => void) => {
    apply()
    setCounted(null)
  }

  const count = async () => {
    const result = await run('count', () => adminRpc('admin_stats_purge', { ...params, p_dry_run: true }))
    if (result !== undefined) setCounted(parseCounts(result))
  }

  const purge = async () => {
    const result = await run('purge', () => adminRpc('admin_stats_purge', { ...params, p_dry_run: false }), (response) => {
      const { total } = parseCounts(response)
      return `Удалено записей: ${formatNumber(total)}. Цифры дашборда пересчитаны.`
    })
    if (result === undefined) return
    setConfirming(false)
    setTyped('')
    setCounted(null)
    onChanged()
  }

  return (
    <Panel
      title="Очистка статистики"
      description="Удаляет записи статистики за период - например, свои тестовые задачи. Деньги - кошельки, пополнения, возвраты и заказы - не удаляются никогда. Сначала посчитай, сколько уйдёт."
    >
      <div className="set-purge">
        <fieldset className="set-purge-scopes">
          <legend className="set-purge-label">Что очистить</legend>
          {scopes.map((scope) => (
            <div className="set-purge-scope" key={scope.id}>
              <Check
                label={scope.label}
                checked={selected.includes(scope.id)}
                onChange={(checked) => change(() => setSelected((current) => (checked ? [...current, scope.id] : current.filter((id) => id !== scope.id))))}
              />
              <small>{scope.hint}</small>
            </div>
          ))}
        </fieldset>

        <div className="set-purge-conditions">
          <Field label="За период">
            <DateRangePicker value={range} onChange={(value) => change(() => setRange(value))} />
          </Field>
          <div className="set-purge-whose">
            <span className="set-purge-label">Чьи записи</span>
            <Segmented
              label="Чьи записи"
              value={whose}
              onChange={(value) => change(() => setWhose(value))}
              options={[{ value: 'mine', label: 'Только мой аккаунт' }, { value: 'all', label: 'Все аккаунты' }]}
            />
          </div>
        </div>

        {counted && (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead><tr><th>Что</th><th className="is-right">Записей</th></tr></thead>
              <tbody>
                {Object.entries(counted.counts).map(([table, value]) => (
                  <tr key={table}><td>{tableLabels[table] ?? table}</td><td className="is-right">{formatNumber(value)}</td></tr>
                ))}
                <tr className="set-purge-total"><td>Всего</td><td className="is-right">{formatNumber(counted.total)}</td></tr>
              </tbody>
            </table>
          </div>
        )}

        <div className="set-purge-actions">
          <Button onClick={() => void count()} loading={pending === 'count'} disabled={selected.length === 0}>Посчитать</Button>
          <Button
            variant="danger"
            disabled={!counted || counted.total === 0}
            onClick={() => setConfirming(true)}
            title={!counted ? 'Сначала посчитай, сколько записей уйдёт.' : undefined}
          >
            {counted ? `Удалить ${formatNumber(counted.total)}` : 'Удалить'}
          </Button>
          {selected.length === 0 && <small className="set-form-error">Выбери, что очистить.</small>}
          {counted?.total === 0 && <small className="adm-muted">За этот период удалять нечего.</small>}
        </div>
      </div>

      {confirming && counted && (
        <ConfirmModal
          title="Очистить статистику?"
          confirmLabel={`Удалить ${formatNumber(counted.total)}`}
          danger
          loading={pending === 'purge'}
          disabled={typed.trim().toLocaleLowerCase('ru-RU') !== confirmWord}
          onConfirm={() => void purge()}
          onClose={() => { setConfirming(false); setTyped('') }}
        >
          <p>
            Уйдёт {formatNumber(counted.total)} записей за {range.from.split('-').reverse().join('.')} - {range.to.split('-').reverse().join('.')}
            {whose === 'mine' ? ', только твоего аккаунта' : ', всех аккаунтов'}. Вернуть их нельзя. Деньги не затрагиваются.
          </p>
          <Field label={`Напиши «${confirmWord}», чтобы подтвердить`}>
            <input value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" data-initial-focus />
          </Field>
        </ConfirmModal>
      )}
    </Panel>
  )
}
