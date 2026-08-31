/* Метка браузера для одного бесплатного решения до регистрации.

   Самая дорогая граница на сайте — требование завести аккаунт до того, как
   человек увидел хоть одно решение. Гость получает один разбор без формы:
   право на него считает база по этой метке, поэтому подделать её бессмысленно
   — новая метка даёт новую запись, а не новую попытку сверх лимита по адресу.

   Здесь только хранение метки. Всё, что решает, выдавать решение или нет,
   живёт на сервере. */

const guestIdStorageKey = 'homework-copilot:guest-id'
const guestSolvedStorageKey = 'homework-copilot:guest-solved'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function createGuestId() {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID()
  // Приватный режим или старый браузер: метка всё равно должна быть похожей
  // на UUID, иначе сервер её не примет.
  const random = () => Math.floor(Math.random() * 16).toString(16)
  const template = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
  return template.replace(/[xy]/g, (character) => (
    character === 'x' ? random() : ((Math.floor(Math.random() * 4) + 8).toString(16))
  ))
}

/** Метка текущего браузера. Создаётся при первом обращении. */
export function getGuestId(): string | null {
  try {
    const stored = window.localStorage.getItem(guestIdStorageKey)
    if (stored && uuidPattern.test(stored)) return stored

    const created = createGuestId()
    window.localStorage.setItem(guestIdStorageKey, created)
    return created
  } catch {
    // Без хранилища бесплатное решение выдать нельзя: его не на что записать.
    return null
  }
}

/** Израсходовал ли гость своё единственное бесплатное решение. */
export function guestSolutionUsed(): boolean {
  try {
    return window.localStorage.getItem(guestSolvedStorageKey) === 'true'
  } catch {
    return false
  }
}

export function rememberGuestSolutionUsed() {
  try {
    window.localStorage.setItem(guestSolvedStorageKey, 'true')
  } catch {
    // Метку поставит сервер при следующем запросе.
  }
}

/** После входа гостевое ограничение больше не действует. */
export function forgetGuestSolution() {
  try {
    window.localStorage.removeItem(guestSolvedStorageKey)
  } catch {
    // Ничего страшного: у вошедшего ученика считается баланс, а не метка.
  }
}
