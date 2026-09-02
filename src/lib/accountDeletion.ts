import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { CHAT_ATTACHMENTS_BUCKET } from './chatClient'

/* Удаление аккаунта.

   Политика данных обещает удаление по запросу, а единственным способом был
   адрес почты, которого у домена нет. Теперь это делает сам пользователь.

   Порядок важен. Сначала уходят файлы вложений: их удаляет клиент своим
   правом на свою папку, потому что объекты хранилища живут вне транзакции
   базы, и после удаления строки `auth.users` этого права уже не будет. */

async function listAttachmentPaths(client: SupabaseClient<Database>, userId: string) {
  const paths: string[] = []
  const { data: folders } = await client.storage.from(CHAT_ATTACHMENTS_BUCKET).list(userId, { limit: 200 })

  for (const folder of folders ?? []) {
    // Файл на верхнем уровне папки: у объектов есть id, у папок его нет.
    if (folder.id) {
      paths.push(`${userId}/${folder.name}`)
      continue
    }
    // eslint-disable-next-line no-await-in-loop
    const { data: files } = await client.storage
      .from(CHAT_ATTACHMENTS_BUCKET)
      .list(`${userId}/${folder.name}`, { limit: 200 })
    for (const file of files ?? []) {
      if (file.id) paths.push(`${userId}/${folder.name}/${file.name}`)
    }
  }

  return paths
}

export type AccountDeletionResult = { deleted: boolean; attachments: number }

export async function deleteMyAccount(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<AccountDeletionResult> {
  let attachments: string[] = []
  try {
    attachments = await listAttachmentPaths(client, userId)
    if (attachments.length > 0) {
      await client.storage.from(CHAT_ATTACHMENTS_BUCKET).remove(attachments)
    }
  } catch {
    // Хранилище недоступно — аккаунт всё равно удаляем: оставить человека
    // с живой учётной записью из-за неубранной картинки было бы хуже.
    attachments = []
  }

  const { data, error } = await client.rpc('delete_my_account')
  if (error) throw error

  const payload = data as { deleted?: boolean } | null
  return { deleted: Boolean(payload?.deleted), attachments: attachments.length }
}
