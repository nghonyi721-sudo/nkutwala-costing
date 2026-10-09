import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import {
  RECEIPT_CATEGORY_LABELS,
  RECEIPT_STATUS_LABELS,
  RECEIPT_STATUS_TONES,
  formatDate,
  formatDateTime,
} from '../../lib/labels'
import { photoFingerprint, shrinkReceiptPhoto } from '../../lib/receiptImage'
import {
  RECEIPT_COLUMNS,
  discardDraft,
  findDuplicates,
  photoIsUploaded,
  receiptErrorMessage,
  submitDraft,
  uploadPhoto,
} from '../../lib/receipts'
import ActionBar from '../../components/ActionBar'
import Button from '../../components/Button'
import ConfirmSheet from '../../components/ConfirmSheet'
import DuplicateSheet from '../../components/DuplicateSheet'
import {
  CalendarBlankIcon,
  ClockIcon,
  MapPinIcon,
  NotePencilIcon,
  StorefrontIcon,
  TagIcon,
} from '../../components/icons'
import Notice from '../../components/Notice'
import Page from '../../components/Page'
import PhotoButton from '../../components/PhotoButton'
import PhotoViewer from '../../components/PhotoViewer'
import ReceiptHistory from '../../components/ReceiptHistory'
import ReceiptPhoto from '../../components/ReceiptPhoto'
import { Row } from '../../components/Row'
import Section from '../../components/Section'
import Skeleton from '../../components/Skeleton'
import StatusBadge from '../../components/StatusBadge'
import s from './Receipts.module.css'

const SUBMITTED = 'Receipt submitted. The office will check it.'

// Site manager: one of their own receipts - photo, details, what happened to
// it. NO amount: the server never sends it to a site manager.
// A receipt that was never sent (a draft) can be finished or discarded here.
function ReceiptDetail({ receiptId, onBack }) {
  // undefined = loading, null = not found, object = loaded
  const [receipt, setReceipt] = useState(undefined)
  const [log, setLog] = useState([])
  const [loadError, setLoadError] = useState('')
  // Drafts only: is the photo already uploaded? (null = still checking)
  const [photoReady, setPhotoReady] = useState(null)
  const [viewing, setViewing] = useState(null)

  const [busy, setBusy] = useState(null) // null | 'submit' | 'discard'
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [duplicates, setDuplicates] = useState(null)
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)

  useEffect(() => {
    let cancelled = false

    Promise.all([
      supabase
        .from('receipts')
        .select(`${RECEIPT_COLUMNS}, project:projects(name)`)
        .eq('id', receiptId)
        .maybeSingle(),
      supabase
        .from('receipt_status_log')
        .select('id, to_status, reason, changed_at, changer:profiles(full_name)')
        .eq('receipt_id', receiptId)
        .order('changed_at'),
    ]).then(async ([receiptResult, logResult]) => {
      if (cancelled) return
      if (receiptResult.error || logResult.error) {
        setLoadError('Could not load the receipt. Check your signal and try again.')
        return
      }
      setReceipt(receiptResult.data)
      setLog(logResult.data)
      if (receiptResult.data?.status === 'draft') {
        const uploaded = await photoIsUploaded(receiptResult.data.image_path)
        if (!cancelled) setPhotoReady(uploaded)
      }
    })

    return () => {
      cancelled = true
    }
  }, [receiptId])

  // Finish sending a draft: upload the photo if it never got there, check
  // for duplicates of their own receipts, then submit.
  async function send(newPhoto) {
    setError('')
    setBusy('submit')
    try {
      if (newPhoto) {
        setProgress('Preparing photo…')
        const blob = await shrinkReceiptPhoto(newPhoto)
        const hash = await photoFingerprint(blob)
        const { error: hashError } = await supabase
          .from('receipts')
          .update({ image_hash: hash })
          .eq('id', receiptId)
          .eq('status', 'draft')
        if (hashError) throw hashError
        setProgress('Uploading photo…')
        await uploadPhoto(receipt.image_path, blob)
        setPhotoReady(true)
      }

      setProgress('Checking for duplicates…')
      const matches = await findDuplicates(receiptId)
      if (matches.length > 0) {
        setDuplicates(matches)
        return
      }

      setProgress('Submitting…')
      await submitDraft(receiptId)
      onBack(SUBMITTED)
    } catch (err) {
      setError(receiptErrorMessage(err, 'Could not send it. Check your signal and try again.'))
    } finally {
      setBusy(null)
      setProgress('')
    }
  }

  async function submitAnyway() {
    setBusy('submit')
    try {
      await submitDraft(receiptId)
      // Close the warning before leaving the page.
      setDuplicates(null)
      onBack(SUBMITTED)
    } catch (err) {
      setDuplicates(null)
      setError(receiptErrorMessage(err, 'Could not send it. Check your signal and try again.'))
    } finally {
      setBusy(null)
    }
  }

  async function discardIt() {
    setBusy('discard')
    try {
      await discardDraft(receiptId)
      // Close the dialogs before leaving the page.
      setDuplicates(null)
      setConfirmingDiscard(false)
      onBack("Receipt discarded. It won't be counted.")
    } catch (err) {
      setDuplicates(null)
      setConfirmingDiscard(false)
      setError(receiptErrorMessage(err, 'Could not discard it. Check your signal and try again.'))
    } finally {
      setBusy(null)
    }
  }

  const isDraft = receipt?.status === 'draft'

  const footer = isDraft ? (
    <ActionBar message={busy ? "Keep this screen open until it's sent." : error} tone={error && !busy ? 'error' : 'info'}>
      <Button variant="danger" disabled={Boolean(busy)} onClick={() => setConfirmingDiscard(true)}>
        Discard
      </Button>
      {/* While sending, shows the step it's on ("Uploading photo…"). */}
      {busy === 'submit' ? (
        <Button busy>{progress || 'Sending…'}</Button>
      ) : photoReady === false ? (
        <PhotoButton disabled={Boolean(busy)} onPhoto={send}>
          Take photo
        </PhotoButton>
      ) : (
        <Button disabled={Boolean(busy) || photoReady === null} onClick={() => send()}>
          Submit
        </Button>
      )}
    </ActionBar>
  ) : undefined

  return (
    <Page
      title={receipt?.vendor ?? 'Receipt'}
      subtitle={receipt ? `${formatDate(receipt.receipt_date)} · ${receipt.project?.name ?? ''}` : undefined}
      onBack={() => onBack()}
      backLabel="Receipts"
      footer={footer}
    >
      {loadError && <Notice tone="error">{loadError}</Notice>}
      {!loadError && receipt === undefined && <Skeleton rows={4} />}
      {receipt === null && <Notice tone="error">Receipt not found.</Notice>}

      {isDraft && (
        <Notice tone="error">
          {photoReady === false
            ? 'Not sent - the photo never reached the office. Take it again and it will be sent.'
            : 'Not sent yet - the signal may have dropped. Tap Submit to send it, or discard it.'}
        </Notice>
      )}
      {receipt?.status === 'submitted' && (
        <Notice tone="info">Waiting for the office to approve it.</Notice>
      )}
      {receipt?.status === 'approved' && (
        <Notice tone="success">
          Approved{receipt.reviewed_at ? ` ${formatDateTime(receipt.reviewed_at)}` : ''}. It counts as a cost
          to {receipt.project?.name ?? 'the project'}.
        </Notice>
      )}
      {receipt?.status === 'rejected' && (
        <Notice tone="error">
          Rejected: {receipt.review_reason}. If it still needs to be claimed, add it again as a new receipt.
        </Notice>
      )}
      {receipt?.status === 'reversed' && (
        <Notice tone="error">Reversed after it was approved: {receipt.review_reason}.</Notice>
      )}

      {receipt && !(isDraft && photoReady !== true) && (
        <div className={s.photoArea}>
          <ReceiptPhoto path={receipt.image_path} alt={`Receipt from ${receipt.vendor}`} onOpen={setViewing} />
        </div>
      )}

      {receipt && (
        <Section title="Details" footer="Amounts are shown to the office only.">
          <Row icon={StorefrontIcon} title="Vendor" trailing={receipt.vendor} />
          <Row icon={TagIcon} title="Category" trailing={RECEIPT_CATEGORY_LABELS[receipt.category]} />
          <Row icon={CalendarBlankIcon} title="Date" trailing={formatDate(receipt.receipt_date)} />
          <Row icon={MapPinIcon} title="Project" trailing={receipt.project?.name} />
          <Row
            icon={ClockIcon}
            title="Status"
            trailing={
              <StatusBadge
                status={receipt.status}
                label={RECEIPT_STATUS_LABELS[receipt.status]}
                tone={RECEIPT_STATUS_TONES[receipt.status]}
              />
            }
          />
          {receipt.notes && <Row icon={NotePencilIcon} title="Notes" subtitle={receipt.notes} />}
        </Section>
      )}

      <ReceiptHistory log={log} />

      {duplicates && (
        <DuplicateSheet
          matches={duplicates}
          busy={busy}
          onSubmitAnyway={submitAnyway}
          onDiscard={discardIt}
          onCancel={() => setDuplicates(null)}
        />
      )}
      {confirmingDiscard && (
        <ConfirmSheet
          title="Discard this receipt?"
          message="It won't be sent or counted. It stays on record."
          actionLabel={busy === 'discard' ? 'Discarding…' : 'Discard receipt'}
          destructive
          busy={busy === 'discard'}
          onConfirm={discardIt}
          onCancel={() => setConfirmingDiscard(false)}
        />
      )}
      {viewing && (
        <PhotoViewer src={viewing} alt={`Receipt from ${receipt?.vendor}`} onClose={() => setViewing(null)} />
      )}
    </Page>
  )
}

export default ReceiptDetail
