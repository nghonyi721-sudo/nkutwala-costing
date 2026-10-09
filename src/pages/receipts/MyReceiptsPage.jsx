import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import {
  RECEIPT_CATEGORY_LABELS,
  RECEIPT_STATUS_LABELS,
  RECEIPT_STATUS_TONES,
  formatDate,
} from '../../lib/labels'
import { RECEIPT_COLUMNS } from '../../lib/receipts'
import EmptyState from '../../components/EmptyState'
import { ImagesIcon, ReceiptIcon } from '../../components/icons'
import Notice from '../../components/Notice'
import Page from '../../components/Page'
import PhotoButton from '../../components/PhotoButton'
import { Row } from '../../components/Row'
import Section from '../../components/Section'
import Skeleton from '../../components/Skeleton'
import StatusBadge from '../../components/StatusBadge'
import { resetScrollLock } from '../../components/scrollLock'
import AddReceiptPage from './AddReceiptPage'
import ReceiptDetail from './ReceiptDetail'
import s from './Receipts.module.css'

// Site manager: their own receipts, newest first - WITHOUT amounts. The
// server never sends a site manager a rand value, not even their own.
// Discarded receipts stay in the database but aren't listed.
function MyReceiptsPage({ user }) {
  // undefined = loading, array = loaded
  const [receipts, setReceipts] = useState(undefined)
  const [error, setError] = useState('')
  // null = the list, { photo } = adding a receipt, { id } = one receipt
  const [open, setOpenState] = useState(null)
  // Switching between the list, adding and a receipt is a new screen: the
  // page always scrolls again, whatever popup state the last one left.
  const setOpen = (next) => {
    resetScrollLock()
    setOpenState(next)
  }
  const [flash, setFlash] = useState('')
  const [reloadCount, setReloadCount] = useState(0)

  useEffect(() => {
    let cancelled = false

    supabase
      .from('receipts')
      .select(`${RECEIPT_COLUMNS}, project:projects(name)`)
      .eq('uploader_id', user.id)
      .neq('status', 'discarded')
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data, error: loadError }) => {
        if (cancelled) return
        if (loadError) {
          setError('Could not load your receipts. Check your signal and try again.')
        } else {
          setError('')
          setReceipts(data)
        }
      })

    return () => {
      cancelled = true
    }
  }, [user.id, reloadCount])

  function showList(message = '') {
    setOpen(null)
    setFlash(message)
    setReloadCount((count) => count + 1)
  }

  if (open?.photo) return <AddReceiptPage user={user} photo={open.photo} onDone={showList} />
  if (open?.id) return <ReceiptDetail receiptId={open.id} onBack={showList} />

  const startAdding = (photo) => {
    setFlash('')
    setOpen({ photo })
  }
  const notSent = receipts?.filter((receipt) => receipt.status === 'draft') ?? []
  const sent = receipts?.filter((receipt) => receipt.status !== 'draft') ?? []
  const pending = sent.filter((receipt) => receipt.status === 'submitted').length

  const receiptRow = (receipt) => (
    <Row
      key={receipt.id}
      title={receipt.vendor}
      subtitle={
        <>
          {formatDate(receipt.receipt_date)} · {RECEIPT_CATEGORY_LABELS[receipt.category]}
          <span className={s.line}>{receipt.project?.name}</span>
          {receipt.status === 'rejected' && receipt.review_reason && (
            <span className={s.reason}>{receipt.review_reason}</span>
          )}
        </>
      }
      trailing={
        <StatusBadge
          status={receipt.status}
          label={RECEIPT_STATUS_LABELS[receipt.status]}
          tone={RECEIPT_STATUS_TONES[receipt.status]}
        />
      }
      chevron
      onClick={() => {
        setFlash('')
        setOpen({ id: receipt.id })
      }}
    />
  )

  return (
    <Page
      title="Receipts"
      subtitle={receipts?.length ? `${pending} waiting for the office` : undefined}
    >
      <div className={s.addArea}>
        <PhotoButton onPhoto={startAdding}>Add receipt</PhotoButton>
        <PhotoButton variant="plain" fromLibrary icon={ImagesIcon} onPhoto={startAdding}>
          Choose an existing photo
        </PhotoButton>
      </div>

      {flash && <Notice tone="success">{flash}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {!error && receipts === undefined && <Skeleton />}

      {receipts?.length === 0 && (
        <EmptyState
          icon={ReceiptIcon}
          title="No receipts yet"
          text="Photograph each slip when you pay for something for the site - fuel, materials, food or anything else."
        />
      )}

      {notSent.length > 0 && (
        <Section title="Not sent" footer="The signal may have dropped. Open it to finish sending, or discard it.">
          {notSent.map(receiptRow)}
        </Section>
      )}

      {sent.length > 0 && <Section title="Sent">{sent.map(receiptRow)}</Section>}
    </Page>
  )
}

export default MyReceiptsPage
