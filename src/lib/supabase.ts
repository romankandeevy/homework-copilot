import { createClient } from '@supabase/supabase-js'
import type { User } from '@supabase/supabase-js'
import type { Database, Profile, WalletEntry } from './database.types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export const isSupabaseConfigured = import.meta.env.MODE !== 'test'
  && Boolean(supabaseUrl && supabasePublishableKey)

export const supabase = isSupabaseConfigured
  ? createClient<Database>(supabaseUrl!, supabasePublishableKey!, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    })
  : null

export type AccountData = {
  profile: Profile
  balance: number
  entries: WalletEntry[]
  avatarUrl: string | null
}

export async function loadAccountData(user: User): Promise<AccountData> {
  if (!supabase) throw new Error('Supabase не подключён')

  const [{ data: profile, error: profileError }, { data: wallet, error: walletError }, { data: entries, error: entriesError }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase.from('wallet_accounts').select('balance').eq('user_id', user.id).single(),
    supabase.from('wallet_entries').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(5),
  ])

  if (profileError) throw profileError
  if (walletError) throw walletError
  if (entriesError) throw entriesError

  let avatarUrl: string | null = null
  if (profile.avatar_path && !profile.avatar_path.startsWith('preset:')) {
    const { data } = await supabase.storage.from('profile-avatars').createSignedUrl(profile.avatar_path, 60 * 60)
    avatarUrl = data?.signedUrl ?? null
  }

  return {
    profile,
    balance: wallet.balance,
    entries: entries ?? [],
    avatarUrl,
  }
}
