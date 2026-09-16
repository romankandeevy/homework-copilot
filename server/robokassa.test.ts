import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  buildPaymentUrl,
  classifyOpState,
  formatOutSum,
  opStateUrl,
  parseOpState,
  parseOutSumKopecks,
  paymentReceipt,
  resultSignature,
  robokassaConfigFromEnv,
  verifyResultNotice,
} from './robokassa.ts'
import type { RobokassaConfig } from './robokassa.ts'

const md5 = (value: string) => createHash('md5').update(value, 'utf8').digest('hex')

const config: RobokassaConfig = {
  merchantLogin: 'homework-copilot',
  hash: 'md5',
  live: { password1: 'live-one', password2: 'live-two' },
  test: { password1: 'test-one', password2: 'test-two' },
  testMode: false,
  receipts: false,
}

const withReceipts: RobokassaConfig = { ...config, receipts: true }

describe('robokassa config', () => {
  it('turns payments off when the passwords of the active mode are missing', () => {
    expect(robokassaConfigFromEnv({})).toBeNull()
    expect(robokassaConfigFromEnv({ ROBOKASSA_MERCHANT_LOGIN: 'shop', ROBOKASSA_PASSWORD1: 'a' })).toBeNull()
    expect(robokassaConfigFromEnv({ ROBOKASSA_MERCHANT_LOGIN: 'shop', ROBOKASSA_TEST_MODE: '1', ROBOKASSA_PASSWORD1: 'a', ROBOKASSA_PASSWORD2: 'b' })).toBeNull()
  })

  it('reads the test mode and uses md5 when no hash is set', () => {
    const parsed = robokassaConfigFromEnv({
      ROBOKASSA_MERCHANT_LOGIN: 'shop',
      ROBOKASSA_TEST_MODE: 'true',
      ROBOKASSA_TEST_PASSWORD1: 'a',
      ROBOKASSA_TEST_PASSWORD2: 'b',
    })
    expect(parsed).toMatchObject({ merchantLogin: 'shop', testMode: true, hash: 'md5', live: null, receipts: false })
    expect(robokassaConfigFromEnv({ ROBOKASSA_MERCHANT_LOGIN: 'shop', ROBOKASSA_PASSWORD1: 'a', ROBOKASSA_PASSWORD2: 'b', ROBOKASSA_HASH: 'SHA256' })?.hash).toBe('sha256')
  })

  it('turns payments off and logs loudly for an unknown hash instead of signing with md5', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const parsed = robokassaConfigFromEnv({
      ROBOKASSA_MERCHANT_LOGIN: 'shop',
      ROBOKASSA_PASSWORD1: 'a',
      ROBOKASSA_PASSWORD2: 'b',
      ROBOKASSA_HASH: 'sha-256',
    })
    expect(parsed).toBeNull()
    expect(String(logged.mock.calls[0]?.[0])).toContain('robokassa_hash_unknown')
    logged.mockRestore()
  })

  it('turns receipts on only with ROBOKASSA_RECEIPTS=1', () => {
    const env = { ROBOKASSA_MERCHANT_LOGIN: 'shop', ROBOKASSA_PASSWORD1: 'a', ROBOKASSA_PASSWORD2: 'b' }
    expect(robokassaConfigFromEnv(env)?.receipts).toBe(false)
    expect(robokassaConfigFromEnv({ ...env, ROBOKASSA_RECEIPTS: '0' })?.receipts).toBe(false)
    expect(robokassaConfigFromEnv({ ...env, ROBOKASSA_RECEIPTS: 'true' })?.receipts).toBe(false)
    expect(robokassaConfigFromEnv({ ...env, ROBOKASSA_RECEIPTS: '1' })?.receipts).toBe(true)
  })
})

describe('robokassa amounts', () => {
  it('formats OutSum once, the same way for the link and the signature', () => {
    expect(formatOutSum(15000)).toBe('150.00')
    expect(formatOutSum(15050)).toBe('150.50')
  })

  it('parses the sums Robokassa sends back and refuses anything finer than a kopeck', () => {
    expect(parseOutSumKopecks('150.000000')).toBe(15000)
    expect(parseOutSumKopecks('150,5')).toBe(15050)
    expect(parseOutSumKopecks('150')).toBe(15000)
    expect(parseOutSumKopecks('150.001')).toBeNull()
    expect(parseOutSumKopecks('-150')).toBeNull()
  })
})

describe('robokassa payment link', () => {
  it('signs MerchantLogin:OutSum:InvId:Password1 with the live pair', () => {
    const url = new URL(buildPaymentUrl(config, { invId: 100001, amountKopecks: 15000, isTest: false }))
    expect(url.origin + url.pathname).toBe('https://auth.robokassa.ru/Merchant/Index.aspx')
    expect(url.searchParams.get('OutSum')).toBe('150.00')
    expect(url.searchParams.get('InvId')).toBe('100001')
    expect(url.searchParams.get('SignatureValue')).toBe(md5('homework-copilot:150.00:100001:live-one'))
    expect(url.searchParams.has('IsTest')).toBe(false)
  })

  it('uses the test pair and marks the link as a test', () => {
    const url = new URL(buildPaymentUrl(config, { invId: 100002, amountKopecks: 5000, isTest: true }))
    expect(url.searchParams.get('SignatureValue')).toBe(md5('homework-copilot:50.00:100002:test-one'))
    expect(url.searchParams.get('IsTest')).toBe('1')
  })

  /* Ссылки сняты с кода до чеков (14 сентября 2026). Без
     ROBOKASSA_RECEIPTS=1 они обязаны остаться прежними знак в знак, и почта
     аккаунта в них не попадает. */
  it('keeps the link byte for byte without receipts, even when the account has an email', () => {
    expect(buildPaymentUrl(config, { invId: 100001, amountKopecks: 15000, isTest: false, email: 'student@example.com' })).toBe(
      'https://auth.robokassa.ru/Merchant/Index.aspx?MerchantLogin=homework-copilot&OutSum=150.00&InvId=100001'
      + '&Description=%D0%9F%D0%BE%D0%BF%D0%BE%D0%BB%D0%BD%D0%B5%D0%BD%D0%B8%D0%B5+%D0%B1%D0%B0%D0%BB%D0%B0%D0%BD%D1%81%D0%B0+Homework+Copilot'
      + '&SignatureValue=361e556b638743e97fecaf06c78b152f&Culture=ru&Encoding=utf-8',
    )
    expect(buildPaymentUrl(config, { invId: 100002, amountKopecks: 5000, isTest: true })).toBe(
      'https://auth.robokassa.ru/Merchant/Index.aspx?MerchantLogin=homework-copilot&OutSum=50.00&InvId=100002'
      + '&Description=%D0%9F%D0%BE%D0%BF%D0%BE%D0%BB%D0%BD%D0%B5%D0%BD%D0%B8%D0%B5+%D0%B1%D0%B0%D0%BB%D0%B0%D0%BD%D1%81%D0%B0+Homework+Copilot'
      + '&SignatureValue=bcc38609cbac39608f3822c9a3595b6c&Culture=ru&Encoding=utf-8&IsTest=1',
    )
  })
})

describe('robokassa receipt', () => {
  const receiptJson = '{"items":[{"name":"Пополнение баланса Homework Copilot","quantity":1,"sum":150,'
    + '"payment_method":"advance","payment_object":"payment","tax":"none"}]}'
  const sumOf = (kopecks: number) => (JSON.parse(decodeURIComponent(paymentReceipt(kopecks))) as { items: { sum: number }[] }).items[0]?.sum

  it('builds one position for the whole order as minified JSON encoded for a URL', () => {
    expect(paymentReceipt(15000)).toBe(encodeURIComponent(receiptJson))
    expect(decodeURIComponent(paymentReceipt(15000))).toBe(receiptJson)
  })

  it('encodes Cyrillic as UTF-8 bytes, spaces as %20 and nothing raw', () => {
    const receipt = paymentReceipt(15000)
    expect(receipt).toContain(
      '%22name%22%3A%22%D0%9F%D0%BE%D0%BF%D0%BE%D0%BB%D0%BD%D0%B5%D0%BD%D0%B8%D0%B5%20%D0%B1%D0%B0%D0%BB%D0%B0%D0%BD%D1%81%D0%B0%20Homework%20Copilot%22',
    )
    expect(receipt).not.toMatch(/[а-яё{}":,+ ]/iu)
  })

  it('writes the sum in rubles with kopecks, equal to OutSum', () => {
    expect(sumOf(15000)).toBe(150)
    expect(sumOf(15050)).toBe(150.5)
    expect(sumOf(1999)).toBe(19.99)
    expect(decodeURIComponent(paymentReceipt(1999))).toContain('"sum":19.99,')
    expect(decodeURIComponent(paymentReceipt(1_500_000))).toContain('"sum":15000,')
    for (const kopecks of [5000, 1999, 15050, 1_500_000]) expect(sumOf(kopecks)).toBe(Number(formatOutSum(kopecks)))
  })
})

describe('robokassa payment link with a receipt', () => {
  const order = { invId: 100001, amountKopecks: 15000, isTest: false, email: 'student@example.com' }

  it('passes Receipt and signs MerchantLogin:OutSum:InvId:Receipt:Password1 with the encoded value', () => {
    const link = buildPaymentUrl(withReceipts, order)
    const url = new URL(link)
    const receipt = paymentReceipt(15000)
    expect(url.searchParams.get('Receipt')).toBe(receipt)
    expect(url.searchParams.get('SignatureValue')).toBe(md5(`homework-copilot:150.00:100001:${receipt}:live-one`))
    expect(url.searchParams.get('OutSum')).toBe('150.00')
    expect(url.searchParams.get('Description')).toBe('Пополнение баланса Homework Copilot')
    // В самой ссылке значение закодировано ещё раз, как в примере документации.
    expect(link).toContain('&Receipt=%257B%2522items%2522%253A%255B%257B%2522name%2522%253A%2522%25D0%259F%25D0%25BE')
  })

  it('sends the account email for the receipt outside the signature', () => {
    const withEmail = new URL(buildPaymentUrl(withReceipts, order))
    const withoutEmail = new URL(buildPaymentUrl(withReceipts, { ...order, email: undefined }))
    expect(withEmail.searchParams.get('Email')).toBe('student@example.com')
    expect(withoutEmail.searchParams.has('Email')).toBe(false)
    expect(withEmail.searchParams.get('SignatureValue')).toBe(withoutEmail.searchParams.get('SignatureValue'))
    expect(new URL(buildPaymentUrl(withReceipts, { ...order, email: 'not an email' })).searchParams.has('Email')).toBe(false)
  })

  it('signs a test order with the test pair and a sum with kopecks', () => {
    const url = new URL(buildPaymentUrl(withReceipts, { invId: 100002, amountKopecks: 15050, isTest: true }))
    const receipt = paymentReceipt(15050)
    expect(url.searchParams.get('OutSum')).toBe('150.50')
    expect(decodeURIComponent(receipt)).toContain('"sum":150.5,')
    expect(url.searchParams.get('SignatureValue')).toBe(md5(`homework-copilot:150.50:100002:${receipt}:test-one`))
    expect(url.searchParams.get('IsTest')).toBe('1')
  })
})

describe('robokassa result notice', () => {
  const notice = (password2: string, extra: Record<string, string> = {}) => {
    const params = new URLSearchParams({ OutSum: '150.000000', InvId: '100001', ...extra })
    params.set('SignatureValue', resultSignature('md5', '150.000000', '100001', password2, params).toUpperCase())
    return params
  }

  it('accepts a live notice signed with password 2, in either letter case', () => {
    const check = verifyResultNotice(config, notice('live-two', { PaymentMethod: 'BankCard' }))
    expect(check).toEqual({ ok: true, notice: { invId: 100001, amountKopecks: 15000, isTest: false, payload: { OutSum: '150.000000', InvId: '100001', PaymentMethod: 'BankCard' } } })
  })

  it('checks the notice the same way when receipts are on', () => {
    const params = notice('live-two', { EMail: 'student@example.com' })
    expect(verifyResultNotice(withReceipts, params)).toEqual(verifyResultNotice(config, params))
    expect(verifyResultNotice(withReceipts, params).ok).toBe(true)
  })

  it('tells a test notice by the pair that signed it', () => {
    const check = verifyResultNotice(config, notice('test-two'))
    expect(check.ok && check.notice.isTest).toBe(true)
  })

  it('refuses a notice signed with password 1 or tampered with', () => {
    expect(verifyResultNotice(config, notice('live-one'))).toEqual({ ok: false, reason: 'bad signature' })
    const tampered = notice('live-two')
    tampered.set('OutSum', '1500.000000')
    expect(verifyResultNotice(config, tampered)).toEqual({ ok: false, reason: 'bad signature' })
  })

  it('includes shp_ parameters after the password in alphabetical order', () => {
    const params = new URLSearchParams({ OutSum: '150.00', InvId: '100001', shp_b: '2', shp_a: '1' })
    params.set('SignatureValue', md5('150.00:100001:live-two:shp_a=1:shp_b=2'))
    expect(verifyResultNotice(config, params).ok).toBe(true)
  })
})

describe('robokassa operation state', () => {
  const xml = (result: number, state?: number) => `<?xml version="1.0" encoding="utf-8"?>
<OperationStateResponse xmlns="http://merchant.roboxchange.com/WebService/">
  <Result><Code>${result}</Code></Result>
  ${state === undefined ? '' : `<State><Code>${state}</Code><RequestDate>2026-09-13T10:00:00+03:00</RequestDate></State>`}
  <Info><IncCurrLabel>BankCard</IncCurrLabel><IncSum>150.000000</IncSum><OutSum>150.000000</OutSum></Info>
</OperationStateResponse>`

  it('credits only a completed payment', () => {
    expect(classifyOpState(parseOpState(xml(0, 100)))).toBe('paid')
    expect(parseOpState(xml(0, 100))?.outSumKopecks).toBe(15000)
    expect(classifyOpState(parseOpState(xml(0, 50)))).toBe('pending')
    expect(classifyOpState(parseOpState(xml(0, 5)))).toBe('pending')
  })

  it('separates a cancelled payment, an unknown invoice and a broken answer', () => {
    expect(classifyOpState(parseOpState(xml(0, 10)))).toBe('cancelled')
    expect(classifyOpState(parseOpState(xml(0, 60)))).toBe('cancelled')
    expect(classifyOpState(parseOpState(xml(3)))).toBe('not_found')
    expect(classifyOpState(parseOpState(xml(1)))).toBe('error')
    expect(classifyOpState(parseOpState('<html>maintenance</html>'))).toBe('error')
  })

  it('signs the state request MerchantLogin:InvoiceID:Password2', () => {
    const url = new URL(opStateUrl(config, 100001, false) ?? '')
    expect(url.searchParams.get('Signature')).toBe(md5('homework-copilot:100001:live-two'))
    expect(url.searchParams.has('IsTest')).toBe(false)
  })
})
