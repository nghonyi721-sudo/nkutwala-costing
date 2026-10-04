import s from './BrandMark.module.css'

// The signature mark: a short bar, blue then red, joined on a diagonal like
// the N in the logo. Drawn with shapes (no gradient). Decorative only.
//   size: 'md' (above page titles) or 'sm' (active tab)
function BrandMark({ size = 'md', className }) {
  return (
    <span className={[s.mark, s[size], className].filter(Boolean).join(' ')} aria-hidden="true">
      <span className={s.blue} />
      <span className={s.red} />
    </span>
  )
}

export default BrandMark
