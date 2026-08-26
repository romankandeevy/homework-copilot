import { createClient } from '@supabase/supabase-js'
import type { User } from '@supabase/supabase-js'
import type { AccountControl, Database, Profile, WalletEntry } from './database.types'

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
  control: AccountControl | null
}

export type ActivityEvent = 'session_started' | 'session_ended' | 'page_view'

export async function loadAccountData(user: User): Promise<AccountData> {
  if (!supabase) throw new Error('Supabase не подключён')

  const [
    { data: profile, error: profileError },
    { data: wallet, error: walletError },
    { data: entries, error: entriesError },
    { data: control, error: controlError },
  ] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase.from('wallet_accounts').select('balance').eq('user_id', user.id).single(),
    supabase.from('wallet_entries').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(5),
    supabase.from('account_controls').select('*').eq('user_id', user.id).maybeSingle(),
  ])

  if (profileError) throw profileError
  if (walletError) throw walletError
  if (entriesError) throw entriesError
  if (controlError) throw controlError

  return {
    profile,
    balance: wallet.balance,
    entries: entries ?? [],
    control,
  }
}

export async function trackMyActivity(event: ActivityEvent, path = window.location.pathname) {
  if (!supabase) return
  const normalizedPath = path.split('?')[0].split('#')[0] || '/'
  await supabase.rpc('track_my_activity', { p_event: event, p_path: normalizedPath })
}
