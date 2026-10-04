import { GearSixIcon } from './icons'
import s from './BrandBackdrop.module.css'

// A logo-blue field with the N's red diagonal and a faint cog, used behind
// the login and loading screens. Fills its parent, which must be
// position: relative. Decorative only.
function BrandBackdrop() {
  return (
    <div className={s.backdrop} aria-hidden="true">
      <span className={s.stroke} />
      <GearSixIcon className={s.cog} size={380} />
    </div>
  )
}

export default BrandBackdrop
