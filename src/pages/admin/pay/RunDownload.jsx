import { useEffect, useState } from 'react'
import { fetchRunProjects } from '../../../lib/payRuns'
import { exportPayRun } from '../../../lib/exports/run'
import Button from '../../../components/Button'
import { DownloadSimpleIcon, MapPinIcon } from '../../../components/icons'
import Notice from '../../../components/Notice'
import { Row } from '../../../components/Row'
import Section from '../../../components/Section'
import { PickSheet } from '../../../components/Sheet'

const ALL = 'all'

// "Download pay run (Excel)" for one version of a period, with its Projects
// filter (the projects in that run). All projects = the full pay;
// chosen projects = a labour cost allocation, never the amount to pay.
//   period: { id, start_date, end_date }; run: a row of pay_run_versions
function RunDownload({ period, run }) {
  // undefined = loading; [] = no project split saved for this version
  const [projects, setProjects] = useState(undefined)
  const [chosen, setChosen] = useState([])
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState({ tone: 'info', text: '' })

  useEffect(() => {
    let cancelled = false
    fetchRunProjects(run.run_id)
      .then((list) => {
        if (!cancelled) setProjects(list)
      })
      .catch(() => {
        if (!cancelled) setProjects([])
      })
    return () => {
      cancelled = true
    }
  }, [run.run_id])

  const picked = (projects ?? []).filter((project) => chosen.includes(project.id))
  const filterText = picked.length === 0 ? 'All projects' : picked.length === 1 ? picked[0].name : `${picked.length} projects`

  function toggle(value) {
    if (value === ALL) setChosen([])
    else setChosen((ids) => (ids.includes(value) ? ids.filter((id) => id !== value) : [...ids, value]))
  }

  async function download() {
    setMessage({ tone: 'info', text: '' })
    setBusy(true)
    try {
      await exportPayRun({ period, run, projects: picked.length ? picked : null })
      setMessage({ tone: 'info', text: `Saved: pay run version ${run.version}, ${filterText}.` })
    } catch {
      setMessage({ tone: 'error', text: 'Could not export. Check your signal and try again.' })
    }
    setBusy(false)
  }

  return (
    <>
      <Section
        title="Pay run (Excel)"
        footer={
          projects?.length === 0
            ? 'All projects only: this version was closed before project splits were saved.'
            : 'All projects: the full pay, gross before deductions - not a payslip. Pay only from All projects.'
        }
      >
        {projects?.length > 0 && (
          <Row icon={MapPinIcon} title="Projects" trailing={filterText} chevron onClick={() => setPicking(true)} />
        )}
      </Section>
      {picked.length > 0 && (
        <Notice tone="error">Project labour cost allocation - NOT the amount to pay employees. Pay only from All projects.</Notice>
      )}
      {message.text && <Notice tone={message.tone}>{message.text}</Notice>}
      <Section plain>
        <Button variant="secondary" icon={DownloadSimpleIcon} busy={busy} disabled={projects === undefined} onClick={download}>
          {busy ? 'Exporting…' : 'Download pay run (Excel)'}
        </Button>
      </Section>

      {picking && (
        <PickSheet
          title="Projects"
          hint="Tick one or more projects - or All projects."
          mode="multi"
          options={[{ value: ALL, title: 'All projects' }, ...projects.map((project) => ({ value: project.id, title: project.name }))]}
          selected={chosen.length ? chosen : [ALL]}
          onPick={toggle}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  )
}

export default RunDownload
