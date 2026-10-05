import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { PROJECT_STATUS_LABELS } from '../../lib/labels'
import ActionBar from '../../components/ActionBar'
import Button from '../../components/Button'
import { CoinsIcon, HashIcon, MapPinIcon, UsersThreeIcon } from '../../components/icons'
import Page from '../../components/Page'
import { FieldRow, Row } from '../../components/Row'
import Section from '../../components/Section'
import SegmentedControl from '../../components/SegmentedControl'
import ProjectBudget from './ProjectBudget'
import ProjectTeam from './ProjectTeam'

// Add a project (project = null) or edit one. Projects are never deleted:
// mark them Complete instead. company_id is filled in by the database.
// An existing project also opens its Team and its Budget and costs.
function ProjectForm({ project, onDone }) {
  const [name, setName] = useState(project?.name ?? '')
  const [contractNumber, setContractNumber] = useState(project?.contract_number ?? '')
  const [status, setStatus] = useState(project?.status ?? 'active')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [showingBudget, setShowingBudget] = useState(false)
  const [showingTeam, setShowingTeam] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    const values = {
      name: name.trim(),
      contract_number: contractNumber.trim() || null,
      status,
    }
    if (!values.name) {
      setError('Enter a project name.')
      return
    }

    setError('')
    setBusy(true)
    const { data, error: saveError } = project
      ? await supabase.from('projects').update(values).eq('id', project.id).select('id')
      : await supabase.from('projects').insert(values).select('id')
    setBusy(false)

    if (saveError || data.length === 0) {
      setError('Could not save the project. Check your signal and try again.')
    } else {
      onDone(true)
    }
  }

  if (showingTeam) {
    return <ProjectTeam project={project} onBack={() => setShowingTeam(false)} />
  }

  if (showingBudget) {
    return <ProjectBudget project={project} onBack={() => setShowingBudget(false)} />
  }

  return (
    <Page
      title={project ? project.name : 'New project'}
      subtitle={project ? 'Edit project' : 'Add a project'}
      onBack={() => onDone(false)}
      backLabel="Projects"
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
          icon={MapPinIcon}
          label="Name"
          placeholder="Project name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <FieldRow
          icon={HashIcon}
          label="Contract no."
          placeholder="Optional"
          value={contractNumber}
          onChange={(e) => setContractNumber(e.target.value)}
        />
      </Section>

      {project && (
        <Section title="People">
          <Row
            icon={UsersThreeIcon}
            title="Team"
            subtitle="Who works on this project"
            chevron
            onClick={() => setShowingTeam(true)}
          />
        </Section>
      )}

      {project && (
        <Section title="Money">
          <Row
            icon={CoinsIcon}
            title="Budget and costs"
            subtitle="Budget, spent and unpriced hours"
            chevron
            onClick={() => setShowingBudget(true)}
          />
        </Section>
      )}

      <Section
        title="Status"
        plain
        footer="Projects are never deleted. Mark a finished project Complete."
      >
        <SegmentedControl
          label="Project status"
          options={PROJECT_STATUS_LABELS}
          value={status}
          onChange={setStatus}
        />
      </Section>
    </Page>
  )
}

export default ProjectForm
