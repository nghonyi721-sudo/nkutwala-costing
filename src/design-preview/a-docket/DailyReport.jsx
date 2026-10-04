import { useState } from 'react'
import { SAMPLE_USER } from '../sampleData'
import useSampleReport, { step } from '../useSampleReport'
import s from './docket.module.css'

// TEMPORARY - Direction A · Docket: the daily report screen.

function Section({ number, title, aside, children }) {
  return (
    <section className={s.section}>
      <header className={s.sectionHead}>
        <span className={s.sectionNo}>{String(number).padStart(2, '0')}</span>
        <h2 className={s.sectionTitle}>{title}</h2>
        {aside && <span className={s.sectionAside}>{aside}</span>}
      </header>
      {children}
    </section>
  )
}

function Stepper({ label, value, onChange, by = 0.5, min = 0, max = 24, decimals = 1 }) {
  return (
    <div className={s.stepper} role="group" aria-label={label}>
      <button
        type="button"
        className={s.stepBtn}
        aria-label={`Less ${label}`}
        disabled={value <= min}
        onClick={() => onChange(step(value, -by, min, max))}
      >
        −
      </button>
      <span className={s.stepValue} aria-live="polite">
        {value.toFixed(decimals)}
      </span>
      <button
        type="button"
        className={s.stepBtn}
        aria-label={`More ${label}`}
        disabled={value >= max}
        onClick={() => onChange(step(value, by, min, max))}
      >
        +
      </button>
    </div>
  )
}

function YesNo({ label, value, onChange, alert = false }) {
  return (
    <div className={s.yesNo} role="group" aria-label={label}>
      <button type="button" aria-pressed={!value} onClick={() => onChange(false)}>
        No
      </button>
      <button
        type="button"
        className={alert ? s.alertYes : undefined}
        aria-pressed={value}
        onClick={() => onChange(true)}
      >
        Yes
      </button>
    </div>
  )
}

function Lines({ lines, onHours, onRemove, unitLabel }) {
  return lines.map((line) => (
    <div key={line.id} className={s.line}>
      <div className={s.lineText}>
        <span className={s.lineName}>{line.name}</span>
        <span className={s.lineRole}>{line.role}</span>
      </div>
      <Stepper
        label={`${line.name} ${unitLabel}`}
        value={line.hours}
        min={0.5}
        onChange={(hours) => onHours(line.id, hours)}
      />
      <button type="button" className={s.removeBtn} onClick={() => onRemove(line.id)}>
        Remove
      </button>
    </div>
  ))
}

function Picker({ hint, items, onAdd, onClose }) {
  return (
    <div className={s.picker}>
      <p className={s.pickerHint}>{hint}</p>
      {items.length === 0 && <p className={s.pickerHint}>Everyone is already on the report.</p>}
      {items.map((item) => (
        <button key={item.id} type="button" className={s.pickRow} onClick={() => onAdd(item.id)}>
          <span>
            <span className={s.lineName}>{item.name}</span>
            <span className={s.lineRole}>{item.role}</span>
          </span>
          <span className={s.pickAdd}>Add</span>
        </button>
      ))}
      <button type="button" className={s.textBtn} onClick={onClose}>
        Done
      </button>
    </div>
  )
}

function DailyReport() {
  const r = useSampleReport()
  const [picking, setPicking] = useState(null) // 'crew' | 'equipment' | null

  return (
    <div className={s.root}>
      <header className={s.topBar}>
        <img className={s.logo} src="/logo.jpeg" alt="Nkutwala Construction" width="112" height="40" />
        <span className={s.formCode}>Daily activity report</span>
      </header>

      <div className={s.page}>
        <p className={s.eyebrow}>
          Daily report
          <span className={r.locked ? s.statusSubmitted : s.status}>
            {r.locked ? 'Submitted' : 'Draft'}
          </span>
        </p>
        <h1 className={s.title}>{r.project?.name ?? 'New report'}</h1>
        <p className={s.meta}>
          <span className={s.num}>{r.dateLabel}</span>
          {r.project && (
            <>
              {' · '}
              <span className={s.num}>{r.project.code}</span>
            </>
          )}
        </p>

        {r.locked && (
          <p className={s.banner}>Submitted and locked. Only the owner can reopen it.</p>
        )}

        <fieldset className={s.fieldset} disabled={r.locked}>
          <Section number={1} title="Project & date">
            {r.projects.map((project) => (
              <button
                key={project.id}
                type="button"
                className={s.choice}
                aria-pressed={r.projectId === project.id}
                onClick={() => r.set('projectId', project.id)}
              >
                <span className={s.radio} aria-hidden="true" />
                <span className={s.choiceText}>
                  <span className={s.choiceName}>{project.name}</span>
                  <span className={s.choiceCode}>{project.code}</span>
                </span>
              </button>
            ))}
            <label className={s.row}>
              <span className={s.rowLabel}>Date</span>
              <input
                className={s.inlineInput}
                type="date"
                value={r.date}
                onChange={(e) => r.set('date', e.target.value)}
              />
            </label>
          </Section>

          <Section
            number={2}
            title="Hours on site"
            aside={r.siteHours ? `${r.siteHours.toFixed(1)} h` : null}
          >
            <label className={s.row}>
              <span className={s.rowLabel}>Start</span>
              <input
                className={s.inlineInput}
                type="time"
                value={r.start}
                onChange={(e) => r.set('start', e.target.value)}
              />
            </label>
            <label className={s.row}>
              <span className={s.rowLabel}>End</span>
              <input
                className={s.inlineInput}
                type="time"
                value={r.end}
                onChange={(e) => r.set('end', e.target.value)}
              />
            </label>
          </Section>

          <Section number={3} title="Crew" aside={`${r.crewLines.length} on site`}>
            <Lines
              lines={r.crewLines}
              unitLabel="hours"
              onHours={r.setCrewHours}
              onRemove={r.removeCrew}
            />
            {picking === 'crew' ? (
              <Picker
                hint="Tap a name to add them."
                items={r.availableEmployees}
                onAdd={r.addCrew}
                onClose={() => setPicking(null)}
              />
            ) : (
              <button type="button" className={s.addRow} onClick={() => setPicking('crew')}>
                Add person
              </button>
            )}
            <div className={s.total}>
              <span className={s.totalLabel}>Total man-hours</span>
              <span className={s.totalValue}>
                {r.manHours.toFixed(1)}
                <span className={s.unit}>h</span>
              </span>
            </div>
          </Section>

          <Section number={4} title="Equipment" aside={`${r.equipmentLines.length} on site`}>
            <Lines
              lines={r.equipmentLines}
              unitLabel="hours"
              onHours={r.setEquipmentHours}
              onRemove={r.removeEquipment}
            />
            {picking === 'equipment' ? (
              <Picker
                hint="Tap a machine to add it."
                items={r.availableEquipment}
                onAdd={r.addEquipment}
                onClose={() => setPicking(null)}
              />
            ) : (
              <button type="button" className={s.addRow} onClick={() => setPicking('equipment')}>
                Add equipment
              </button>
            )}
            <div className={s.subtotal}>
              <span className={s.totalLabel}>Plant hours</span>
              <span className={s.totalValue}>
                {r.plantHours.toFixed(1)}
                <span className={s.unit}>h</span>
              </span>
            </div>
          </Section>

          <Section number={5} title="Conditions">
            <label className={s.row}>
              <span className={s.rowLabel}>Fuel (litres)</span>
              <input
                className={s.inlineInput}
                type="number"
                inputMode="decimal"
                min="0"
                step="0.1"
                value={r.fuel}
                onChange={(e) => r.set('fuel', e.target.value)}
              />
            </label>
            <div className={s.row}>
              <span className={s.rowLabel}>Rain (%)</span>
              <Stepper
                label="rain percent"
                value={r.rain}
                by={10}
                max={100}
                decimals={0}
                onChange={(value) => r.set('rain', value)}
              />
            </div>
            <div className={s.row}>
              <span className={s.rowLabel}>Delay (hours)</span>
              <Stepper label="delay hours" value={r.delay} onChange={(value) => r.set('delay', value)} />
            </div>
          </Section>

          <Section number={6} title="Safety">
            {r.safetyItems.map((item) => (
              <div key={item.key} className={s.row}>
                <span className={s.rowLabel}>{item.label}</span>
                <YesNo
                  label={item.label}
                  alert={item.alert}
                  value={r.safety[item.key]}
                  onChange={(value) => r.setSafety(item.key, value)}
                />
              </div>
            ))}
          </Section>

          <Section number={7} title="Activities">
            <textarea
              className={s.textarea}
              aria-label="Activities"
              placeholder="What was done today, e.g. excavated and bedded 18 m of 900 mm pipe."
              value={r.activities}
              onChange={(e) => r.set('activities', e.target.value)}
            />
          </Section>

          <p className={s.recordedBy}>
            <span>Recorded by</span>
            <strong>
              {SAMPLE_USER.name} · {SAMPLE_USER.role}
            </strong>
          </p>
        </fieldset>
      </div>

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
                Yes, submit
              </button>
            </div>
          </>
        ) : (
          <div className={s.actions}>
            <button type="button" className={s.btnSecondary} onClick={r.save}>
              Save draft
            </button>
            <button type="button" className={s.btnPrimary} onClick={r.askSubmit}>
              Submit report
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default DailyReport
