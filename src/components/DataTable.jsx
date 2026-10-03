// A plain table: header row on a light grey band, rows divided by thin lines.
//
// columns: [{ key, label, numeric?, mono?, render?(row) }]
//   numeric - mono font, right-aligned (hours, litres, rands)
//   mono    - mono font, left-aligned (dates)
// onRowClick: makes each row tappable (the first cell also gets a real
//   button so it works with a keyboard and screen reader).
function DataTable({ columns, rows, rowKey = 'id', onRowClick, rowClassName, caption }) {
  function cellClass(column) {
    if (column.numeric) return 'numeric num'
    if (column.mono) return 'num'
    return undefined
  }

  return (
    <div className="table-wrap">
      <table className="table">
        {caption && <caption className="visually-hidden">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={column.numeric ? 'numeric' : undefined}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row[rowKey]}
              className={[onRowClick ? 'row-clickable' : '', rowClassName?.(row) ?? '']
                .filter(Boolean)
                .join(' ') || undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((column, index) => {
                const content = column.render ? column.render(row) : row[column.key]
                return (
                  <td key={column.key} className={cellClass(column)}>
                    {onRowClick && index === 0 ? (
                      <button
                        type="button"
                        className="row-button"
                        onClick={(event) => {
                          event.stopPropagation()
                          onRowClick(row)
                        }}
                      >
                        {content}
                      </button>
                    ) : (
                      content
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default DataTable
