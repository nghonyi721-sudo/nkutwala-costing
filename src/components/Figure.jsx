// A key number set like a spec sheet: small capitals label, large mono value,
// unit in grey. Wrap several in <div className="figures"> for a row.
function Figure({ label, value, unit, emphasis = false }) {
  return (
    <div className={emphasis ? 'figure figure-emphasis' : 'figure'}>
      <span className="figure-label">{label}</span>
      <span className="figure-value num">
        {value}
        {unit && <span className="figure-unit">{unit}</span>}
      </span>
    </div>
  )
}

export default Figure
