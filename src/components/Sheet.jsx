import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { CheckIcon, PlusIcon } from './icons'
import { Row } from './Row'
import s from './Sheet.module.css'

// A panel that slides up from the bottom of the screen (like the phone's own
// pickers). Closes with the Done button, a tap on the dimmed area, or Escape.
//   footer: buttons pinned to the bottom of the sheet (e.g. Confirm / Cancel)
function Sheet({ title, hint, onClose, doneLabel = 'Done', footer, children }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return createPortal(
    <div
      className={s.backdrop}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className={s.sheet} role="dialog" aria-modal="true" aria-label={title}>
        <div className={s.grabber} aria-hidden="true" />
        <div className={s.head}>
          <h2 className={s.title}>{title}</h2>
          <button type="button" className={s.done} onClick={onClose} autoFocus>
            {doneLabel}
          </button>
        </div>
        {hint && <p className={s.hint}>{hint}</p>}
        <div className={s.body}>{children}</div>
        {footer && <div className={s.footer}>{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

// A white group inside a sheet, for rows.
export function SheetGroup({ children }) {
  return <div className={s.group}>{children}</div>
}

// A sheet listing options.
//   mode 'select': tap one to choose it (a check marks the current one); closes.
//   mode 'add':    tap to add; stays open so several can be added.
// options: [{ value, title, subtitle }]
export function PickSheet({ title, hint, options, selected, mode = 'select', emptyText, onPick, onClose }) {
  return (
    <Sheet title={title} hint={hint} onClose={onClose}>
      <SheetGroup>
        {options.length === 0 && <Row title={emptyText ?? 'Nothing to choose.'} />}
        {options.map((option) => (
          <Row
            key={option.value}
            icon={mode === 'add' ? PlusIcon : undefined}
            tone={mode === 'add' ? 'accent' : undefined}
            title={option.title}
            subtitle={option.subtitle}
            trailing={
              mode === 'select' && option.value === selected ? (
                <CheckIcon className={s.check} size={22} weight="bold" aria-label="Selected" />
              ) : undefined
            }
            onClick={() => {
              onPick(option.value)
              if (mode === 'select') onClose()
            }}
          />
        ))}
      </SheetGroup>
    </Sheet>
  )
}

export default Sheet
