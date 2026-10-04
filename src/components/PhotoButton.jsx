import { CameraIcon } from './icons'
import b from './Button.module.css'
import s from './PhotoButton.module.css'

// A button that opens the phone's back camera to photograph a receipt (on a
// computer it opens a file picker). onPhoto gets the picture file.
//   variant:     a Button variant ('primary', 'secondary', 'plain')
//   big:         a large camera panel, for when there's no photo yet
//   fromLibrary: choose an existing photo instead of taking one
function PhotoButton({
  onPhoto,
  variant = 'primary',
  big = false,
  fromLibrary = false,
  icon: Icon = CameraIcon,
  disabled = false,
  children,
}) {
  const classes = big
    ? [s.label, s.big]
    : [b.button, b[variant], variant === 'plain' ? b.inline : '', s.label]

  return (
    <label className={[...classes, disabled ? s.disabled : ''].filter(Boolean).join(' ')}>
      <Icon size={big ? 44 : variant === 'plain' ? 24 : 20} weight={big ? 'regular' : 'bold'} aria-hidden="true" />
      <span>{children}</span>
      <input
        type="file"
        accept="image/*"
        capture={fromLibrary ? undefined : 'environment'}
        className="visually-hidden"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0]
          // Cleared so the same photo can be chosen again after a retake.
          event.target.value = ''
          if (file) onPhoto(file)
        }}
      />
    </label>
  )
}

export default PhotoButton
