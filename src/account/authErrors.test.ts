import { describe, expect, it } from 'vitest'
import { authErrorMessage } from './authErrors'

describe('authErrorMessage', () => {
  // Предел Supabase на повторное письмо на тот же адрес. Владелец увидел его
  // на «Восстанови доступ» как «Не получилось выполнить запрос».
  it('explains the per-address throttle for email', () => {
    expect(authErrorMessage('For security purposes, you can only request this after 42 seconds.'))
      .toBe('Письмо уже отправлено. Новое можно запросить через минуту')
    expect(authErrorMessage('You can only request this after 60 seconds'))
      .toBe('Письмо уже отправлено. Новое можно запросить через минуту')
  })

  it('explains the same throttle for SMS codes', () => {
    expect(authErrorMessage('For security purposes, you can only request this after 42 seconds.', 'phone'))
      .toBe('Код уже отправлен. Новый можно запросить через минуту')
  })

  it('says the email was not sent when Supabase could not send it', () => {
    for (const message of ['Error sending recovery email', 'Error sending confirmation email', 'Error sending magic link email']) {
      expect(authErrorMessage(message)).toBe('Письмо не ушло: почта сервиса сейчас не отправляется. Напиши в поддержку')
    }
  })

  it('says the SMS was not sent when the provider or the hook failed', () => {
    const sms = 'СМС с кодом не ушло. Попробуй ещё раз через минуту или войди по почте'
    expect(authErrorMessage('Error sending confirmation OTP to provider: timeout', 'phone')).toBe(sms)
    expect(authErrorMessage('SMS provider did not accept the message', 'phone')).toBe(sms)
    expect(authErrorMessage('Error running hook URI: https://example.com/api/sms-hook', 'phone')).toBe(sms)
    // Даже без подсказки канала «otp to provider» - это СМС, а не неверный код.
    expect(authErrorMessage('Error sending confirmation OTP to provider')).toBe(sms)
  })

  it('says phone sign-in is not connected when the provider is off', () => {
    expect(authErrorMessage('Unsupported phone provider', 'phone')).toBe('Вход по номеру телефона пока не подключён')
    expect(authErrorMessage('Phone logins are disabled', 'phone')).toBe('Вход по номеру телефона пока не подключён')
    expect(authErrorMessage('SMS sending is not configured', 'phone')).toBe('Вход по номеру телефона пока не подключён')
  })

  it('asks for a Russian mobile number', () => {
    expect(authErrorMessage('Invalid phone number format (E.164 required)', 'phone')).toBe('Нужен российский мобильный номер: +7 9XX XXX-XX-XX')
    expect(authErrorMessage('Only Russian mobile numbers are supported', 'phone')).toBe('Нужен российский мобильный номер: +7 9XX XXX-XX-XX')
  })

  it('says registration is closed', () => {
    expect(authErrorMessage('Signups not allowed for this instance')).toBe('Регистрация временно закрыта')
    expect(authErrorMessage('Signups not allowed for otp', 'phone')).toBe('Регистрация временно закрыта')
    expect(authErrorMessage('Signup is disabled')).toBe('Регистрация временно закрыта')
  })

  // Админ со вторым фактором менял пароль по ссылке из письма, и Supabase
  // отвечал insufficient_aal - владелец видел «Не получилось выполнить запрос».
  it('asks for the authenticator code when the session is below aal2', () => {
    expect(authErrorMessage('AAL2 session is required to update email or password when MFA is enabled.'))
      .toBe('Нужен код из приложения-аутентификатора')
    expect(authErrorMessage('insufficient_aal')).toBe('Нужен код из приложения-аутентификатора')
  })

  it('keeps the earlier mappings', () => {
    expect(authErrorMessage('Invalid login credentials')).toBe('Неверная почта или пароль')
    expect(authErrorMessage('Token has expired or is invalid', 'phone')).toBe('Код неверный или уже истёк')
    expect(authErrorMessage('something unexpected')).toBe('Не получилось выполнить запрос. Проверь данные и попробуй ещё раз')
  })
})
