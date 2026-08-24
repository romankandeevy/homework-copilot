import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AccountAvatar } from './AccountAvatar'

describe('AccountAvatar', () => {
  it('renders a saved preset without depending on the profile dialog', () => {
    const { container } = render(<AccountAvatar preset="orbit" initials="RK" />)

    expect(container.querySelector('.account-avatar-art.is-orbit svg')).toBeTruthy()
    expect(screen.queryByText('RK')).toBeNull()
  })

  it('falls back to initials when there is no preset', () => {
    render(<AccountAvatar initials="RK" />)

    expect(screen.getByText('RK')).toBeTruthy()
  })
})
