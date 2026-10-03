// A numbered section heading, like a formal site document: "01  CREW".
function SectionHeading({ number, children }) {
  return (
    <h2 className="section-heading">
      {number && <span className="section-number num">{String(number).padStart(2, '0')}</span>}
      <span>{children}</span>
    </h2>
  )
}

export default SectionHeading
