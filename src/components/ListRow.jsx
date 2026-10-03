// One tappable row in a list: title, grey detail line underneath, an
// optional tag on the right and a chevron (drawn in CSS - no icon font).
// action replaces the chevron with a word, e.g. "Add" in pick lists.
function ListRow({ title, detail, tag, onClick, muted = false, action, mono = false }) {
  return (
    <button
      type="button"
      className={['list-row', muted ? 'muted' : ''].filter(Boolean).join(' ')}
      onClick={onClick}
    >
      <span className="list-row-text">
        <span className="list-title">{title}</span>
        {detail && <span className={mono ? 'list-detail num' : 'list-detail'}>{detail}</span>}
      </span>
      {tag && <span className="list-row-tag">{tag}</span>}
      {action ? <span className="list-row-action">{action}</span> : <span className="chevron" aria-hidden="true" />}
    </button>
  )
}

export default ListRow
