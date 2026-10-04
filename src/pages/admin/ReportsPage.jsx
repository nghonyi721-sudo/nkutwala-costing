import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatDate } from '../../lib/labels'
import DateTimeField from '../../components/DateTimeField'
import EmptyState from '../../components/EmptyState'
import { CalendarBlankIcon, ClipboardTextIcon, MapPinIcon } from '../../components/icons'
import Notice from '../../components/Notice'
import Page from '../../components/Page'
import { Row } from '../../components/Row'
import Section from '../../components/Section'
import { PickSheet } from '../../components/Sheet'
import Skeleton from '../../components/Skeleton'
import StatusBadge from '../../components/StatusBadge'
import ReportView from './ReportView'

const ALL_PROJECTS = 'all'

// Owner/admin: every report in the company, filterable by project and date.
function ReportsPage() {
  const [projects, setProjects] = useState([])
  const [projectFilter, setProjectFilter] = useState(ALL_PROJECTS)
  const [dateFilter, setDateFilter] = useState('')

  // undefined = loading, array = loaded
  const [reports, setReports] = useState(undefined)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState(null)
  const [reloadCount, setReloadCount] = useState(0)
  const [pickingProject, setPickingProject] = useState(false)

  useEffect(() => {
    supabase
      .from('projects')
      .select('id, name')
      .order('name')
      .then(({ data }) => setProjects(data ?? []))
  }, [])

  useEffect(() => {
    let cancelled = false

    let query = supabase
      .from('daily_reports')
      .select(
        'id, report_date, status, project:projects(name), reporter:profiles!daily_reports_reporter_id_fkey(full_name)',
      )
      .order('report_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200)
    if (projectFilter !== ALL_PROJECTS) query = query.eq('project_id', projectFilter)
    if (dateFilter) query = query.eq('report_date', dateFilter)

    query.then(({ data, error: loadError }) => {
      if (cancelled) return
      if (loadError) {
        setError('Could not load reports. Check your signal and try again.')
      } else {
        setError('')
        setReports(data)
      }
    })

    return () => {
      cancelled = true
    }
  }, [projectFilter, dateFilter, reloadCount])

  if (openId) {
    return (
      <ReportView
        reportId={openId}
        onBack={() => {
          setOpenId(null)
          setReloadCount((count) => count + 1)
        }}
      />
    )
  }

  const projectOptions = [
    { value: ALL_PROJECTS, title: 'All projects' },
    ...projects.map((p) => ({ value: p.id, title: p.name })),
  ]
  const projectLabel =
    projectOptions.find((option) => option.value === projectFilter)?.title ?? 'All projects'
  const filtered = projectFilter !== ALL_PROJECTS || dateFilter !== ''

  return (
    <Page
      title="Daily reports"
      subtitle={reports ? `${reports.length} report${reports.length === 1 ? '' : 's'} shown` : undefined}
    >
      <Section
        title="Filter"
        action={
          filtered
            ? {
                label: 'Clear',
                onClick: () => {
                  setProjectFilter(ALL_PROJECTS)
                  setDateFilter('')
                },
              }
            : undefined
        }
      >
        <Row
          icon={MapPinIcon}
          title="Project"
          trailing={projectLabel}
          chevron
          onClick={() => setPickingProject(true)}
        />
        <Row
          icon={CalendarBlankIcon}
          title="Date"
          trailing={
            <DateTimeField
              type="date"
              label="Filter by date"
              placeholder="Any date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
            />
          }
        />
      </Section>

      {error && <Notice tone="error">{error}</Notice>}

      {!error && reports === undefined && <Skeleton />}

      {reports?.length === 0 && (
        <EmptyState
          icon={ClipboardTextIcon}
          title={filtered ? 'No reports match' : 'No reports yet'}
          text={
            filtered
              ? 'Try another project or date.'
              : 'Reports appear here as site managers save them.'
          }
        />
      )}

      {reports?.length > 0 && (
        <Section title="Reports">
          {reports.map((report) => (
            <Row
              key={report.id}
              title={report.project?.name}
              subtitle={`${formatDate(report.report_date)} · ${report.reporter?.full_name ?? ''}`}
              mono
              trailing={<StatusBadge status={report.status} />}
              chevron
              onClick={() => setOpenId(report.id)}
            />
          ))}
        </Section>
      )}

      {pickingProject && (
        <PickSheet
          title="Project"
          options={projectOptions}
          selected={projectFilter}
          onPick={setProjectFilter}
          onClose={() => setPickingProject(false)}
        />
      )}
    </Page>
  )
}

export default ReportsPage
