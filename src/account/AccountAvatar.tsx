import type { AvatarPresetId } from './avatarPresets'

export function AccountAvatar({ preset, initials, className = '' }: { preset?: AvatarPresetId | null; initials: string; className?: string }) {
  if (!preset) return <span className={className}>{initials}</span>

  return (
    <span className={`account-avatar-art is-${preset}${className ? ` ${className}` : ''}`} aria-hidden="true">
      <svg viewBox="0 0 64 64" focusable="false">
        {preset === 'orbit' && <><circle cx="32" cy="32" r="12" /><ellipse cx="32" cy="32" rx="25" ry="12" /><circle cx="53" cy="27" r="4" /></>}
        {preset === 'spark' && <><path d="M32 7 38 25 57 32 38 39 32 57 26 39 7 32 26 25Z" /><circle cx="32" cy="32" r="5" /></>}
        {preset === 'wave' && <><path d="M5 23c9-11 18-11 27 0s18 11 27 0v11c-9 11-18 11-27 0S14 23 5 34Z" /><path d="M5 41c9-7 18-7 27 0s18 7 27 0" /></>}
        {preset === 'grid' && <><rect x="10" y="10" width="18" height="18" rx="3" /><rect x="36" y="10" width="18" height="18" rx="3" /><rect x="10" y="36" width="18" height="18" rx="3" /><rect x="36" y="36" width="18" height="18" rx="3" /></>}
        {preset === 'signal' && <><circle cx="32" cy="32" r="5" /><path d="M21 43a16 16 0 0 1 0-22M43 21a16 16 0 0 1 0 22M13 51a27 27 0 0 1 0-38M51 13a27 27 0 0 1 0 38" /></>}
        {preset === 'focus' && <><circle cx="32" cy="32" r="21" /><circle cx="32" cy="32" r="8" /><path d="M32 5v9M32 50v9M5 32h9M50 32h9" /></>}
      </svg>
    </span>
  )
}
