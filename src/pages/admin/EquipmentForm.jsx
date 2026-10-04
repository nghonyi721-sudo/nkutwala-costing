import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { EQUIPMENT_OWNERSHIP_LABELS } from '../../lib/labels'
import ActionBar from '../../components/ActionBar'
import Button from '../../components/Button'
import { BulldozerIcon, CheckCircleIcon } from '../../components/icons'
import Page from '../../components/Page'
import { FieldRow, SwitchRow } from '../../components/Row'
import Section from '../../components/Section'
import SegmentedControl from '../../components/SegmentedControl'

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
    <Page
      title={machine ? machine.name : 'New equipment'}
      subtitle={machine ? 'Edit equipment' : 'Add a machine'}
      onBack={() => onDone(false)}
      backLabel="Equipment"
      onSubmit={handleSubmit}
      footer={
        <ActionBar message={error} tone="error">
          <Button variant="secondary" onClick={() => onDone(false)}>
            Cancel
          </Button>
          <Button type="submit" busy={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </ActionBar>
      }
    >
      <Section title="Details">
        <FieldRow
          icon={BulldozerIcon}
          label="Name"
          placeholder="e.g. CAT 320 excavator"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Section>

      <Section title="Ownership" plain>
        <SegmentedControl
          label="Ownership"
          options={EQUIPMENT_OWNERSHIP_LABELS}
          value={ownership}
          onChange={setOwnership}
        />
      </Section>

      <Section footer="Equipment is never deleted. Switch it off when it leaves site.">
        <SwitchRow icon={CheckCircleIcon} title="Active" checked={active} onChange={setActive} />
      </Section>
    </Page>
  )
}

export default EquipmentForm
