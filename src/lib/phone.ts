/* Номер телефона для входа по СМС.

   Принимаем только российские мобильные: +7 и десять цифр, первая - 9.
   С 1 декабря 2023 года (406-ФЗ) российский сайт вправе авторизовать по
   российскому номеру, а СМС на городской или казахстанский номер (+7 6XX,
   +7 7XX) либо не дойдёт, либо уйдёт за чужой счёт. Проверяют и форма, и
   хук отправки СМС на сервере: номер из браузера ему не указ.

   Модуль без зависимостей: его читают и браузер, и функция на Vercel. */

/** Десять цифр национального номера из того, что набрали или вставили. */
export function phoneDigitsFromInput(raw: string) {
  let digits = raw.replace(/\D/gu, '')
  // «+7 912…», «8 912…» и «7912…» - одна и та же запись с кодом страны.
  if (digits.length >= 11 && /^[78]/u.test(digits)) digits = digits.slice(1)
  return digits.slice(0, 10)
}

export function isRussianMobileDigits(digits: string) {
  return /^9\d{9}$/u.test(digits)
}

/** «912 345-67-89» по мере набора. */
export function formatPhoneDigits(digits: string) {
  const value = digits.slice(0, 10)
  let formatted = value.slice(0, 3)
  if (value.length > 3) formatted += ` ${value.slice(3, 6)}`
  if (value.length > 6) formatted += `-${value.slice(6, 8)}`
  if (value.length > 8) formatted += `-${value.slice(8, 10)}`
  return formatted
}

/** Номер в любой записи - десять цифр российского мобильного или null.
    Supabase присылает хуку номер без плюса: «79123456789». */
export function normalizeRussianMobile(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!/^[+\d\s()-]{10,24}$/u.test(trimmed)) return null
  let digits = trimmed.replace(/\D/gu, '')
  if (digits.length === 11 && /^[78]/u.test(digits)) digits = digits.slice(1)
  return isRussianMobileDigits(digits) ? digits : null
}

/** Запись для Supabase Auth: «+79123456789». */
export function russianPhoneE164(digits: string) {
  return `+7${digits}`
}

/** Для показа: «+7 912 345-67-89». Чужой формат показываем как есть, с плюсом. */
export function formatPhoneForDisplay(value: unknown) {
  const digits = normalizeRussianMobile(value)
  if (digits) return `+7 ${formatPhoneDigits(digits)}`
  if (typeof value !== 'string' || !value.trim()) return ''
  return `+${value.trim().replace(/^\+/u, '')}`
}
