import { useState } from 'react'
import './fonts'
import {
  BulldozerIcon,
  CheckCircleIcon,
  CircleIcon,
  ClipboardTextIcon,
  ClockIcon,
  CloudRainIcon,
  FloppyDiskIcon,
  GasPumpIcon,
  HardHatIcon,
  ListChecksIcon,
  LockIcon,
  MapPinIcon,
  MinusIcon,
  NotePencilIcon,
  PaperPlaneTiltIcon,
  PlusIcon,
  ShieldCheckIcon,
  UsersThreeIcon,
  WarningIcon,
  XIcon,
} from '../icons'
import useSampleReport, { step } from '../useSampleReport'
import s from './fieldkit.module.css'

// TEMPORARY - Direction B · Field Kit: the daily report screen.

const SECTION_ICONS = {
  project: MapPinIcon,
  times: ClockIcon,
  crew: UsersThreeIcon,
  equipment: BulldozerIcon,
  conditions: CloudRainIcon,
  safety: ShieldCheckIcon,
  activities: NotePencilIcon,
}

const SAFETY_ICONS = {
  dsti: ListChecksIcon,
  audit: ClipboardTextIcon,
  nearMiss: WarningIcon,
  moment: HardHatIcon,
}

function Stepper({ label, value, onChange, by = 0.5, min = 0, max = 24, decimals = 1, unit }) {
  return (
    <div className={s.stepper}>
      {label && <span className={s.label}>{label}</span>}
      <div className={s.stepControls} role="group" aria-label={label}>
        <button
          type="button"
          className={s.stepBtn}
          aria-label={`Less ${label ?? ''}`}
          disabled={value <= min}
          onClick={() => onChange(step(value, -by, min, max))}
        >
          <MinusIcon size={26} weight="bold" />
        </button>
        <span className={s.stepValue} aria-live="polite">
          {value.toFixed(decimals)}
          {unit && <span className={s.stepUnit}>{unit}</span>}
        </span>
        <button
          type="button"
          className={s.stepBtn}
          aria-label={`More ${label ?? ''}`}
          disabled={value >= max}
          onClick={() => onChange(step(value, by, min, max))}
        >
          <PlusIcon size={26} weight="bold" />
        </button>
      </div>
    </div>
  )
}

function Card({ section, open, onToggle, locked, children }) {
  const Icon = SECTION_ICONS[section.key]
  const bodyId = `fk-${section.key}`
  return (
    <section className={open ? s.cardOpen : s.card}>
      <button
        type="button"
        className={s.cardHead}
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
      >
        <span className={s.iconTile} aria-hidden="true">
          <Icon size={24} weight="bold" />
        </span>
        <span className={s.cardText}>
          <span className={s.cardTitle}>{section.title}</span>
          <span className={s.cardSummary}>{section.summary}</span>
        </span>
        {section.done ? (
          <CheckCircleIcon size={30} weight="fill" className={s.stateDone} aria-label="Done" />
        ) : (
          <CircleIcon size={30} weight="bold" className={s.stateTodo} aria-label="Not done" />
        )}
      </button>
      {open && (
        <div className={s.cardBody} id={bodyId}>
          <fieldset className={s.fieldset} disabled={locked}>
            {children}
          </fieldset>
        </div>
      )}
    </section>
  )
}

function Lines({ lines, onHours, onRemove }) {
  return lines.map((line) => (
    <div key={line.id} className={s.person}>
      <div className={s.personHead}>
        <span>
          <span className={s.personName}>{line.name}</span>
          <span className={s.personRole}>{line.role}</span>
        </span>
        <button
          type="button"
          className={s.iconBtn}
          aria-label={`Remove ${line.name}`}
          onClick={() => onRemove(line.id)}
        >
          <XIcon size={24} weight="bold" />
        </button>
      </div>
      <Stepper
        label="Hours"
        value={line.hours}
        min={0.5}
        unit="h"
        onChange={(hours) => onHours(line.id, hours)}
      />
    </div>
  ))
}

function Picker({ items, onAdd, onClose, emptyText }) {
  return (
    <div className={s.picker}>
      {items.length === 0 && <p className={s.personRole}>{emptyText}</p>}
      {items.map((item) => (
        <button key={item.id} type="button" className={s.pickTile} onClick={() => onAdd(item.id)}>
          <PlusIcon size={22} weight="bold" />
          <span>
            <span className={s.personName}>{item.name}</span>
            <span className={s.personRole}>{item.role}</span>
          </span>
        </button>
      ))}
      <button type="button" className={s.btnOutline} onClick={onClose}>
        Done
      </button>
    </div>
  )
}

function DailyReport() {
  const r = useSampleReport()
  const [open, setOpen] = useState({ crew: true })
  const [picking, setPicking] = useState(null) // 'crew' | 'equipment' | null
  const toggle = (key) => setOpen((current) => ({ ...current, [key]: !current[key] }))
  const section = Object.fromEntries(r.sections.map((item) => [item.key, item]))
  const cardProps = (key) => ({
    section: section[key],
    open: Boolean(open[key]),
    onToggle: () => toggle(key),
    locked: r.locked,
  })

  return (
    <div className={s.root}>
      <header className={s.topBar}>
        <div className={s.topRow}>
          <img className={s.logo} src="/logo.jpeg" alt="Nkutwala Construction" width="112" height="40" />
          <span className={s.progressCount}>
            <strong>{r.doneCount}</strong> of {r.sections.length} done
          </span>
        </div>
        <div className={s.progress} aria-hidden="true">
          {r.sections.map((item) => (
            <span key={item.key} className={item.done ? s.stepDone : undefined} />
          ))}
        </div>
      </header>

      <div className={s.hero}>
        <p className={s.kicker}>
          Daily report
          <span className={r.locked ? s.chipBlue : s.chip}>{r.locked ? 'Submitted' : 'Draft'}</span>
        </p>
        <h1 className={s.heroTitle}>{r.project?.name ?? 'New report'}</h1>
        <p className={`${s.heroMeta} ${s.num}`}>
          {r.dateLabel}
          {r.project && ` · ${r.project.code}`}
        </p>
        {r.locked && (
          <p className={s.lockedBanner}>
            <LockIcon size={22} weight="bold" />
            Submitted and locked until the owner reopens it.
          </p>
        )}
      </div>

      <div className={s.figures}>
        <div className={s.figure}>
          <span className={s.figureLabel}>Man-hours</span>
          <span className={s.figureValue}>{r.manHours.toFixed(1)}</span>
          <span className={s.figureUnit}>h</span>
        </div>
        <div className={s.figure}>
          <span className={s.figureLabel}>Plant hours</span>
          <span className={s.figureValue}>{r.plantHours.toFixed(1)}</span>
          <span className={s.figureUnit}>h</span>
        </div>
      </div>

      <div className={s.sections}>
        <Card {...cardProps('project')}>
          {r.projects.map((project) => (
            <button
              key={project.id}
              type="button"
              className={s.option}
              aria-pressed={r.projectId === project.id}
              onClick={() => r.set('projectId', project.id)}
            >
              <span>
                <span className={s.optionName}>{project.name}</span>
                <span className={s.optionCode}>{project.code}</span>
              </span>
              {r.projectId === project.id && <CheckCircleIcon size={26} weight="fill" />}
            </button>
          ))}
          <label className={s.field}>
            <span className={s.label}>Date</span>
            <input
              className={s.input}
              type="date"
              value={r.date}
              onChange={(e) => r.set('date', e.target.value)}
            />
          </label>
        </Card>

        <Card {...cardProps('times')}>
          <div className={s.twoUp}>
            <label className={s.field}>
              <span className={s.label}>Start</span>
              <input
                className={s.input}
                type="time"
                value={r.start}
                onChange={(e) => r.set('start', e.target.value)}
              />
            </label>
            <label className={s.field}>
              <span className={s.label}>End</span>
              <input
                className={s.input}
                type="time"
                value={r.end}
                onChange={(e) => r.set('end', e.target.value)}
              />
            </label>
          </div>
        </Card>

        <Card {...cardProps('crew')}>
          <Lines lines={r.crewLines} onHours={r.setCrewHours} onRemove={r.removeCrew} />
          {picking === 'crew' ? (
            <Picker
              items={r.availableEmployees}
              emptyText="Everyone is already on the report."
              onAdd={r.addCrew}
              onClose={() => setPicking(null)}
            />
          ) : (
            <button type="button" className={s.btnAdd} onClick={() => setPicking('crew')}>
              <PlusIcon size={22} weight="bold" />
              Add person
            </button>
          )}
        </Card>

        <Card {...cardProps('equipment')}>
          <Lines lines={r.equipmentLines} onHours={r.setEquipmentHours} onRemove={r.removeEquipment} />
          {picking === 'equipment' ? (
            <Picker
              items={r.availableEquipment}
              emptyText="All equipment is already on the report."
              onAdd={r.addEquipment}
              onClose={() => setPicking(null)}
            />
          ) : (
            <button type="button" className={s.btnAdd} onClick={() => setPicking('equipment')}>
              <PlusIcon size={22} weight="bold" />
              Add equipment
            </button>
          )}
        </Card>

        <Card {...cardProps('conditions')}>
          <label className={s.field}>
            <span className={s.label}>
              <GasPumpIcon size={20} weight="bold" aria-hidden="true" />
              Fuel (litres)
            </span>
            <input
              className={s.input}
              type="number"
              inputMode="decimal"
              min="0"
              step="0.1"
              value={r.fuel}
              onChange={(e) => r.set('fuel', e.target.value)}
            />
          </label>
          <Stepper
            label="Rain"
            value={r.rain}
            by={10}
            max={100}
            decimals={0}
            unit="%"
            onChange={(value) => r.set('rain', value)}
          />
          <Stepper label="Delay" value={r.delay} unit="h" onChange={(value) => r.set('delay', value)} />
        </Card>

        <Card {...cardProps('safety')}>
          <div className={s.toggles}>
            {r.safetyItems.map((item) => {
              const Icon = SAFETY_ICONS[item.key]
              const on = r.safety[item.key]
              return (
                <button
                  key={item.key}
                  type="button"
                  className={item.alert ? `${s.toggle} ${s.toggleAlert}` : s.toggle}
                  aria-pressed={on}
                  onClick={() => r.setSafety(item.key, !on)}
                >
                  <span className={s.toggleTop}>
                    <Icon size={28} weight="bold" aria-hidden="true" />
                    <span className={s.toggleState}>{on ? 'YES' : 'NO'}</span>
                  </span>
                  <span className={s.toggleLabel}>{item.label}</span>
                </button>
              )
            })}
          </div>
        </Card>

        <Card {...cardProps('activities')}>
          <textarea
            className={s.textarea}
            aria-label="Activities"
            placeholder="What was done today, e.g. excavated and bedded 18 m of 900 mm pipe."
            value={r.activities}
            onChange={(e) => r.set('activities', e.target.value)}
          />
        </Card>
      </div>

      <div className={s.actionBar}>
        {r.message && (
          <p className={r.message.tone === 'warning' ? s.warning : s.message}>
            {r.message.tone === 'warning' ? (
              <WarningIcon size={22} weight="bold" aria-hidden="true" />
            ) : (
              <CheckCircleIcon size={22} weight="fill" aria-hidden="true" />
            )}
            {r.message.text}
          </p>
        )}

        {r.locked ? (
          <button type="button" className={s.btnOutline} onClick={r.reset}>
            Reset preview
          </button>
        ) : r.confirming ? (
          <>
            <p className={s.confirmText}>
              Submit the report for <strong>{r.project?.name}</strong>, {r.dateLabel}? You can&apos;t
              change it after this.
            </p>
            <div className={s.actions}>
              <button type="button" className={s.btnOutline} onClick={r.cancelSubmit}>
                Back
              </button>
              <button type="button" className={s.btnPrimary} onClick={r.confirmSubmit}>
                Yes, submit
              </button>
            </div>
          </>
        ) : (
          <div className={s.actions}>
            <button type="button" className={s.btnOutline} onClick={r.save}>
              <FloppyDiskIcon size={22} weight="bold" aria-hidden="true" />
              Save
            </button>
            <button type="button" className={s.btnPrimary} onClick={r.askSubmit}>
              <PaperPlaneTiltIcon size={22} weight="bold" aria-hidden="true" />
              Submit
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default DailyReport
