// The company logo. It's a JPEG with a white background, so it must always
// sit on white. Kept at or below 120px wide so it stays sharp on phones.
function Logo({ width = 104 }) {
  return (
    <img
      src="/logo.jpeg"
      alt="Nkutwala Construction"
      width={width}
      height={Math.round((width * 128) / 355)}
      style={{ display: 'block', width, height: 'auto' }}
    />
  )
}

export default Logo
