import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

const focusableSelector = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

export function useModalIsolation<T extends HTMLElement>(open: boolean, onClose: () => void, returnFocusRef?: RefObject<HTMLElement | null>) {
  const dialogRef = useRef<T>(null)

  useEffect(() => {
    if (!open) return

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const returnFocusElement = returnFocusRef?.current ?? previouslyFocused
    const appShell = document.querySelector<HTMLElement>('.product-shell')
    const previousOverflow = document.body.style.overflow
    const previousInert = appShell?.inert ?? false
    const previousAriaHidden = appShell?.getAttribute('aria-hidden')

    document.body.style.overflow = 'hidden'
    if (appShell) {
      appShell.inert = true
      appShell.setAttribute('aria-hidden', 'true')
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }

      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector))
        .filter((element) => element.getClientRects().length > 0)
      if (!focusable.length) {
        event.preventDefault()
        dialogRef.current.focus()
        return
      }

      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      const focusIsOutside = !(document.activeElement instanceof Node) || !dialogRef.current.contains(document.activeElement)
      if (event.shiftKey && (document.activeElement === first || focusIsOutside)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || focusIsOutside)) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    const focusTimer = window.setTimeout(() => {
      if (!dialogRef.current) return
      const initialTarget = dialogRef.current.querySelector<HTMLElement>('[autofocus]')
        ?? dialogRef.current.querySelector<HTMLElement>(focusableSelector)
        ?? dialogRef.current
      initialTarget.focus()
    }, 0)

    return () => {
      window.clearTimeout(focusTimer)
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      if (appShell) {
        appShell.inert = previousInert
        if (previousAriaHidden == null) appShell.removeAttribute('aria-hidden')
        else appShell.setAttribute('aria-hidden', previousAriaHidden)
      }
      returnFocusElement?.focus()
    }
  }, [onClose, open, returnFocusRef])

  return dialogRef
}
