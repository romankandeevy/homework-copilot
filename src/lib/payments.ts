import { supabase } from './supabase'

/* Клиент оплаты. Функция на Vercel - через тот же прокси на домене
   Supabase, что решатель и админка: из российских сетей до *.vercel.app
   доходит через раз. Сервер заводит заказ и отдаёт подписанную ссылку на
   Робокассу; деньги зачисляет база по уведомлению Робокассы, а не браузер. */

export type PaymentConfig = { enabled: boolean; testMode: boolean; minKopecks: number; maxKopecks: number }
export type PaymentOrderState = 'pending' | 'paid' | 'cancelled' | 'expired'
export type PaymentOrderStatus = { invId: number; status: PaymentOrderState; amountKopecks: number; testMode: boolean }
export type CreatedPayment = { url: string; invId: number; amountKopecks: number; testMode: boolean }

export class PaymentRequestError extends Error {}

export function paymentApiUrl() {
  const explicit = import.meta.env.VITE_PAYMENT_API_URL as string | undefined
  if (explicit) return explicit
  const solve = import.meta.env.VITE_HOMEWORK_API_URL as string | undefined
  if (solve && /\/solve$/u.test(solve)) return solve.replace(/\/solve$/u, '/payment')
  return '/api/payment'
}

async function paymentAction<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  if (!supabase) throw new PaymentRequestError('Оплата временно недоступна')
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new PaymentRequestError('Сессия закончилась. Войди в аккаунт ещё раз')
  let response: Response
  try {
    response = await fetch(paymentApiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, ...body }),
    })
  } catch {
    throw new PaymentRequestError('Сервер оплаты не ответил. Попробуй ещё раз через минуту')
  }
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) {
    // Наружу - только наши тексты, их признак - кириллица (как в чате).
    const message = typeof payload.error === 'string' && /[а-яё]/iu.test(payload.error) ? payload.error : 'Не получилось связаться с оплатой'
    throw new PaymentRequestError(message)
  }
  return payload as T
}

export const loadPaymentConfig = () => paymentAction<PaymentConfig>('config')
export const createPayment = (amountKopecks: number) => paymentAction<CreatedPayment>('create', { amountKopecks })
export const loadPaymentStatus = (invId: number) => paymentAction<PaymentOrderStatus>('status', { invId })

/* Возврат из Робокассы: `/app?payment=success&InvId=…&OutSum=…&SignatureValue=…`.
   Подпись в адресе не проверяем и ей не верим: деньги зачисляет только
   уведомление Result или сверка, а этот адрес лишь говорит, какой заказ
   спросить. */
export type PaymentReturn = { outcome: 'success' | 'fail'; invId: number | null }

const returnParams = ['payment', 'InvId', 'OutSum', 'SignatureValue', 'Culture', 'IsTest']

export function readPaymentReturn(search: string): PaymentReturn | null {
  const params = new URLSearchParams(search)
  const outcome = params.get('payment')
  if (outcome !== 'success' && outcome !== 'fail') return null
  const invId = Number(params.get('InvId'))
  return { outcome, invId: Number.isSafeInteger(invId) && invId > 0 ? invId : null }
}

export function withoutPaymentReturn(href: string) {
  const url = new URL(href)
  for (const name of returnParams) url.searchParams.delete(name)
  for (const name of [...url.searchParams.keys()]) {
    if (/^shp_/iu.test(name)) url.searchParams.delete(name)
  }
  return `${url.pathname}${url.search}${url.hash}`
}
