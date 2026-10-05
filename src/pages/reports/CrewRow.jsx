import StatusBadge from '../../components/StatusBadge'
import Stepper from '../../components/Stepper'
import s from './ReportForm.module.css'

// One person on the daily report. Two lines, so the name has room and both
// controls are big enough for gloves: the name on top, and underneath a
// big Absent button and the hours stepper.
//   absent:     not here today - 0 hours, the row stays on the report
//   pending:    added by a site manager, not yet approved by the owner
//   onEditName: tap the name to fix their details (only for pending people
//               you added yourself); leave it out otherwise
//   leading:    the red remove button in Edit mode
function CrewRow({ name, hours, absent, pending, onHours, onToggleAbsent, onEditName, leading }) {
  return (
    <div className={absent ? `${s.crewRow} ${s.crewAbsent}` : s.crewRow}>
      {leading}
      <div className={s.crewBody}>
        <div className={s.crewName}>
          {onEditName ? (
            <button type="button" className={s.nameButton} onClick={onEditName}>
              {name}
            </button>
          ) : (
            <span className={s.nameText}>{name}</span>
          )}
          {pending && <StatusBadge status="pending" label="Pending" />}
        </div>
        <div className={s.crewControls}>
          <button
            type="button"
            className={s.absentButton}
            aria-pressed={absent}
            aria-label={`${name} absent`}
            onClick={onToggleAbsent}
          >
            Absent
          </button>
          {absent ? (
            <span className={s.absentHours}>0 h</span>
          ) : (
            <Stepper label={`${name} hours`} value={hours} min={0.5} unit="h" onChange={onHours} />
          )}
        </div>
      </div>
    </div>
  )
}

export default CrewRow
