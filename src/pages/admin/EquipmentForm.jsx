import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { EQUIPMENT_OWNERSHIP_LABELS } from '../../lib/labels'
import ActionBar from '../../components/ActionBar'
import Button from '../../components/Button'
import { BulldozerIcon, CheckCircleIcon, ReceiptIcon } from '../../components/icons'
import Page from '../../components/Page'
import { FieldRow, Row, SwitchRow } from '../../components/Row'
import Section from '../../components/Section'
import SegmentedControl from '../../components/SegmentedControl'
import HourlyRates from './HourlyRates'

// Add a machine (machine = null) or edit one. Equipment is never deleted:
// mark it Inactive instead. When editing OWNED equipment, its dated hourly
// rates are shown below (owners/admins only). Rented equipment has no rate:
// it is costed from its hire receipts.
//   backLabel: where Back goes (e.g. "Missing rates" when opened from there)
function EquipmentForm({ machine, onDone, backLabel = 'Equipment' }) {
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
      subtitle={machine ? 'Edit equipment and hourly rates' : 'Add a machine'}
      onBack={() => onDone(false)}
      backLabel={backLabel}
      footer={
        <ActionBar message={error} tone="error">
          <Button variant="secondary" onClick={() => onDone(false)}>
            Cancel
          </Button>
          {/* Linked to the details form below by its id, so the rates
              section can have its own separate form. */}
          <Button type="submit" form="equipment-details" busy={busy}>
            {busy ? 'Saving…' : machine ? 'Save details' : 'Save'}
          </Button>
        </ActionBar>
      }
    >
      <form id="equipment-details" onSubmit={handleSubmit}>
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
      </form>

      {machine?.ownership === 'own' && <HourlyRates kind="equipment" ownerId={machine.id} />}
      {machine?.ownership === 'rented' && (
        <Section title="Hourly rate">
          <Row
            icon={ReceiptIcon}
            title="No rate for rented equipment"
            subtitle="Its cost comes from the hire receipts (Plant hire). Its hours are kept as quantities only."
          />
        </Section>
      )}
    </Page>
  )
}

export default EquipmentForm
