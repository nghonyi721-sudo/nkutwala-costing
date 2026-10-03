// Flat grey placeholder bars shown while something loads. They pulse in
// opacity only (no shimmer gradient) and stay still if the phone is set to
// reduce motion.
function Skeleton({ rows = 3 }) {
  return (
    <div className="skeleton" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton-row">
          <span className="skeleton-bar skeleton-title" />
          <span className="skeleton-bar skeleton-detail" />
        </div>
      ))}
    </div>
  )
}

export default Skeleton
