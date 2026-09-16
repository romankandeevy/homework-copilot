/* Подтверждение удаления аккаунта. Один аккаунт подтверждают только его
   почтой или номером (и из карточки, и одной отмеченной строкой списка),
   несколько - словом «УДАЛИТЬ». Отдельно от окна, чтобы его
   модуль экспортировал только компонент. Ту же сверку повторяют сервер
   админки и база (admin_delete_user). */

export const deleteConfirmWord = 'УДАЛИТЬ'

/** Совпало ли то, что вписал владелец, с ожидаемым: словом, почтой или номером. */
export function deleteConfirmMatches(typed: string, expected: string) {
  const clean = typed.trim()
  if (!expected) return false
  if (expected === deleteConfirmWord) return clean === deleteConfirmWord
  if (expected.includes('@')) return clean.toLowerCase().replace(/\s/g, '') === expected.toLowerCase()
  const digits = clean.replace(/\D/g, '')
  return digits !== '' && digits === expected.replace(/\D/g, '')
}
