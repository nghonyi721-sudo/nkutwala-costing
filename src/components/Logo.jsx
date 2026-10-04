import s from './Logo.module.css'

// The company logo. It's a JPEG with a white background, so it always sits on
// white: in Dark Mode it gets a small white rounded tile. Kept at or below
// 120px wide so it stays sharp on phones.
function Logo({ width = 104 }) {
  return (
    <span className={s.tile}>
      <img
        className={s.image}
        src="/logo.jpeg"
        alt="Nkutwala Construction"
        width={width}
        height={Math.round((width * 128) / 355)}
        style={{ width }}
      />
    </span>
  )
}

export default Logo
