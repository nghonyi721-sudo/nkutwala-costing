import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { PROJECT_STATUS_LABELS } from '../../lib/labels'
import Button from '../../components/Button'
import StatusTag from '../../components/StatusTag'
import ListRow from '../../components/ListRow'
import PageHeader from '../../components/PageHeader'
import Skeleton from '../../components/Skeleton'
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
    <div className="card">
      <PageHeader
        eyebrow="Setup"
        title="Projects"
        meta={projects ? `${projects.length} project${projects.length === 1 ? '' : 's'}` : null}
      />

      <Button onClick={() => setEditing('new')}>Add project</Button>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {!error && projects === undefined && <Skeleton />}

      {projects?.length === 0 && <p className="label">No projects yet.</p>}

      {projects?.length > 0 && (
        <ul className="list">
          {projects.map((project) => (
            <li key={project.id}>
              <ListRow
                title={project.name}
                detail={project.contract_number}
                mono
                muted={project.status === 'complete'}
                tag={<StatusTag status={project.status} label={PROJECT_STATUS_LABELS[project.status]} />}
                onClick={() => setEditing(project)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default ProjectsPage
