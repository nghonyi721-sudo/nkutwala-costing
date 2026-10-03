import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { PROJECT_STATUS_LABELS } from '../../lib/labels'
import ChoiceButtons from '../../components/ChoiceButtons'

// Add a project (project = null) or edit one. Projects are never deleted:
// mark them Complete instead. company_id is filled in by the database.
function ProjectForm({ project, onDone }) {
  const [name, setName] = useState(project?.name ?? '')
  const [contractNumber, setContractNumber] = useState(project?.contract_number ?? '')
  const [status, setStatus] = useState(project?.status ?? 'active')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

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

  return (
    <form className="card" onSubmit={handleSubmit}>
      <h1>{project ? 'Edit project' : 'Add project'}</h1>

      <label htmlFor="project-name">Project name</label>
      <input
        id="project-name"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <label htmlFor="contract-number">Contract number (optional)</label>
      <input
        id="contract-number"
        value={contractNumber}
        onChange={(e) => setContractNumber(e.target.value)}
      />

      <ChoiceButtons
        label="Status"
        options={PROJECT_STATUS_LABELS}
        value={status}
        onChange={setStatus}
      />

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? 'Saving…' : 'Save project'}
      </button>
      <button type="button" className="btn-secondary" onClick={() => onDone(false)}>
        Cancel
      </button>
    </form>
  )
}

export default ProjectForm
