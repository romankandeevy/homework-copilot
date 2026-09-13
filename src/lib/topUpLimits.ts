/* Пределы пополнения баланса через Робокассу.

   Сумму вводит ученик, любую в этих границах и целыми рублями: копейки в
   поле суммы только путают, а OutSum с копейками - лишний повод разойтись
   подписи. Здесь и в зеркале базы `public.create_payment_order` - больше
   нигде. Меняешь одно - меняй и другое. */

export const minTopUpKopecks = 5000
export const maxTopUpKopecks = 1_500_000

export type TopUpAmount = { ok: true; kopecks: number } | { ok: false; error: string }

function rubles(kopecks: number) {
  return `${new Intl.NumberFormat('ru-RU').format(kopecks / 100)} ₽`
}

export function topUpRangeLabel() {
  return `от ${rubles(minTopUpKopecks)} до ${rubles(maxTopUpKopecks)}`
}

/* Ввод из поля: «150», «1 500», «1500 ₽». Дробная часть - ошибка, а не
   округление: молча поменять сумму платежа нельзя. */
export function parseTopUpRubles(input: string): TopUpAmount {
  const cleaned = input.replace(/[\s ₽]/gu, '').replace(/руб\.?$/iu, '')
  if (!cleaned) return { ok: false, error: 'Впиши сумму пополнения' }
  if (!/^\d+$/u.test(cleaned)) return { ok: false, error: 'Сумма пополнения - целое число рублей' }
  const value = Number(cleaned)
  return checkTopUpKopecks(value * 100)
}

export function checkTopUpKopecks(kopecks: number): TopUpAmount {
  if (!Number.isSafeInteger(kopecks) || kopecks % 100 !== 0) return { ok: false, error: 'Сумма пополнения - целое число рублей' }
  if (kopecks < minTopUpKopecks) return { ok: false, error: `Пополнение - не меньше ${rubles(minTopUpKopecks)}` }
  if (kopecks > maxTopUpKopecks) return { ok: false, error: `Пополнение - не больше ${rubles(maxTopUpKopecks)}` }
  return { ok: true, kopecks }
}
