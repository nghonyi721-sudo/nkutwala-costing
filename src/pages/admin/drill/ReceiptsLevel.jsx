import { useEffect, useState } from 'react'
import { fetchReceipts } from '../../../lib/drilldown'
import { formatDate, formatRand } from '../../../lib/labels'
import {
  CalendarBlankIcon,
  CoinsIcon,
  MapPinIcon,
  NotePencilIcon,
  ReceiptIcon,
  TagIcon,
  UserCircleIcon,
} from '../../../components/icons'
import PhotoViewer from '../../../components/PhotoViewer'
import ReceiptPhoto from '../../../components/ReceiptPhoto'
import { Row } from '../../../components/Row'
import Section from '../../../components/Section'
import Sheet, { SheetGroup } from '../../../components/Sheet'
import SummaryCard from '../../../components/SummaryCard'
import DrillPage from './DrillPage'
import { LOAD_ERROR } from './drillText'
import s from './Drill.module.css'

// The APPROVED receipts behind a figure: one category, one vendor, or all
// of them. Amounts are the total paid, VAT inclusive. The total comes from
// the database (drill_receipts) and equals the figure tapped. Tap a receipt
// to see its photo, through a link that stops working after 5 minutes.
function ReceiptsLevel({ level, nav }) {
  const { projectId, period, category, vendor } = level
  const [rows, setRows] = useState(undefined)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(null) // the receipt shown in the sheet
  const [viewing, setViewing] = useState(null) // { src, alt } full screen

  useEffect(() => {
    let cancelled = false
    fetchReceipts(projectId, period, { category, vendor })
      .then((result) => {
        if (cancelled) return
        setError('')
        setRows(result)
      })
      .catch(() => {
        if (!cancelled) setError(LOAD_ERROR)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, period, category, vendor, nav.reloadCount])

  // Every row carries the level's totals.
  const totals = rows?.[0]
  const allProjects = projectId === null

  return (
    <DrillPage nav={nav} title={level.label} period={period} error={error} loading={rows === undefined}>
      <SummaryCard
        icon={ReceiptIcon}
        label={vendor ? 'Approved receipts from this vendor' : 'Approved receipts'}
        value={formatRand(totals?.total_amount ?? 0)}
        figures={[{ label: 'Receipts', value: totals?.receipt_count ?? 0 }]}
      />

      <Section footer="Approved receipts only, VAT inclusive. Tap one to see the photo.">
        {rows?.length === 0 && <Row title="No approved receipts in this period" />}
        {rows?.map((row) => (
          <Row
            key={row.receipt_id}
            title={vendor ? formatDate(row.receipt_date) : row.vendor}
            subtitle={[
              vendor ? row.category_label : formatDate(row.receipt_date),
              !vendor && !category ? row.category_label : null,
              row.uploader_name,
              allProjects ? row.project_name : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            trailing={formatRand(row.amount)}
            mono
            chevron
            onClick={() => setOpen(row)}
          />
        ))}
      </Section>

      {open && (
        <Sheet title={open.vendor} onClose={() => setOpen(null)}>
          <div className={s.sheetPhoto}>
            <ReceiptPhoto
              path={open.image_path}
              alt={`Receipt from ${open.vendor}`}
              size="medium"
              onOpen={(src) => setViewing({ src, alt: `Receipt from ${open.vendor}` })}
            />
          </div>
          <SheetGroup>
            <Row icon={CoinsIcon} title="Total paid" trailing={formatRand(open.amount)} mono />
            <Row icon={CalendarBlankIcon} title="Date" trailing={formatDate(open.receipt_date)} />
            <Row icon={TagIcon} title="Category" trailing={open.category_label} />
            <Row icon={MapPinIcon} title="Project" trailing={open.project_name} />
            <Row icon={UserCircleIcon} title="Uploaded by" trailing={open.uploader_name ?? 'Unknown'} />
            {open.notes && <Row icon={NotePencilIcon} title="Notes" subtitle={open.notes} />}
          </SheetGroup>
        </Sheet>
      )}

      {viewing && <PhotoViewer src={viewing.src} alt={viewing.alt} onClose={() => setViewing(null)} />}
    </DrillPage>
  )
}

export default ReceiptsLevel
