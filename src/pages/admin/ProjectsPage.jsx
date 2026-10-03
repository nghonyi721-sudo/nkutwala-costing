import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { PROJECT_STATUS_LABELS } from '../../lib/labels'
import ProjectForm from './ProjectForm'

// Owner/admin: list of projects. Tap one to edit, or add a new one.
function ProjectsPage({ onBack }) {
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
      <button type="button" className="btn-secondary btn-back" onClick={onBack}>
        ← Back
      </button>
      <h1>Projects</h1>

      <button type="button" className="btn-primary" onClick={() => setEditing('new')}>
        + Add project
      </button>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {!error && projects === undefined && <p className="loading">Loading…</p>}

      {projects?.length === 0 && <p>No projects yet.</p>}

      {projects?.length > 0 && (
        <ul className="list">
          {projects.map((project) => (
            <li key={project.id}>
              <button
                type="button"
                className={`list-item${project.status === 'complete' ? ' inactive' : ''}`}
                onClick={() => setEditing(project)}
              >
                <span className="list-title">{project.name}</span>
                <span className="list-detail">
                  {project.contract_number ? `${project.contract_number} · ` : ''}
                  {PROJECT_STATUS_LABELS[project.status]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default ProjectsPage
