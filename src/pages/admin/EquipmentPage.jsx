import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { EQUIPMENT_OWNERSHIP_LABELS } from '../../lib/labels'
import Button from '../../components/Button'
import EmptyState from '../../components/EmptyState'
import { BulldozerIcon, PlusIcon } from '../../components/icons'
import Notice from '../../components/Notice'
import Page from '../../components/Page'
import { Row } from '../../components/Row'
import Section from '../../components/Section'
import Skeleton from '../../components/Skeleton'
import StatusBadge from '../../components/StatusBadge'
import EquipmentForm from './EquipmentForm'

// Owner/admin: list of equipment. Tap one to edit, or add a new one.
function EquipmentPage() {
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
    <Page
      title="Equipment"
      subtitle={
        machines ? `${machines.filter((m) => m.active).length} active of ${machines.length}` : undefined
      }
      action={
        <Button variant="plain" inline icon={PlusIcon} onClick={() => setEditing('new')}>
          Add
        </Button>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}

      {!error && machines === undefined && <Skeleton />}

      {machines?.length === 0 && (
        <EmptyState
          icon={BulldozerIcon}
          title="No equipment yet"
          text="Add the machines used on site so they can go on daily reports."
          action={<Button onClick={() => setEditing('new')}>Add equipment</Button>}
        />
      )}

      {machines?.length > 0 && (
        <Section>
          {machines.map((machine) => (
            <Row
              key={machine.id}
              title={machine.name}
              subtitle={EQUIPMENT_OWNERSHIP_LABELS[machine.ownership]}
              trailing={machine.active ? null : <StatusBadge status="inactive" label="Inactive" />}
              chevron
              onClick={() => setEditing(machine)}
            />
          ))}
        </Section>
      )}
    </Page>
  )
}

export default EquipmentPage
