import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { EMPLOYEE_COLUMNS, assignToProject, fetchTeam, removeFromProject } from '../../lib/employeeSteps'
import { EMPLOYEE_CATEGORY_LABELS } from '../../lib/labels'
import ConfirmSheet from '../../components/ConfirmSheet'
import { MinusCircleIcon, UserPlusIcon } from '../../components/icons'
import Notice from '../../components/Notice'
import Page from '../../components/Page'
import { Row } from '../../components/Row'
import Section from '../../components/Section'
import { PickSheet } from '../../components/Sheet'
import Skeleton from '../../components/Skeleton'
import StatusBadge from '../../components/StatusBadge'
// The same red remove button as on the daily report's crew list.
import s from '../reports/ReportForm.module.css'

// Owner/admin: who works on a project. Each new daily report for the project
// starts with this team. People are never deleted from it, only taken off.
// No money here.
function ProjectTeam({ project, onBack }) {
  // undefined = loading, array = loaded
  const [team, setTeam] = useState(undefined)
  const [everyone, setEveryone] = useState([])
  const [loadError, setLoadError] = useState('')
  const [reloadCount, setReloadCount] = useState(0)
  const [actionError, setActionError] = useState('')
  const [adding, setAdding] = useState(false)
  const [editingTeam, setEditingTeam] = useState(false)
  const [removing, setRemoving] = useState(null)
  const [removeBusy, setRemoveBusy] = useState(false)

  useEffect(() => {
    let cancelled = false

    Promise.all([
      fetchTeam(supabase, project.id),
      supabase.from('employees').select(EMPLOYEE_COLUMNS).neq('status', 'inactive').order('full_name'),
    ])
      .then(([members, everyoneResult]) => {
        if (cancelled) return
        if (everyoneResult.error) throw everyoneResult.error
        setLoadError('')
        setTeam(members)
        setEveryone(everyoneResult.data)
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load the team. Check your signal and try again.')
      })

    return () => {
      cancelled = true
    }
  }, [project.id, reloadCount])

  async function add(employeeId) {
    setActionError('')
    try {
      await assignToProject(supabase, project.id, employeeId)
      setReloadCount((count) => count + 1)
    } catch {
      setActionError('Could not add them. Check your signal and try again.')
    }
  }

  async function remove(person) {
    setRemoveBusy(true)
    setActionError('')
    try {
      await removeFromProject(supabase, project.id, person.id)
      setReloadCount((count) => count + 1)
    } catch {
      setActionError('Could not take them off the team. Check your signal and try again.')
    }
    setRemoveBusy(false)
    setRemoving(null)
  }

  const onTeam = new Set((team ?? []).map((person) => person.id))
  const available = everyone.filter((person) => !onTeam.has(person.id))

  return (
    <Page title="Team" subtitle={project.name} onBack={onBack} backLabel="Project">
      {loadError && <Notice tone="error">{loadError}</Notice>}
      {actionError && <Notice tone="error">{actionError}</Notice>}
      {!loadError && team === undefined && <Skeleton rows={3} />}

      {team && (
        <Section
          title={`People · ${team.length}`}
          action={
            team.length > 0
              ? { label: editingTeam ? 'Done' : 'Edit', onClick: () => setEditingTeam((on) => !on) }
              : undefined
          }
          footer="Every new daily report for this project starts with these people. Site managers can add people too."
        >
          {team.map((person) => (
            <Row
              key={person.id}
              leading={
                editingTeam ? (
                  <button
                    type="button"
                    className={s.remove}
                    aria-label={`Remove ${person.full_name} from the team`}
                    onClick={() => setRemoving(person)}
                  >
                    <MinusCircleIcon size={28} weight="fill" />
                  </button>
                ) : undefined
              }
              title={person.full_name}
              subtitle={EMPLOYEE_CATEGORY_LABELS[person.category]}
              trailing={person.status === 'pending' ? <StatusBadge status="pending" label="Pending" /> : undefined}
            />
          ))}
          <Row icon={UserPlusIcon} tone="accent" title="Add people" onClick={() => setAdding(true)} />
        </Section>
      )}

      {adding && (
        <PickSheet
          title="Add people"
          hint="Tap everyone who works on this project."
          mode="add"
          options={available.map((person) => ({
            value: person.id,
            title: person.full_name,
            subtitle:
              EMPLOYEE_CATEGORY_LABELS[person.category] + (person.status === 'pending' ? ' · Pending' : ''),
          }))}
          emptyText="Everyone is already on the team."
          onPick={add}
          onClose={() => setAdding(false)}
        />
      )}

      {removing && (
        <ConfirmSheet
          title={`Remove ${removing.full_name} from the team?`}
          message="They won't be loaded onto this project's next daily reports. Reports already made don't change."
          actionLabel={removeBusy ? 'Removing…' : 'Remove from team'}
          destructive
          busy={removeBusy}
          onConfirm={() => remove(removing)}
          onCancel={() => setRemoving(null)}
        />
      )}
    </Page>
  )
}

export default ProjectTeam
