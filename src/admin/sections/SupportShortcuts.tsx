/* Горячие клавиши поддержки: список и окно-шпаргалка (открывается по «?»). */

import { Fragment } from 'react'
import { Modal } from '../ui'
import { SUPPORT_SHORTCUTS } from './supportModel'

export function ShortcutKeys({ keys }: { keys: string[] }) {
  return (
    <span className="sup-keys">
      {keys.map((key, index) => (
        <Fragment key={key}>
          {index > 0 && <span aria-hidden="true">+</span>}
          <kbd>{key}</kbd>
        </Fragment>
      ))}
    </span>
  )
}

const COMPACT = new Set(['J', 'K', 'R', 'E', '?'])

export function ShortcutList({ compact = false }: { compact?: boolean }) {
  const items = compact ? SUPPORT_SHORTCUTS.filter((item) => item.keys.length === 1 && COMPACT.has(item.keys[0])) : SUPPORT_SHORTCUTS
  return (
    <dl className={`sup-shortcuts${compact ? ' is-compact' : ''}`}>
      {items.map((item) => (
        <div key={item.keys.join('+')}>
          <dt><ShortcutKeys keys={item.keys} /></dt>
          <dd>{item.text}</dd>
        </div>
      ))}
    </dl>
  )
}

export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal open title="Горячие клавиши" onClose={onClose}>
      <div className="sup-shortcuts-modal">
        <p className="adm-muted">
          Работают в разделе «Поддержка», пока курсор не в поле ввода. Ctrl+Enter - наоборот, только в поле ответа.
          Буквы берутся по положению клавиши, поэтому раскладку переключать не нужно.
        </p>
        <ShortcutList />
      </div>
    </Modal>
  )
}
