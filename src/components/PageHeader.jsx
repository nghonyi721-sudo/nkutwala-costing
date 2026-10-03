// The opening of every screen: a small capitals "eyebrow", a large title,
// an optional detail line (counts, dates) and a black rule underneath.
function PageHeader({ eyebrow, title, meta }) {
  return (
    <header className="page-header">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1 className="page-title">{title}</h1>
      {meta && <p className="page-meta">{meta}</p>}
    </header>
  )
}

export default PageHeader
