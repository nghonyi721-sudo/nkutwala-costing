import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { RECEIPT_STATUS_LABELS, RECEIPT_STATUS_TONES, formatDate, formatRand } from '../../lib/labels'
import { RECEIPT_COLUMNS, fetchAmounts, sanityWarnings } from '../../lib/receipts'
import EmptyState from '../../components/EmptyState'
import { ClockIcon, MapPinIcon, ReceiptIcon, UserIcon, WarningIcon } from '../../components/icons'
import Notice from '../../components/Notice'
import Page from '../../components/Page'
import { Row } from '../../components/Row'
import Section from '../../components/Section'
import SegmentedControl from '../../components/SegmentedControl'
import { PickSheet } from '../../components/Sheet'
import Skeleton from '../../components/Skeleton'
import StatusBadge from '../../components/StatusBadge'
import ReceiptReview from './ReceiptReview'
import s from './ReceiptReview.module.css'

const ALL = 'all'
const VIEWS = { pending: 'Pending', history: 'History' }
const STATUS_ORDER = ['submitted', 'approved', 'rejected', 'reversed', 'draft', 'discarded']

const LIST_SELECT = `${RECEIPT_COLUMNS}, project:projects(name, status), uploader:profiles!receipts_uploader_id_fkey(full_name)`

// Owner/admin: receipts waiting for approval (oldest first), and the full
// history, filterable by status, project and person. Amounts come from the
// owner-only receipt_amounts view.
//   onChanged: a receipt was approved/rejected/reversed (updates the badge)
function ReceiptsPage({ user, role, onChanged }) {
  const [view, setView] = useState('pending')
  const [projects, setProjects] = useState([])
  const [people, setPeople] = useState([])
  const [statusFilter, setStatusFilter] = useState(ALL)
  const [projectFilter, setProjectFilter] = useState(ALL)
  const [personFilter, setPersonFilter] = useState(ALL)
  const [picking, setPicking] = useState(null) // 'status' | 'project' | 'person'

  // undefined = loading, array = loaded
  const [receipts, setReceipts] = useState(undefined)
  const [amounts, setAmounts] = useState({})
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState(null)
  const [reloadCount, setReloadCount] = useState(0)

  useEffect(() => {
    Promise.all([
      supabase.from('projects').select('id, name').order('name'),
      supabase.from('profiles').select('id, full_name').order('full_name'),
    ]).then(([projectsResult, peopleResult]) => {
      setProjects(projectsResult.data ?? [])
      setPeople(peopleResult.data ?? [])
    })
  }, [])

  useEffect(() => {
    let cancelled = false

    let query = supabase.from('receipts').select(LIST_SELECT)
    if (view === 'pending') {
      query = query.eq('status', 'submitted').order('created_at', { ascending: true })
    } else {
      query = query.order('created_at', { ascending: false }).limit(200)
      if (statusFilter !== ALL) query = query.eq('status', statusFilter)
      if (projectFilter !== ALL) query = query.eq('project_id', projectFilter)
      if (personFilter !== ALL) query = query.eq('uploader_id', personFilter)
    }

    query
      .then(async ({ data, error: loadError }) => {
        if (loadError) throw loadError
        const amountsById = await fetchAmounts(data.map((receipt) => receipt.id))
        if (cancelled) return
        setError('')
        setReceipts(data)
        setAmounts(amountsById)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load receipts. Check your signal and try again.')
      })

    return () => {
      cancelled = true
    }
  }, [view, statusFilter, projectFilter, personFilter, reloadCount])

  if (openId) {
    return (
      <ReceiptReview
        receiptId={openId}
        user={user}
        role={role}
        backLabel={VIEWS[view]}
        onChanged={onChanged}
        onBack={() => {
          setOpenId(null)
          setReloadCount((count) => count + 1)
        }}
      />
    )
  }

  const statusOptions = [
    { value: ALL, title: 'All statuses' },
    ...STATUS_ORDER.map((status) => ({ value: status, title: RECEIPT_STATUS_LABELS[status] })),
  ]
  const projectOptions = [{ value: ALL, title: 'All projects' }, ...projects.map((p) => ({ value: p.id, title: p.name }))]
  const personOptions = [{ value: ALL, title: 'Everyone' }, ...people.map((p) => ({ value: p.id, title: p.full_name }))]
  const titleOf = (options, value) => options.find((option) => option.value === value)?.title
  const filtered = statusFilter !== ALL || projectFilter !== ALL || personFilter !== ALL

  const total = (receipts ?? []).reduce((sum, receipt) => sum + (amounts[receipt.id] ?? 0), 0)
  let subtitle
  if (receipts && view === 'pending') {
    subtitle = receipts.length === 0 ? 'Nothing waiting' : `${receipts.length} waiting · ${formatRand(total)} incl. VAT`
  } else if (receipts) {
    subtitle = `${receipts.length} receipt${receipts.length === 1 ? '' : 's'} shown`
  }

  return (
    <Page title="Receipts" subtitle={subtitle}>
      <Section plain>
        <SegmentedControl
          label="Show"
          options={VIEWS}
          value={view}
          onChange={(next) => {
            setReceipts(undefined)
            setView(next)
          }}
        />
      </Section>

      {view === 'history' && (
        <Section
          title="Filter"
          action={
            filtered
              ? {
                  label: 'Clear',
                  onClick: () => {
                    setStatusFilter(ALL)
                    setProjectFilter(ALL)
                    setPersonFilter(ALL)
                  },
                }
              : undefined
          }
        >
          <Row
            icon={ClockIcon}
            title="Status"
            trailing={titleOf(statusOptions, statusFilter)}
            chevron
            onClick={() => setPicking('status')}
          />
          <Row
            icon={MapPinIcon}
            title="Project"
            trailing={titleOf(projectOptions, projectFilter)}
            chevron
            onClick={() => setPicking('project')}
          />
          <Row
            icon={UserIcon}
            title="Taken by"
            trailing={titleOf(personOptions, personFilter)}
            chevron
            onClick={() => setPicking('person')}
          />
        </Section>
      )}

      {error && <Notice tone="error">{error}</Notice>}
      {!error && receipts === undefined && <Skeleton />}

      {receipts?.length === 0 && (
        <EmptyState
          icon={ReceiptIcon}
          title={view === 'pending' ? 'All caught up' : filtered ? 'No receipts match' : 'No receipts yet'}
          text={
            view === 'pending'
              ? 'Receipts appear here when site managers send them in.'
              : filtered
                ? 'Try another status, project or person.'
                : 'Receipts appear here as site managers photograph them.'
          }
        />
      )}

      {receipts?.length > 0 && (
        <Section title={view === 'pending' ? 'Oldest first' : 'Newest first'}>
          {receipts.map((receipt) => {
            const amount = amounts[receipt.id]
            const warnings = view === 'pending' ? sanityWarnings(receipt, amount) : []
            return (
              <Row
                key={receipt.id}
                icon={warnings.length > 0 ? WarningIcon : ReceiptIcon}
                iconTone={warnings.length > 0 ? 'red' : 'blue'}
                title={receipt.vendor}
                subtitle={
                  <>
                    {formatDate(receipt.receipt_date)} · {receipt.uploader?.full_name}
                    <span className={s.line}>{receipt.project?.name}</span>
                  </>
                }
                mono
                trailing={
                  <span className={s.trail}>
                    <span className={s.trailAmount}>{amount === undefined ? '–' : formatRand(amount)}</span>
                    {view === 'history' && (
                      <StatusBadge
                        status={receipt.status}
                        label={RECEIPT_STATUS_LABELS[receipt.status]}
                        tone={RECEIPT_STATUS_TONES[receipt.status]}
                      />
                    )}
                  </span>
                }
                chevron
                onClick={() => setOpenId(receipt.id)}
              />
            )
          })}
        </Section>
      )}

      {picking === 'status' && (
        <PickSheet
          title="Status"
          options={statusOptions}
          selected={statusFilter}
          onPick={setStatusFilter}
          onClose={() => setPicking(null)}
        />
      )}
      {picking === 'project' && (
        <PickSheet
          title="Project"
          options={projectOptions}
          selected={projectFilter}
          onPick={setProjectFilter}
          onClose={() => setPicking(null)}
        />
      )}
      {picking === 'person' && (
        <PickSheet
          title="Taken by"
          options={personOptions}
          selected={personFilter}
          onPick={setPersonFilter}
          onClose={() => setPicking(null)}
        />
      )}
    </Page>
  )
}

export default ReceiptsPage
