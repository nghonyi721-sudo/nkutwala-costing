import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import {
  RECEIPT_CATEGORY_LABELS,
  RECEIPT_STATUS_LABELS,
  RECEIPT_STATUS_TONES,
  formatDate,
  formatDateTime,
  formatRand,
} from '../../lib/labels'
import { RECEIPT_COLUMNS, fetchAmounts, receiptErrorMessage, sanityWarnings } from '../../lib/receipts'
import ActionBar from '../../components/ActionBar'
import Button from '../../components/Button'
import ConfirmSheet from '../../components/ConfirmSheet'
import {
  ArrowCounterClockwiseIcon,
  CalendarBlankIcon,
  CheckCircleIcon,
  ClockIcon,
  CopyIcon,
  MapPinIcon,
  NotePencilIcon,
  ReceiptIcon,
  StorefrontIcon,
  TagIcon,
  UserIcon,
  XCircleIcon,
} from '../../components/icons'
import Notice from '../../components/Notice'
import Page from '../../components/Page'
import PhotoViewer from '../../components/PhotoViewer'
import ReceiptHistory from '../../components/ReceiptHistory'
import ReceiptPhoto from '../../components/ReceiptPhoto'
import { FieldRow, Row, SwitchRow } from '../../components/Row'
import Section from '../../components/Section'
import Sheet, { SheetGroup } from '../../components/Sheet'
import Skeleton from '../../components/Skeleton'
import StatusBadge from '../../components/StatusBadge'
import SummaryCard from '../../components/SummaryCard'
import s from './ReceiptReview.module.css'

const DETAIL_SELECT = `${RECEIPT_COLUMNS},
  project:projects(name, status),
  uploader:profiles!receipts_uploader_id_fkey(full_name),
  reviewer:profiles!receipts_reviewed_by_fkey(full_name)`

const MATCH_SELECT = `id, image_path, vendor, receipt_date, status,
  uploader:profiles!receipts_uploader_id_fkey(full_name)`

const statusBadge = (receipt) => (
  <StatusBadge
    status={receipt.status}
    label={RECEIPT_STATUS_LABELS[receipt.status]}
    tone={RECEIPT_STATUS_TONES[receipt.status]}
  />
)

// Owner/admin: one receipt - the photo beside the typed details, warnings,
// possible duplicates side by side, and the status log.
//   submitted: Approve (never your own; a possible duplicate needs the
//              "checked" tick first) or Reject with a reason
//   approved:  system admins can Reverse it, with a reason
// The database enforces every one of these rules; the screen just follows.
function ReceiptReview({ receiptId, user, role, backLabel, onBack, onChanged }) {
  // undefined = loading, null = not found, object = loaded
  const [receipt, setReceipt] = useState(undefined)
  const [amount, setAmount] = useState(null)
  const [log, setLog] = useState([])
  const [matches, setMatches] = useState([]) // [{ ...match, receipt, amount }]
  const [loadError, setLoadError] = useState('')
  const [reloadCount, setReloadCount] = useState(0)
  const [viewing, setViewing] = useState(null) // { src, alt }

  const [checked, setChecked] = useState(false)
  const [action, setAction] = useState(null) // null | 'approve' | 'reject' | 'reverse'
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function load() {
      const [receiptResult, logResult, duplicatesResult, amountsById] = await Promise.all([
        supabase.from('receipts').select(DETAIL_SELECT).eq('id', receiptId).maybeSingle(),
        supabase
          .from('receipt_status_log')
          .select('id, to_status, reason, changed_at, changer:profiles(full_name)')
          .eq('receipt_id', receiptId)
          .order('changed_at'),
        supabase.rpc('receipt_duplicates', { p_receipt_id: receiptId }),
        fetchAmounts([receiptId]),
      ])
      const failed = receiptResult.error || logResult.error || duplicatesResult.error
      if (failed) throw failed

      // The matching receipts, with their photos and amounts.
      const found = duplicatesResult.data
      let details = []
      let matchAmounts = {}
      if (found.length > 0) {
        const ids = found.map((match) => match.receipt_id)
        const [matchResult, amountsResult] = await Promise.all([
          supabase.from('receipts').select(MATCH_SELECT).in('id', ids),
          fetchAmounts(ids),
        ])
        if (matchResult.error) throw matchResult.error
        details = matchResult.data
        matchAmounts = amountsResult
      }

      if (cancelled) return
      setLoadError('')
      setReceipt(receiptResult.data)
      setAmount(amountsById[receiptId] ?? null)
      setLog(logResult.data)
      setMatches(
        found.map((match) => ({
          ...match,
          receipt: details.find((d) => d.id === match.receipt_id),
          amount: matchAmounts[match.receipt_id],
        })),
      )
    }

    load().catch(() => {
      if (!cancelled) setLoadError('Could not load the receipt. Check your signal and try again.')
    })

    return () => {
      cancelled = true
    }
  }, [receiptId, reloadCount])

  function startAction(next) {
    setActionError('')
    setReason('')
    setAction(next)
  }

  async function finishAction() {
    const changes =
      action === 'approve'
        ? { status: 'approved', ...(matches.length > 0 ? { duplicate_checked: true } : {}) }
        : { status: action === 'reject' ? 'rejected' : 'reversed', review_reason: reason.trim() }
    if (action !== 'approve' && !reason.trim()) {
      setActionError(`Enter a reason for ${action === 'reject' ? 'rejecting' : 'reversing'} it.`)
      return
    }

    setActionError('')
    setBusy(true)
    const { data, error } = await supabase
      .from('receipts')
      .update(changes)
      .eq('id', receiptId)
      .eq('status', action === 'reverse' ? 'approved' : 'submitted')
      .select('id')
    setBusy(false)

    if (error || data.length === 0) {
      setActionError(
        error
          ? receiptErrorMessage(error, 'Could not save. Check your signal and try again.')
          : 'Someone else has already dealt with this receipt.',
      )
      return
    }
    setAction(null)
    setChecked(false)
    onChanged?.()
    setReloadCount((count) => count + 1)
  }

  const isOwn = receipt?.uploader_id === user.id
  const needsTick = matches.length > 0 && !checked
  const warnings = receipt ? sanityWarnings(receipt, amount) : []

  let footer
  if (receipt?.status === 'submitted') {
    let note = actionError
    if (!note && isOwn) note = 'You took this receipt, so someone else must approve it.'
    else if (!note && needsTick) note = 'Possible duplicate: tick “I’ve checked - not a duplicate” first.'
    footer = (
      <ActionBar message={note} tone={actionError ? 'error' : 'info'}>
        <Button variant="danger" icon={XCircleIcon} onClick={() => startAction('reject')}>
          Reject
        </Button>
        <Button icon={CheckCircleIcon} disabled={isOwn || needsTick} onClick={() => startAction('approve')}>
          Approve
        </Button>
      </ActionBar>
    )
  } else if (receipt?.status === 'approved' && role === 'system_admin') {
    footer = (
      <ActionBar message={actionError} tone="error">
        <Button variant="danger" icon={ArrowCounterClockwiseIcon} onClick={() => startAction('reverse')}>
          Reverse receipt
        </Button>
      </ActionBar>
    )
  }

  const openPhoto = (alt) => (src) => setViewing({ src, alt })

  return (
    <Page
      title={receipt?.vendor ?? 'Receipt'}
      subtitle={
        receipt ? `${formatDate(receipt.receipt_date)} · ${receipt.uploader?.full_name ?? ''}` : undefined
      }
      onBack={onBack}
      backLabel={backLabel}
      footer={footer}
    >
      {loadError && <Notice tone="error">{loadError}</Notice>}
      {!loadError && receipt === undefined && <Skeleton rows={4} />}
      {receipt === null && <Notice tone="error">Receipt not found.</Notice>}

      {receipt && (
        <div className={s.layout}>
          <div className={s.photoColumn}>
            <ReceiptPhoto
              path={receipt.image_path}
              alt={`Receipt from ${receipt.vendor}`}
              onOpen={openPhoto(`Receipt from ${receipt.vendor}`)}
            />
          </div>

          <div className={s.detailsColumn}>
            <SummaryCard
              icon={ReceiptIcon}
              label="Amount (incl. VAT)"
              meta={statusBadge(receipt)}
              value={amount === null ? '–' : formatRand(amount)}
            />

            {receipt.status === 'draft' && (
              <Notice tone="info">Not sent yet - the site manager hasn't finished sending it.</Notice>
            )}
            {['rejected', 'reversed'].includes(receipt.status) && (
              <Notice tone="error">
                {RECEIPT_STATUS_LABELS[receipt.status]}
                {receipt.reviewer?.full_name ? ` by ${receipt.reviewer.full_name}` : ''}: {receipt.review_reason}
              </Notice>
            )}
            {receipt.status === 'approved' && (
              <Notice tone="success">
                Approved{receipt.reviewer?.full_name ? ` by ${receipt.reviewer.full_name}` : ''}
                {receipt.reviewed_at ? `, ${formatDateTime(receipt.reviewed_at)}` : ''}. It counts as a cost.
              </Notice>
            )}
            {warnings.length > 0 && (
              <Notice tone="error">
                {warnings.map((warning) => (
                  <span key={warning} className={s.warning}>
                    {warning}
                  </span>
                ))}
              </Notice>
            )}

            <Section title="Details">
              <Row icon={StorefrontIcon} title="Vendor" trailing={receipt.vendor} />
              <Row icon={TagIcon} title="Category" trailing={RECEIPT_CATEGORY_LABELS[receipt.category]} />
              <Row icon={CalendarBlankIcon} title="Date" trailing={formatDate(receipt.receipt_date)} />
              <Row icon={MapPinIcon} title="Project" trailing={receipt.project?.name} />
              <Row icon={UserIcon} title="Taken by" trailing={receipt.uploader?.full_name} />
              <Row icon={ClockIcon} title="Sent in" trailing={formatDateTime(receipt.created_at)} />
              {receipt.notes && <Row icon={NotePencilIcon} title="Notes" subtitle={receipt.notes} />}
            </Section>
          </div>
        </div>
      )}

      {receipt && matches.length > 0 && (
        <Section
          title="Possible duplicate"
          footer="Approving a duplicate would count the same spend twice. Compare the photos and amounts."
        >
          {matches.map((match) => (
            <div key={match.receipt_id} className={s.compare}>
              <p className={s.compareReason}>
                <CopyIcon size={18} weight="bold" aria-hidden="true" />
                {match.same_photo ? 'The same photo' : 'Same vendor, amount and date'}
              </p>
              <div className={s.compareGrid}>
                <figure className={s.compareSide}>
                  <ReceiptPhoto
                    path={receipt.image_path}
                    alt={`This receipt, from ${receipt.vendor}`}
                    size="thumb"
                    onOpen={openPhoto(`This receipt, from ${receipt.vendor}`)}
                  />
                  <figcaption>
                    <strong>This receipt</strong>
                    <span className="num">{amount === null ? '–' : formatRand(amount)}</span>
                    <span>{formatDate(receipt.receipt_date)}</span>
                    <span>{receipt.uploader?.full_name}</span>
                  </figcaption>
                </figure>
                <figure className={s.compareSide}>
                  <ReceiptPhoto
                    path={match.receipt?.image_path}
                    alt={`Earlier receipt, from ${match.vendor}`}
                    size="thumb"
                    onOpen={openPhoto(`Earlier receipt, from ${match.vendor}`)}
                  />
                  <figcaption>
                    <strong>{match.vendor}</strong>
                    <span className="num">{match.amount === undefined ? '–' : formatRand(match.amount)}</span>
                    <span>{formatDate(match.receipt_date)}</span>
                    <span>{match.receipt?.uploader?.full_name}</span>
                    {statusBadge(match)}
                  </figcaption>
                </figure>
              </div>
            </div>
          ))}
        </Section>
      )}

      {receipt?.status === 'submitted' && matches.length > 0 && (
        <Section>
          <SwitchRow
            icon={CheckCircleIcon}
            title="I’ve checked - not a duplicate"
            checked={checked}
            onChange={setChecked}
          />
        </Section>
      )}

      <ReceiptHistory log={log} unknownName="System" />

      {action === 'approve' && (
        <ConfirmSheet
          title="Approve receipt?"
          message={`${amount === null ? '' : `${formatRand(amount)} · `}${receipt.vendor}. It will count as a cost to ${receipt.project?.name ?? 'the project'}.${actionError ? ` ${actionError}` : ''}`}
          actionLabel={busy ? 'Approving…' : 'Approve'}
          busy={busy}
          onConfirm={finishAction}
          onCancel={() => setAction(null)}
        />
      )}

      {(action === 'reject' || action === 'reverse') && (
        <Sheet
          title={action === 'reject' ? 'Reject receipt' : 'Reverse receipt'}
          hint={
            action === 'reject'
              ? 'The site manager will see your reason. The receipt is kept, but never counted.'
              : 'It stops counting as a cost. The approval stays in the history.'
          }
          cancelLabel="Cancel"
          showDone={false}
          onClose={() => setAction(null)}
          footer={
            <Button variant="danger" busy={busy} onClick={finishAction}>
              {action === 'reject' ? (busy ? 'Rejecting…' : 'Reject receipt') : busy ? 'Reversing…' : 'Reverse receipt'}
            </Button>
          }
        >
          <SheetGroup>
            <FieldRow
              label="Reason"
              placeholder={action === 'reject' ? 'e.g. Duplicate, unreadable' : 'What was wrong?'}
              inputWidth="62%"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </SheetGroup>
          {actionError && <Notice tone="error">{actionError}</Notice>}
        </Sheet>
      )}

      {viewing && <PhotoViewer src={viewing.src} alt={viewing.alt} onClose={() => setViewing(null)} />}
    </Page>
  )
}

export default ReceiptReview
