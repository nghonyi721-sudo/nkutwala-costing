import { useCallback, useEffect, useState } from 'react'
import {
  CalendarBlankIcon,
  CaretRightIcon,
  CheckIcon,
  ClipboardTextIcon,
  ClockIcon,
  CloudRainIcon,
  GasPumpIcon,
  HardHatIcon,
  HourglassIcon,
  ListChecksIcon,
  LockIcon,
  MapPinIcon,
  MinusCircleIcon,
  MinusIcon,
  PlusIcon,
  WarningIcon,
} from '../icons'
import useSampleReport, { step } from '../useSampleReport'
import s from './native.module.css'

// TEMPORARY - Direction C · Native: the daily report screen.

const SAFETY_ICONS = {
  dsti: ListChecksIcon,
  audit: ClipboardTextIcon,
  nearMiss: WarningIcon,
  moment: HardHatIcon,
}

function Stepper({ label, value, onChange, by = 0.5, min = 0, max = 24, decimals = 1, unit = '' }) {
  return (
    <div className={s.stepper} role="group" aria-label={label}>
      <button
        type="button"
        className={s.stepBtn}
        aria-label={`Less ${label}`}
        disabled={value <= min}
        onClick={() => onChange(step(value, -by, min, max))}
      >
        <MinusIcon size={20} weight="bold" />
      </button>
      <span className={s.stepValue} aria-live="polite">
        {value.toFixed(decimals)}
        {unit}
      </span>
      <button
        type="button"
        className={s.stepBtn}
        aria-label={`More ${label}`}
        disabled={value >= max}
        onClick={() => onChange(step(value, by, min, max))}
      >
        <PlusIcon size={20} weight="bold" />
      </button>
    </div>
  )
}

// A pop-up panel from the bottom of the screen. Closes with Done, a tap on
// the dimmed area, or Escape.
function Sheet({ title, hint, onClose, children }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      className={s.backdrop}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className={s.sheet} role="dialog" aria-modal="true" aria-label={title}>
        <div className={s.grabber} />
        <div className={s.sheetHead}>
          <h2 className={s.sheetTitle}>{title}</h2>
          <button type="button" className={s.sheetDone} onClick={onClose} autoFocus>
            Done
          </button>
        </div>
        {hint && <p className={s.sheetHint}>{hint}</p>}
        {children}
      </div>
    </div>
  )
}

function PickSheet({ title, hint, items, emptyText, onAdd, onClose }) {
  return (
    <Sheet title={title} hint={hint} onClose={onClose}>
      <div className={s.group}>
        {items.length === 0 && (
          <p className={s.row}>
            <span className={s.rowSub}>{emptyText}</span>
          </p>
        )}
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`${s.row} ${s.withIcon}`}
            onClick={() => onAdd(item.id)}
          >
            <PlusIcon className={s.plus} size={24} />
            <span className={s.rowMain}>
              <span className={s.rowTitle}>{item.name}</span>
              <span className={s.rowSub}>{item.role}</span>
            </span>
          </button>
        ))}
      </div>
    </Sheet>
  )
}

function LinesGroup({ caption, lines, editing, onEdit, onHours, onRemove, onAdd, addLabel, totalLabel, total }) {
  return (
    <>
      <div className={s.caption}>
        <span>{caption}</span>
        {lines.length > 0 && (
          <button type="button" className={s.captionAction} onClick={onEdit}>
            {editing ? 'Done' : 'Edit'}
          </button>
        )}
      </div>
      <div className={s.group}>
        {lines.map((line) => (
          <div key={line.id} className={s.row}>
            {editing && (
              <button
                type="button"
                className={s.removeBtn}
                aria-label={`Remove ${line.name}`}
                onClick={() => onRemove(line.id)}
              >
                <MinusCircleIcon size={28} weight="fill" />
              </button>
            )}
            <span className={s.rowMain}>
              <span className={s.rowTitle}>{line.name}</span>
              <span className={s.rowSub}>{line.role}</span>
            </span>
            <Stepper
              label={`${line.name} hours`}
              value={line.hours}
              min={0.5}
              onChange={(hours) => onHours(line.id, hours)}
            />
          </div>
        ))}
        <button type="button" className={`${s.addRow} ${s.withIcon}`} onClick={onAdd}>
          <PlusIcon className={s.plus} size={24} />
          {addLabel}
        </button>
        <div className={s.row}>
          <span className={s.rowMain}>{totalLabel}</span>
          <span className={s.rowStrong}>{total.toFixed(1)} h</span>
        </div>
      </div>
    </>
  )
}

function DailyReport() {
  const r = useSampleReport()
  const [sheet, setSheet] = useState(null) // 'project' | 'crew' | 'equipment' | null
  const [editing, setEditing] = useState(null) // 'crew' | 'equipment' | null
  const closeSheet = useCallback(() => setSheet(null), [])
  const toggleEditing = (list) => setEditing((current) => (current === list ? null : list))

  return (
    <div className={s.root}>
      <header className={s.topBar}>
        <img className={s.logo} src="/logo.jpeg" alt="Nkutwala Construction" width="108" height="39" />
        <span className={r.locked ? s.statusSubmitted : s.status}>
          {r.locked ? 'Submitted' : 'Draft'}
        </span>
      </header>

      <div className={s.titleBlock}>
        <h1 className={s.largeTitle}>Daily report</h1>
        <p className={`${s.subtitle} ${s.num}`}>
          {r.dateLabel}
          {r.project && ` · ${r.project.name}`}
        </p>
      </div>

      {r.locked && (
        <>
          <p className={s.caption}>Status</p>
          <div className={s.group}>
            <p className={`${s.lockedRow} ${s.withIcon}`}>
              <LockIcon className={s.rowIcon} size={24} />
              Submitted and locked until the owner reopens it.
            </p>
          </div>
        </>
      )}

      <fieldset className={s.fieldset} disabled={r.locked}>
        <p className={s.caption}>Project</p>
        <div className={s.group}>
          <button type="button" className={`${s.row} ${s.withIcon}`} onClick={() => setSheet('project')}>
            <MapPinIcon className={s.rowIcon} size={24} />
            <span className={s.rowMain}>
              <span className={s.rowTitle}>{r.project?.name ?? 'Choose a project'}</span>
              {r.project && <span className={`${s.rowSub} ${s.num}`}>{r.project.code}</span>}
            </span>
            <CaretRightIcon className={s.chevron} size={20} weight="bold" />
          </button>
          <label className={`${s.row} ${s.withIcon}`}>
            <CalendarBlankIcon className={s.rowIcon} size={24} />
            <span className={s.rowMain}>Date</span>
            <input
              className={s.rowInput}
              type="date"
              value={r.date}
              onChange={(e) => r.set('date', e.target.value)}
            />
          </label>
        </div>

        <p className={s.caption}>Times</p>
        <div className={s.group}>
          <label className={`${s.row} ${s.withIcon}`}>
            <ClockIcon className={s.rowIcon} size={24} />
            <span className={s.rowMain}>Start</span>
            <input
              className={s.rowInput}
              type="time"
              value={r.start}
              onChange={(e) => r.set('start', e.target.value)}
            />
          </label>
          <label className={`${s.row} ${s.withIcon}`}>
            <ClockIcon className={s.rowIcon} size={24} />
            <span className={s.rowMain}>End</span>
            <input
              className={s.rowInput}
              type="time"
              value={r.end}
              onChange={(e) => r.set('end', e.target.value)}
            />
          </label>
        </div>
        <p className={`${s.groupFooter} ${s.num}`}>
          {r.siteHours ? `${r.siteHours.toFixed(1)} hours on site` : 'Set a start and end time.'}
        </p>

        <LinesGroup
          caption={`Crew · ${r.crewLines.length}`}
          lines={r.crewLines}
          editing={editing === 'crew'}
          onEdit={() => toggleEditing('crew')}
          onHours={r.setCrewHours}
          onRemove={r.removeCrew}
          onAdd={() => setSheet('crew')}
          addLabel="Add person"
          totalLabel="Total man-hours"
          total={r.manHours}
        />

        <LinesGroup
          caption={`Equipment · ${r.equipmentLines.length}`}
          lines={r.equipmentLines}
          editing={editing === 'equipment'}
          onEdit={() => toggleEditing('equipment')}
          onHours={r.setEquipmentHours}
          onRemove={r.removeEquipment}
          onAdd={() => setSheet('equipment')}
          addLabel="Add equipment"
          totalLabel="Plant hours"
          total={r.plantHours}
        />

        <p className={s.caption}>Conditions</p>
        <div className={s.group}>
          <label className={`${s.row} ${s.withIcon}`}>
            <GasPumpIcon className={s.rowIcon} size={24} />
            <span className={s.rowMain}>Fuel (litres)</span>
            <input
              className={s.rowInput}
              type="number"
              inputMode="decimal"
              min="0"
              step="0.1"
              value={r.fuel}
              onChange={(e) => r.set('fuel', e.target.value)}
            />
          </label>
          <div className={`${s.row} ${s.withIcon}`}>
            <CloudRainIcon className={s.rowIcon} size={24} />
            <span className={s.rowMain}>Rain</span>
            <Stepper
              label="rain percent"
              value={r.rain}
              by={10}
              max={100}
              decimals={0}
              unit="%"
              onChange={(value) => r.set('rain', value)}
            />
          </div>
          <div className={`${s.row} ${s.withIcon}`}>
            <HourglassIcon className={s.rowIcon} size={24} />
            <span className={s.rowMain}>Delay</span>
            <Stepper
              label="delay hours"
              value={r.delay}
              unit=" h"
              onChange={(value) => r.set('delay', value)}
            />
          </div>
        </div>

        <p className={s.caption}>Safety</p>
        <div className={s.group}>
          {r.safetyItems.map((item) => {
            const Icon = SAFETY_ICONS[item.key]
            const on = r.safety[item.key]
            return (
              <button
                key={item.key}
                type="button"
                role="switch"
                aria-checked={on}
                className={`${s.row} ${s.withIcon}`}
                onClick={() => r.setSafety(item.key, !on)}
              >
                <Icon className={s.rowIcon} size={24} />
                <span className={s.rowMain}>{item.label}</span>
                <span
                  className={item.alert ? `${s.switch} ${s.switchAlert}` : s.switch}
                  aria-hidden="true"
                />
              </button>
            )
          })}
        </div>

        <p className={s.caption}>Activities</p>
        <div className={s.textGroup}>
          <textarea
            className={s.textarea}
            aria-label="Activities"
            placeholder="What was done today, e.g. excavated and bedded 18 m of 900 mm pipe."
            value={r.activities}
            onChange={(e) => r.set('activities', e.target.value)}
          />
        </div>
      </fieldset>

      <div className={s.actionBar}>
        {r.message && (
          <p className={r.message.tone === 'warning' ? s.warning : s.message}>{r.message.text}</p>
        )}

        {r.locked ? (
          <button type="button" className={s.btnSecondary} onClick={r.reset}>
            Reset preview
          </button>
        ) : r.confirming ? (
          <>
            <p className={s.confirmText}>
              Submit the report for <strong>{r.project?.name}</strong>, {r.dateLabel}? You can&apos;t
              change it after this.
            </p>
            <div className={s.actions}>
              <button type="button" className={s.btnSecondary} onClick={r.cancelSubmit}>
                Go back
              </button>
              <button type="button" className={s.btnPrimary} onClick={r.confirmSubmit}>
                Submit
              </button>
            </div>
          </>
        ) : (
          <div className={s.actions}>
            <button type="button" className={s.btnSecondary} onClick={r.save}>
              Save draft
            </button>
            <button type="button" className={s.btnPrimary} onClick={r.askSubmit}>
              Submit
            </button>
          </div>
        )}
      </div>

      {sheet === 'project' && (
        <Sheet title="Project" onClose={closeSheet}>
          <div className={s.group}>
            {r.projects.map((project) => (
              <button
                key={project.id}
                type="button"
                className={s.row}
                onClick={() => {
                  r.set('projectId', project.id)
                  closeSheet()
                }}
              >
                <span className={s.rowMain}>
                  <span className={s.rowTitle}>{project.name}</span>
                  <span className={`${s.rowSub} ${s.num}`}>{project.code}</span>
                </span>
                {r.projectId === project.id && <CheckIcon className={s.check} size={22} weight="bold" />}
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {sheet === 'crew' && (
        <PickSheet
          title="Add people"
          hint="Tap to add. People already on the report aren’t shown."
          items={r.availableEmployees}
          emptyText="Everyone is already on the report."
          onAdd={r.addCrew}
          onClose={closeSheet}
        />
      )}

      {sheet === 'equipment' && (
        <PickSheet
          title="Add equipment"
          hint="Tap to add. Machines already on the report aren’t shown."
          items={r.availableEquipment}
          emptyText="All equipment is already on the report."
          onAdd={r.addEquipment}
          onClose={closeSheet}
        />
      )}
    </div>
  )
}

export default DailyReport
