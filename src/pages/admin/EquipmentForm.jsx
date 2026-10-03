import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { EQUIPMENT_OWNERSHIP_LABELS } from '../../lib/labels'
import ChoiceButtons from '../../components/ChoiceButtons'

const ACTIVE_OPTIONS = { yes: 'Active', no: 'Inactive' }

// Add a machine (machine = null) or edit one. Equipment is never deleted:
// mark it Inactive instead. No rates here - quantities only.
function EquipmentForm({ machine, onDone }) {
  const [name, setName] = useState(machine?.name ?? '')
  const [ownership, setOwnership] = useState(machine?.ownership ?? '')
  const [active, setActive] = useState(machine?.active ?? true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    const values = { name: name.trim(), ownership, active }
    if (!values.name) {
      setError('Enter a name for the equipment.')
      return
    }
    if (!values.ownership) {
      setError('Choose Own or Rented.')
      return
    }

    setError('')
    setBusy(true)
    const { data, error: saveError } = machine
      ? await supabase.from('equipment').update(values).eq('id', machine.id).select('id')
      : await supabase.from('equipment').insert(values).select('id')
    setBusy(false)

    if (saveError || data.length === 0) {
      setError('Could not save the equipment. Check your signal and try again.')
    } else {
      onDone(true)
    }
  }

  return (
    <form className="card" onSubmit={handleSubmit}>
      <h1>{machine ? 'Edit equipment' : 'Add equipment'}</h1>

      <label htmlFor="equipment-name">Name</label>
      <input
        id="equipment-name"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <ChoiceButtons
        label="Ownership"
        options={EQUIPMENT_OWNERSHIP_LABELS}
        value={ownership}
        onChange={setOwnership}
      />

      <ChoiceButtons
        label="Status"
        options={ACTIVE_OPTIONS}
        value={active ? 'yes' : 'no'}
        onChange={(choice) => setActive(choice === 'yes')}
      />

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? 'Saving…' : 'Save equipment'}
      </button>
      <button type="button" className="btn-secondary" onClick={() => onDone(false)}>
        Cancel
      </button>
    </form>
  )
}

export default EquipmentForm
