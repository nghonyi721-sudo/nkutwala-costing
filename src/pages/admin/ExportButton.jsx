import { useState } from 'react'
import { exportProjectCost } from '../../lib/exports/run'
import Button from '../../components/Button'
import { DownloadSimpleIcon } from '../../components/icons'

// Owner/admin: "Export" in a screen's navigation bar. Downloads the project
// cost report (Excel) for exactly that screen's project and period, so the
// file matches what's on screen.
//   projectId:   a project, or null for all projects
//   period:      { from, to }
//   onError(''): clear / show a problem on the screen
function ExportButton({ projectId, projectName, period, onError }) {
  const [busy, setBusy] = useState(false)

  async function run() {
    setBusy(true)
    onError('')
    try {
      const projects = projectId ? [{ id: projectId, name: projectName }] : null
      await exportProjectCost({ projects, from: period.from, to: period.to })
    } catch {
      onError('Could not export. Check your signal and try again.')
    }
    setBusy(false)
  }

  return (
    <Button variant="plain" inline icon={DownloadSimpleIcon} busy={busy} onClick={run}>
      {busy ? 'Exporting…' : 'Export'}
    </Button>
  )
}

export default ExportButton
