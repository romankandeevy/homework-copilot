/* Налог и комиссия - по ставкам владельца.

   15 сентября 2026 владелец спросил, почему у решённой задачи расход на
   модели есть, а заработка нет, и попросил на дашборде колонку «налог».
   Считает база (private.money_rates): налог НПД - с того, что пришло за
   период после возвратов, комиссия Робокассы - с каждого платежа. Ставки
   здесь: у самозанятого НПД с физлиц 4 %, с вычетом 10 000 ₽ - 3 %, пока
   вычет не израсходован (остаток видно в «Мой налог»); комиссию своего
   тарифа Робокасса показывает в кабинете. */

import { useState } from 'react'
import type { Json } from '../../lib/database.types'
import { adminRpc, obj } from '../api'
import { Button, Field, Panel, useAction } from '../ui'
import { Check } from './settingsParts'

export type MoneyRates = { taxPercent: number; feePercent: number; deduction: boolean }

export const defaultMoneyRates: MoneyRates = { taxPercent: 4, feePercent: 3.9, deduction: false }

export function parseMoneyRates(value: unknown): MoneyRates {
  const source = obj(value as Json)
  const numberOr = (entry: unknown, fallback: number) => (typeof entry === 'number' && Number.isFinite(entry) ? entry : fallback)
  return {
    taxPercent: numberOr(source.taxPercent, defaultMoneyRates.taxPercent),
    feePercent: numberOr(source.feePercent, defaultMoneyRates.feePercent),
    deduction: typeof source.deduction === 'boolean' ? source.deduction : defaultMoneyRates.deduction,
  }
}

/* Ставка налога с учётом вычета: 4 % становится 3 %. */
export function effectiveTaxPercent(rates: MoneyRates) {
  return Math.max(rates.taxPercent - (rates.deduction ? 1 : 0), 0)
}

function percentValue(text: string) {
  const value = Number(text.replace(',', '.'))
  return text.trim() !== '' && Number.isFinite(value) && value >= 0 && value <= 20 ? value : null
}

function formatPercentInput(value: number) {
  return String(value).replace('.', ',')
}

export function MoneyRatesEditor({ initial, onSaved }: { initial: MoneyRates; onSaved: () => void }) {
  const { pending, run } = useAction()
  const [tax, setTax] = useState(formatPercentInput(initial.taxPercent))
  const [fee, setFee] = useState(formatPercentInput(initial.feePercent))
  const [deduction, setDeduction] = useState(initial.deduction)
  const taxValue = percentValue(tax)
  const feeValue = percentValue(fee)
  const valid = taxValue !== null && feeValue !== null
  const dirty = valid && (taxValue !== initial.taxPercent || feeValue !== initial.feePercent || deduction !== initial.deduction)

  const save = async () => {
    if (!valid) return
    const result = await run(
      'rates',
      () => adminRpc('admin_setting_save', { p_key: 'money_rates', p_value: { taxPercent: taxValue, feePercent: feeValue, deduction } }),
      'Ставки сохранены: дашборд пересчитает налог и комиссию.',
    )
    if (result !== undefined) onSaved()
  }

  const effective = taxValue === null ? null : Math.max(taxValue - (deduction ? 1 : 0), 0)

  return (
    <Panel
      title="Налог и комиссия"
      description="По этим ставкам дашборд считает, сколько остаётся чистыми. Налог НПД - с пополнений за вычетом возвратов, комиссия Робокассы - с каждого платежа."
    >
      <form className="set-form" onSubmit={(event) => { event.preventDefault(); void save() }}>
        <div className="adm-form-grid">
          <Field label="Налог НПД, %" hint={taxValue === null ? 'Число от 0 до 20.' : 'С физлиц - 4 %, с юрлиц и ИП - 6 %.'}>
            <input inputMode="decimal" value={tax} onChange={(event) => setTax(event.target.value)} />
          </Field>
          <Field label="Комиссия Робокассы, %" hint={feeValue === null ? 'Число от 0 до 20.' : 'Карта на тарифе «Базовый» - 3,9 %, СБП - 3,5 %. Точная - в кабинете Робокассы.'}>
            <input inputMode="decimal" value={fee} onChange={(event) => setFee(event.target.value)} />
          </Field>
        </div>
        <Check label="Действует вычет 10 000 ₽ - ставка на пункт ниже, пока он не израсходован" checked={deduction} onChange={setDeduction} />
        {effective !== null && <small className="adm-muted">Сейчас налог считается по ставке {formatPercentInput(effective)} %.</small>}
        <div>
          <Button type="submit" variant="primary" disabled={!dirty} loading={pending === 'rates'}>Сохранить ставки</Button>
        </div>
      </form>
    </Panel>
  )
}
