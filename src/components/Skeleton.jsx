import s from './Skeleton.module.css'

// Grey placeholder rows in a group, shown while something loads. They pulse
// gently, and stay still if the phone is set to reduce motion.
function Skeleton({ rows = 3 }) {
  return (
    <div className={s.group} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className={s.row}>
          <span className={s.title} />
          <span className={s.detail} />
        </div>
      ))}
    </div>
  )
}

export default Skeleton
