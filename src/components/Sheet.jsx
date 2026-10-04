import { createContext, useContext } from 'react'
import { createPortal } from 'react-dom'
import { CheckIcon, PlusCircleIcon } from './icons'
import { useOverlay } from './overlay'
import { Row } from './Row'
import s from './Sheet.module.css'

// Lets content inside a sheet close it with the slide-down animation.
const SheetContext = createContext(null)

// An iOS sheet: slides up from the bottom over a dimmed screen. Header is
// Apple's: [Cancel] · title · [Done]. Closes with those buttons, a tap on
// the dimmed area, or Escape.
//   cancelLabel: shows a Cancel button on the left
//   showDone:    the Done button on the right (default on)
//   footer:      buttons pinned to the bottom (e.g. "Void rate")
function Sheet({ title, hint, onClose, cancelLabel, doneLabel = 'Done', showDone = true, footer, children }) {
  const { closing, close } = useOverlay(onClose)

  return createPortal(
    <div
      className={closing ? `${s.backdrop} ${s.closing}` : s.backdrop}
      onClick={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div className={s.sheet} role="dialog" aria-modal="true" aria-label={title}>
        <div className={s.grabber} aria-hidden="true" />
        <div className={s.head}>
          <div className={s.headStart}>
            {cancelLabel && (
              <button type="button" className={s.headButton} onClick={close}>
                {cancelLabel}
              </button>
            )}
          </div>
          <h2 className={s.title}>{title}</h2>
          <div className={s.headEnd}>
            {showDone && (
              <button type="button" className={`${s.headButton} ${s.done}`} onClick={close} autoFocus>
                {doneLabel}
              </button>
            )}
          </div>
        </div>
        {hint && <p className={s.hint}>{hint}</p>}
        <SheetContext.Provider value={close}>
          <div className={s.body}>{children}</div>
        </SheetContext.Provider>
        {footer && <div className={s.footer}>{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

// A rounded group of rows inside a sheet.
export function SheetGroup({ children }) {
  return <div className={s.group}>{children}</div>
}

function PickList({ options, selected, mode, emptyText, onPick }) {
  const close = useContext(SheetContext)
  return (
    <SheetGroup>
      {options.length === 0 && <Row title={emptyText ?? 'Nothing to choose.'} />}
      {options.map((option) => (
        <Row
          key={option.value}
          icon={mode === 'add' ? PlusCircleIcon : undefined}
          tone={mode === 'add' ? 'accent' : undefined}
          title={option.title}
          subtitle={option.subtitle}
          trailing={
            mode === 'select' && option.value === selected ? (
              <CheckIcon className={s.check} size={20} weight="bold" aria-label="Selected" />
            ) : undefined
          }
          onClick={() => {
            onPick(option.value)
            if (mode === 'select') close()
          }}
        />
      ))}
    </SheetGroup>
  )
}

// A sheet listing options.
//   mode 'select': tap one to choose it (a check marks the current one); closes.
//   mode 'add':    tap to add; stays open so several can be added.
// options: [{ value, title, subtitle }]
export function PickSheet({ title, hint, options, selected, mode = 'select', emptyText, onPick, onClose }) {
  return (
    <Sheet title={title} hint={hint} onClose={onClose}>
      <PickList options={options} selected={selected} mode={mode} emptyText={emptyText} onPick={onPick} />
    </Sheet>
  )
}

export default Sheet
