import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { EQUIPMENT_OWNERSHIP_LABELS } from '../../lib/labels'
import EquipmentForm from './EquipmentForm'

// Owner/admin: list of equipment. Tap one to edit, or add a new one.
function EquipmentPage({ onBack }) {
  // undefined = loading, array = loaded
  const [machines, setMachines] = useState(undefined)
  const [error, setError] = useState('')
  // null = show the list, 'new' = add form, a machine = edit form
  const [editing, setEditing] = useState(null)
  const [reloadCount, setReloadCount] = useState(0)

  useEffect(() => {
    let cancelled = false

    supabase
      .from('equipment')
      .select('id, name, ownership, active')
      .order('name')
      .then(({ data, error: loadError }) => {
        if (cancelled) return
        if (loadError) {
          setError('Could not load equipment. Check your signal and try again.')
        } else {
          setError('')
          setMachines(data)
        }
      })

    return () => {
      cancelled = true
    }
  }, [reloadCount])

  if (editing) {
    return (
      <EquipmentForm
        machine={editing === 'new' ? null : editing}
        onDone={(saved) => {
          setEditing(null)
          if (saved) setReloadCount((count) => count + 1)
        }}
      />
    )
  }

  return (
    <div className="card">
      <button type="button" className="btn-secondary btn-back" onClick={onBack}>
        ← Back
      </button>
      <h1>Equipment</h1>

      <button type="button" className="btn-primary" onClick={() => setEditing('new')}>
        + Add equipment
      </button>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {!error && machines === undefined && <p className="loading">Loading…</p>}

      {machines?.length === 0 && <p>No equipment yet.</p>}

      {machines?.length > 0 && (
        <ul className="list">
          {machines.map((machine) => (
            <li key={machine.id}>
              <button
                type="button"
                className={`list-item${machine.active ? '' : ' inactive'}`}
                onClick={() => setEditing(machine)}
              >
                <span className="list-title">{machine.name}</span>
                <span className="list-detail">
                  {EQUIPMENT_OWNERSHIP_LABELS[machine.ownership]}
                  {machine.active ? '' : ' · Inactive'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default EquipmentPage
