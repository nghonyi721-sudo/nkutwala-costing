import { createPortal } from 'react-dom'
import { useOverlay } from './overlay'
import Spinner from './Spinner'
import s from './ConfirmSheet.module.css'

// Apple's action sheet for confirming something: a title and message with
// the action underneath, and Cancel in its own block below.
//   destructive: the action is shown in red (e.g. Log out)
//   busy:        the action shows the activity indicator; nothing else
//                can be tapped
// onConfirm does the work; the parent closes the sheet when it's done.
//   actions: for more than one choice, [{ label, onClick, destructive, busy }]
//            in place of actionLabel/onConfirm/destructive
function ConfirmSheet({
  title,
  message,
  actionLabel,
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
  actions,
}) {
  const { closing, close } = useOverlay(onCancel)
  const choices = actions ?? [{ label: actionLabel, onClick: onConfirm, destructive, busy }]

  return createPortal(
    <div
      className={closing ? `${s.backdrop} ${s.closing}` : s.backdrop}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) close()
      }}
    >
      <div className={s.sheet} role="alertdialog" aria-modal="true" aria-label={title}>
        <div className={s.group}>
          <div className={s.header}>
            <p className={s.title}>{title}</p>
            {message && <p className={s.message}>{message}</p>}
          </div>
          {choices.map((choice) => (
            <button
              key={choice.label}
              type="button"
              className={choice.destructive ? `${s.action} ${s.destructive}` : s.action}
              disabled={busy}
              aria-busy={choice.busy || undefined}
              onClick={choice.onClick}
            >
              {choice.busy && <Spinner size={18} />}
              {choice.label}
            </button>
          ))}
        </div>
        <button type="button" className={s.cancel} disabled={busy} onClick={close} autoFocus>
          Cancel
        </button>
      </div>
    </div>,
    document.body,
  )
}

export default ConfirmSheet
