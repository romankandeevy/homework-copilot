import { createHash, timingSafeEqual } from 'node:crypto'

/* Протокол Робокассы без сети и без базы: подписи, ссылка на оплату,
   разбор уведомления Result и ответа OpStateExt. Всё здесь - чистые
   функции, поэтому проверяется юнит-тестами.

   Подписи (алгоритм задаётся в кабинете магазина, по умолчанию MD5):
   - ссылка на оплату   MerchantLogin:OutSum:InvId:Пароль1,
                        с чеком MerchantLogin:OutSum:InvId:Receipt:Пароль1
   - уведомление Result  OutSum:InvId:Пароль2[:shp_…] - с чеком так же
   - статус OpStateExt   MerchantLogin:InvoiceID:Пароль2
   Параметры shp_ дописываются после пароля по алфавиту, как key=value.
   Мы их не шлём, но если в кабинете их добавят - подпись не разойдётся.

   У тестового режима своя пара паролей. Новый заказ идёт в тот режим,
   который включён сейчас, а уведомление проверяется той парой, которой
   сошлась подпись: база сверяет её с режимом заказа. */

export type RobokassaHash = 'md5' | 'sha1' | 'sha256' | 'sha384' | 'sha512'
export type RobokassaPasswords = { password1: string; password2: string }

export type RobokassaConfig = {
  merchantLogin: string
  hash: RobokassaHash
  live: RobokassaPasswords | null
  test: RobokassaPasswords | null
  /* Новые заказы - в тестовый режим. Базы у превью и прода одна, поэтому
     тестовый заказ может завести только служебный аккаунт (это проверяет
     `create_payment_order`). */
  testMode: boolean
  /* Чек НПД формирует Робокасса (Робочеки СМЗ): в ссылку уходят Receipt и
     почта аккаунта. Только при `ROBOKASSA_RECEIPTS=1`; иначе ссылка и
     подпись те же, что без чеков, знак в знак. */
  receipts: boolean
}

export const robokassaPaymentUrl = 'https://auth.robokassa.ru/Merchant/Index.aspx'
export const robokassaOpStateUrl = 'https://auth.robokassa.ru/Merchant/WebService/Service.asmx/OpStateExt'

const hashes = new Set<RobokassaHash>(['md5', 'sha1', 'sha256', 'sha384', 'sha512'])
const maxInvId = 2_147_483_647

function text(value: string | undefined) {
  return typeof value === 'string' ? value.trim() : ''
}

function passwords(first: string | undefined, second: string | undefined): RobokassaPasswords | null {
  const password1 = text(first)
  const password2 = text(second)
  return password1 && password2 ? { password1, password2 } : null
}

/* Нет логина или пароля того режима, в котором заводятся заказы, - оплаты
   нет вовсе: форма в кошельке не показывается, а сервер отвечает 503. */
export function robokassaConfigFromEnv(env: Record<string, string | undefined>): RobokassaConfig | null {
  const merchantLogin = text(env.ROBOKASSA_MERCHANT_LOGIN)
  if (!merchantLogin) return null
  const live = passwords(env.ROBOKASSA_PASSWORD1, env.ROBOKASSA_PASSWORD2)
  const test = passwords(env.ROBOKASSA_TEST_PASSWORD1, env.ROBOKASSA_TEST_PASSWORD2)
  const testMode = ['1', 'true', 'yes'].includes(text(env.ROBOKASSA_TEST_MODE).toLowerCase())
  if (testMode ? !test : !live) return null
  const requested = text(env.ROBOKASSA_HASH).toLowerCase() as RobokassaHash
  const receipts = text(env.ROBOKASSA_RECEIPTS) === '1'
  return { merchantLogin, hash: hashes.has(requested) ? requested : 'md5', live, test, testMode, receipts }
}

function digest(hash: RobokassaHash, value: string) {
  return createHash(hash).update(value, 'utf8').digest('hex')
}

function sameSignature(expected: string, received: string) {
  const left = Buffer.from(expected.toLowerCase(), 'utf8')
  const right = Buffer.from(received.trim().toLowerCase(), 'utf8')
  return left.length === right.length && timingSafeEqual(left, right)
}

/* 15000 копеек -> «150.00». Сумма в подписи должна совпасть с суммой в
   ссылке знак в знак, поэтому строка собирается один раз и здесь. */
export function formatOutSum(kopecks: number) {
  return `${Math.floor(kopecks / 100)}.${String(kopecks % 100).padStart(2, '0')}`
}

/* Робокасса возвращает сумму по-своему: «150.000000», «150,00», «150».
   Дробь дальше копеек допустима только нулями - иначе это не наша сумма. */
export function parseOutSumKopecks(raw: string): number | null {
  const match = raw.trim().match(/^(\d{1,9})(?:[.,](\d{1,8}))?$/u)
  if (!match) return null
  const fraction = match[2] ?? ''
  if (/[^0]/u.test(fraction.slice(2))) return null
  return Number(match[1]) * 100 + Number(fraction.slice(0, 2).padEnd(2, '0'))
}

function shpSuffix(params: URLSearchParams) {
  return [...params.entries()]
    .filter(([key]) => /^shp_/iu.test(key))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `:${key}=${value}`)
    .join('')
}

/* С чеком значение Receipt встаёт между InvId и паролем в том виде, в каком
   уходит параметром, - уже URL-кодированным (docs.robokassa.ru/ru/fiscalization). */
export function paymentSignature(config: RobokassaConfig, keys: RobokassaPasswords, outSum: string, invId: number, receipt: string | null = null) {
  const base = receipt === null ? `${config.merchantLogin}:${outSum}:${invId}` : `${config.merchantLogin}:${outSum}:${invId}:${receipt}`
  return digest(config.hash, `${base}:${keys.password1}`)
}

export function resultSignature(hash: RobokassaHash, outSum: string, invId: string, password2: string, params = new URLSearchParams()) {
  return digest(hash, `${outSum}:${invId}:${password2}${shpSuffix(params)}`)
}

export function opStateSignature(config: RobokassaConfig, keys: RobokassaPasswords, invId: number) {
  return digest(config.hash, `${config.merchantLogin}:${invId}:${keys.password2}`)
}

export const paymentDescription = 'Пополнение баланса Homework Copilot'

/* Чек для Робочеков СМЗ: одна позиция на всю сумму заказа. Пополнение -
   аванс за решения, которые ещё не выбраны, поэтому способ расчёта
   `advance`, предмет - `payment` («платёж (аванс, задаток…)»); НДС у
   самозанятого нет - `none`. `sno` не передаём: НПД в её списке нет, и
   Робокасса берёт систему из кабинета. Сумма - рубли числом до двух знаков
   из той же строки, что OutSum: сумма позиций обязана совпасть с суммой
   операции. Значение параметра - JSON без пробелов, закодированный в URL;
   ровно эта строка входит в подпись, а в ссылке кодируется ещё раз
   (`Receipt=%257B%2522items…`, как в примере docs.robokassa.ru). */
export function paymentReceipt(amountKopecks: number) {
  const receipt = {
    items: [{
      name: paymentDescription,
      quantity: 1,
      sum: Number(formatOutSum(amountKopecks)),
      payment_method: 'advance',
      payment_object: 'payment',
      tax: 'none',
    }],
  }
  return encodeURIComponent(JSON.stringify(receipt))
}

/* Почта покупателя для чека (параметр Email, в подпись не входит). Нет
   почты - у аккаунта по телефону её нет - или она не похожа на адрес: не
   передаём вовсе. */
function receiptEmail(value: string | null | undefined) {
  const email = text(value ?? undefined)
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ? email : null
}

export type PaymentOrder = { invId: number; amountKopecks: number; isTest: boolean; email?: string | null }

/* Без чеков ссылка и подпись те же, что были до них, знак в знак, и почта
   в ссылку не идёт: это закреплено тестом. */
export function buildPaymentUrl(config: RobokassaConfig, order: PaymentOrder) {
  const keys = order.isTest ? config.test : config.live
  if (!keys) throw new Error(order.isTest ? 'robokassa test passwords are not configured' : 'robokassa passwords are not configured')
  const outSum = formatOutSum(order.amountKopecks)
  const receipt = config.receipts ? paymentReceipt(order.amountKopecks) : null
  const params = new URLSearchParams({
    MerchantLogin: config.merchantLogin,
    OutSum: outSum,
    InvId: String(order.invId),
    Description: paymentDescription,
    SignatureValue: paymentSignature(config, keys, outSum, order.invId, receipt),
    Culture: 'ru',
    Encoding: 'utf-8',
  })
  if (receipt !== null) {
    params.set('Receipt', receipt)
    const email = receiptEmail(order.email)
    if (email) params.set('Email', email)
  }
  if (order.isTest) params.set('IsTest', '1')
  return `${robokassaPaymentUrl}?${params.toString()}`
}

export type ResultNotice = {
  invId: number
  amountKopecks: number
  isTest: boolean
  payload: Record<string, string>
}

export type ResultCheck = { ok: true; notice: ResultNotice } | { ok: false; reason: string }

/* Поля, которые сохраняем в заказе для разбора спора. Адрес почты
   плательщика сюда не идёт: для зачисления он не нужен. */
const keptResultFields = ['OutSum', 'InvId', 'Fee', 'IncCurrLabel', 'PaymentMethod', 'IsTest']

export function verifyResultNotice(config: RobokassaConfig, params: URLSearchParams): ResultCheck {
  const invIdRaw = text(params.get('InvId') ?? undefined)
  const outSum = text(params.get('OutSum') ?? undefined)
  const signature = text(params.get('SignatureValue') ?? undefined)
  if (!/^\d{1,10}$/u.test(invIdRaw) || Number(invIdRaw) < 1 || Number(invIdRaw) > maxInvId) return { ok: false, reason: 'bad InvId' }
  if (!outSum || !signature) return { ok: false, reason: 'missing fields' }
  const amountKopecks = parseOutSumKopecks(outSum)
  if (amountKopecks === null) return { ok: false, reason: 'bad OutSum' }

  const modes: { isTest: boolean; keys: RobokassaPasswords | null }[] = [
    { isTest: false, keys: config.live },
    { isTest: true, keys: config.test },
  ]
  const matched = modes.find(({ keys }) => keys && sameSignature(resultSignature(config.hash, outSum, invIdRaw, keys.password2, params), signature))
  if (!matched) return { ok: false, reason: 'bad signature' }

  const payload: Record<string, string> = {}
  for (const field of keptResultFields) {
    const value = params.get(field)
    if (value !== null) payload[field] = value.slice(0, 120)
  }
  return { ok: true, notice: { invId: Number(invIdRaw), amountKopecks, isTest: matched.isTest, payload } }
}

export function opStateUrl(config: RobokassaConfig, invId: number, isTest: boolean) {
  const keys = isTest ? config.test : config.live
  if (!keys) return null
  const params = new URLSearchParams({
    MerchantLogin: config.merchantLogin,
    InvoiceID: String(invId),
    Signature: opStateSignature(config, keys, invId),
  })
  if (isTest) params.set('IsTest', '1')
  return `${robokassaOpStateUrl}?${params.toString()}`
}

export type OpState = { resultCode: number; stateCode: number | null; outSumKopecks: number | null }

/* Ответ OpStateExt - XML. Нужны три числа, поэтому без парсера:
   <Result><Code>0</Code>…</Result><State><Code>100</Code>…</State>
   <Info>…<OutSum>150.000000</OutSum>…</Info>. */
export function parseOpState(xml: string): OpState | null {
  const resultCode = xml.match(/<Result>\s*<Code>\s*(\d+)\s*<\/Code>/u)
  if (!resultCode) return null
  const stateCode = xml.match(/<State>\s*<Code>\s*(\d+)\s*<\/Code>/u)
  const outSum = xml.match(/<OutSum>\s*([\d.,]+)\s*<\/OutSum>/u)
  return {
    resultCode: Number(resultCode[1]),
    stateCode: stateCode ? Number(stateCode[1]) : null,
    outSumKopecks: outSum ? parseOutSumKopecks(outSum[1]) : null,
  }
}

export type OpStateVerdict = 'paid' | 'pending' | 'cancelled' | 'not_found' | 'error'

/* Коды состояния Робокассы: 5 - счёт выставлен, 10 - отменён без оплаты,
   20 - деньги заморожены, 50 - деньги получены и зачисляются магазину,
   60 - отказ или возврат, 80 - приостановлен, 100 - оплачен. Зачисляем
   только на 100: остальное либо ещё не деньги, либо уже не наши.
   Код результата 3 - счёта с таким номером нет: ученик не дошёл до оплаты. */
export function classifyOpState(state: OpState | null): OpStateVerdict {
  if (!state) return 'error'
  if (state.resultCode === 3) return 'not_found'
  if (state.resultCode !== 0 || state.stateCode === null) return 'error'
  if (state.stateCode === 100) return 'paid'
  if (state.stateCode === 10 || state.stateCode === 60) return 'cancelled'
  return 'pending'
}
