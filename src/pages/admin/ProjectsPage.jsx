import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { PROJECT_STATUS_LABELS } from '../../lib/labels'
import Button from '../../components/Button'
import EmptyState from '../../components/EmptyState'
import { MapPinIcon, PlusIcon } from '../../components/icons'
import Notice from '../../components/Notice'
import Page from '../../components/Page'
import { Row } from '../../components/Row'
import Section from '../../components/Section'
import Skeleton from '../../components/Skeleton'
import StatusBadge from '../../components/StatusBadge'
import ProjectForm from './ProjectForm'

// Owner/admin: list of projects. Tap one to edit, or add a new one.
function ProjectsPage() {
  // undefined = loading, array = loaded
  const [projects, setProjects] = useState(undefined)
  const [error, setError] = useState('')
  // null = show the list, 'new' = add form, a project = edit form
  const [editing, setEditing] = useState(null)
  const [reloadCount, setReloadCount] = useState(0)

  useEffect(() => {
    let cancelled = false

    supabase
      .from('projects')
      .select('id, name, contract_number, status')
      .order('name')
      .then(({ data, error: loadError }) => {
        if (cancelled) return
        if (loadError) {
          setError('Could not load projects. Check your signal and try again.')
        } else {
          setError('')
          setProjects(data)
        }
      })

    return () => {
      cancelled = true
    }
  }, [reloadCount])

  if (editing) {
    return (
      <ProjectForm
        project={editing === 'new' ? null : editing}
        onDone={(saved) => {
          setEditing(null)
          if (saved) setReloadCount((count) => count + 1)
        }}
      />
    )
  }

  return (
    <Page
      title="Projects"
      subtitle={projects ? `${projects.length} project${projects.length === 1 ? '' : 's'}` : undefined}
      action={
        <Button variant="plain" inline icon={PlusIcon} onClick={() => setEditing('new')}>
          Add
        </Button>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}

      {!error && projects === undefined && <Skeleton />}

      {projects?.length === 0 && (
        <EmptyState
          icon={MapPinIcon}
          title="No projects yet"
          text="Add a project so site managers can report on it."
          action={<Button onClick={() => setEditing('new')}>Add project</Button>}
        />
      )}

      {projects?.length > 0 && (
        <Section>
          {projects.map((project) => (
            <Row
              key={project.id}
              title={project.name}
              subtitle={project.contract_number}
              mono
              trailing={
                <StatusBadge status={project.status} label={PROJECT_STATUS_LABELS[project.status]} />
              }
              chevron
              onClick={() => setEditing(project)}
            />
          ))}
        </Section>
      )}
    </Page>
  )
}

export default ProjectsPage
