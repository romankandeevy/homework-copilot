/* Ошибки Supabase Auth — человеческим языком.

   Раньше всё, чего здесь не было, превращалось в «Не получилось выполнить
   запрос»: так владелец увидел ответ на «Восстанови доступ», хотя сам
   запрос восстановления прошёл, — это был предел Supabase на повторное
   письмо на тот же адрес. Сравниваем подстроки в нижнем регистре: коды
   ошибок Supabase не везде одинаковы, а текст стабилен.

   `channel` — чем шли: письмом или СМС. От него зависит, что писать про
   повторную отправку и неудачу доставки. */

export type AuthChannel = 'email' | 'phone'

export function authErrorMessage(message: string, channel: AuthChannel = 'email') {
  const normalized = message.toLocaleLowerCase('en')
  if (normalized.includes('invalid login credentials')) return 'Неверная почта или пароль'
  if (normalized.includes('user already registered')) return 'Аккаунт с этой почтой уже существует'
  if (normalized.includes('password') && normalized.includes('characters')) return 'Пароль должен содержать минимум 8 символов'
  if (normalized.includes('email rate limit')) return 'Слишком много писем. Попробуй немного позже'
  if (normalized.includes('sms rate limit') || normalized.includes('sms_send_rate')) return 'Слишком много СМС. Попробуй немного позже'
  // Supabase не шлёт второе письмо или СМС на тот же адрес раньше срока.
  if (normalized.includes('for security purposes') || normalized.includes('only request this after')) {
    return channel === 'phone'
      ? 'Код уже отправлен. Новый можно запросить через минуту'
      : 'Письмо уже отправлено. Новое можно запросить через минуту'
  }
  if (normalized.includes('signups not allowed') || normalized.includes('signup is disabled') || normalized.includes('signups are disabled')) return 'Регистрация временно закрыта'
  if (normalized.includes('invalid phone') || normalized.includes('phone number format') || normalized.includes('russian mobile')) return 'Нужен российский мобильный номер: +7 9XX XXX-XX-XX'
  // Провайдер Phone выключен в Supabase или хук отправки не настроен.
  if (
    (normalized.includes('phone') && (normalized.includes('disabled') || normalized.includes('unsupported')))
    || (normalized.includes('sms') && normalized.includes('not configured'))
  ) return 'Вход по номеру телефона пока не подключён'
  // Раньше проверки кода: «Error sending confirmation OTP to provider» содержит «otp».
  if (normalized.includes('sms') || normalized.includes('otp to provider') || (channel === 'phone' && (normalized.includes('error sending') || normalized.includes('hook')))) {
    return 'СМС с кодом не ушло. Попробуй ещё раз через минуту или войди по почте'
  }
  if (normalized.includes('error sending')) return 'Письмо не ушло: почта сервиса сейчас не отправляется. Напиши в поддержку'
  // Смена пароля или почты у аккаунта со вторым фактором без кода из приложения.
  if (normalized.includes('insufficient_aal') || normalized.includes('aal2')) return 'Нужен код из приложения-аутентификатора'
  if (normalized.includes('email not confirmed')) return 'Сначала подтверди почту кодом из письма'
  if (normalized.includes('token') || normalized.includes('otp')) return 'Код неверный или уже истёк'
  if (normalized.includes('referral claim unavailable')) return 'Не получилось закрепить приглашение. Повтори попытку'
  return 'Не получилось выполнить запрос. Проверь данные и попробуй ещё раз'
}
