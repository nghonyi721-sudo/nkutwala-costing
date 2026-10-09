import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { RECEIPT_CATEGORY_LABELS, formatDate, formatRand, parseRand, todayLocal } from '../../lib/labels'
import { photoFingerprint, shrinkReceiptPhoto } from '../../lib/receiptImage'
import {
  discardDraft,
  findDuplicates,
  newReceiptId,
  receiptErrorMessage,
  saveDraft,
  submitDraft,
  uploadPhoto,
} from '../../lib/receipts'
import ActionBar from '../../components/ActionBar'
import Button from '../../components/Button'
import DuplicateSheet from '../../components/DuplicateSheet'
import {
  CalendarBlankIcon,
  DotsThreeCircleIcon,
  ForkKnifeIcon,
  GasPumpIcon,
  ImagesIcon,
  MapPinIcon,
  NotePencilIcon,
  PackageIcon,
  ReceiptIcon,
  StorefrontIcon,
  TagIcon,
  ToolboxIcon,
  TruckIcon,
} from '../../components/icons'
import DateTimeField from '../../components/DateTimeField'
import Notice from '../../components/Notice'
import Page from '../../components/Page'
import PhotoButton from '../../components/PhotoButton'
import PhotoViewer from '../../components/PhotoViewer'
import { PhotoFrame } from '../../components/ReceiptPhoto'
import { FieldRow, Row } from '../../components/Row'
import Section from '../../components/Section'
import { PickSheet } from '../../components/Sheet'
import Spinner from '../../components/Spinner'
import SummaryCard from '../../components/SummaryCard'
import TextAreaGroup from '../../components/TextAreaGroup'
import s from './Receipts.module.css'

const CATEGORIES = [
  { value: 'fuel', icon: GasPumpIcon },
  { value: 'materials', icon: PackageIcon },
  { value: 'plant_hire', icon: TruckIcon },
  { value: 'consumables', icon: ToolboxIcon },
  { value: 'food', icon: ForkKnifeIcon },
  { value: 'other', icon: DotsThreeCircleIcon },
]

const SUBMITTED = 'Receipt submitted. The office will check it.'
const NOT_SENT =
  'Not sent yet - check your signal and tap Submit again. Your receipt is saved under "Not sent".'

// Site manager: photograph a receipt, type in the details, check, submit.
// The amount is typed here and shown on the check screen from what was
// typed - the server never sends it back (the Rate Wall).
//   photo:  the picture just taken from the Receipts list
//   onDone: back to the list, with a message to show there
function AddReceiptPage({ user, photo: firstPhoto, onDone }) {
  const [step, setStep] = useState('details') // 'details' | 'confirm'

  // The photo, shrunk on the phone: { blob, url, hash }
  const [photo, setPhoto] = useState(null)
  const [preparing, setPreparing] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const [viewing, setViewing] = useState(false)
  const photoUrl = useRef(null)
  const started = useRef(false)

  // The phone chooses the receipt id, so a retry can't create a second copy.
  const [receiptId, setReceiptId] = useState(newReceiptId)
  const draftSaved = useRef(false)

  const [form, setForm] = useState(() => ({
    amount: '',
    vendor: '',
    category: '',
    receipt_date: todayLocal(),
    project_id: '',
    notes: '',
  }))
  const [projects, setProjects] = useState(undefined)
  const [recentVendors, setRecentVendors] = useState([])
  const [loadError, setLoadError] = useState('')
  const [pickingProject, setPickingProject] = useState(false)

  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [progress, setProgress] = useState('')
  const [busy, setBusy] = useState(null) // null | 'submit' | 'discard'
  const [duplicates, setDuplicates] = useState(null)

  async function takePhoto(file) {
    setPhotoError('')
    setPreparing(true)
    try {
      const blob = await shrinkReceiptPhoto(file)
      const hash = await photoFingerprint(blob)
      if (photoUrl.current) URL.revokeObjectURL(photoUrl.current)
      photoUrl.current = URL.createObjectURL(blob)
      setPhoto({ blob, hash, url: photoUrl.current })

      // An uploaded photo can never be replaced, so a new photo means a new
      // receipt. A draft already saved for the old one is discarded (kept).
      if (draftSaved.current) {
        discardDraft(receiptId).catch(() => {})
        draftSaved.current = false
        setReceiptId(newReceiptId())
      }
    } catch (err) {
      setPhotoError(err.forPeople ? err.message : 'Could not prepare the photo. Try again.')
    } finally {
      setPreparing(false)
    }
  }

  // Start with the photo taken on the Receipts list. The started flag makes
  // this happen once, however often the screen redraws.
  useEffect(() => {
    if (started.current || !firstPhoto) return
    started.current = true
    takePhoto(firstPhoto)
  })

  useEffect(
    () => () => {
      if (photoUrl.current) URL.revokeObjectURL(photoUrl.current)
    },
    [],
  )

  // Projects; the project of this manager's latest daily report as the
  // default; and their recent vendors for one-tap entry.
  useEffect(() => {
    let cancelled = false

    Promise.all([
      supabase.from('projects').select('id, name, status').order('name'),
      supabase
        .from('daily_reports')
        .select('project_id')
        .eq('reporter_id', user.id)
        .order('report_date', { ascending: false })
        .limit(1),
      supabase
        .from('receipts')
        .select('vendor')
        .eq('uploader_id', user.id)
        .neq('status', 'discarded')
        .order('created_at', { ascending: false })
        .limit(40),
    ]).then(([projectsResult, reportResult, vendorsResult]) => {
      if (cancelled) return
      if (projectsResult.error) {
        setLoadError('Could not load the projects. Check your signal and try again.')
        return
      }
      const active = projectsResult.data.filter((p) => p.status === 'active')
      const lastProject = reportResult.data?.[0]?.project_id
      const defaultProject = active.some((p) => p.id === lastProject)
        ? lastProject
        : active.length === 1
          ? active[0].id
          : ''
      setProjects(projectsResult.data)
      setForm((current) => (current.project_id ? current : { ...current, project_id: defaultProject }))

      const seen = new Set()
      const vendors = []
      for (const { vendor } of vendorsResult.data ?? []) {
        const key = vendor.toLowerCase()
        if (!seen.has(key) && vendors.length < 4) {
          seen.add(key)
          vendors.push(vendor)
        }
      }
      setRecentVendors(vendors)
    })

    return () => {
      cancelled = true
    }
  }, [user.id])

  function setField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
    setError('')
    setMessage('')
  }

  const amount = parseRand(form.amount)
  const projectChoices = (projects ?? []).filter((p) => p.status === 'active' || p.id === form.project_id)
  const projectName = projectChoices.find((p) => p.id === form.project_id)?.name

  function detailsProblem() {
    if (!photo) return 'Take a photo of the receipt.'
    if (amount === null) return 'Enter the amount, for example 1250,50.'
    if (!/[a-z0-9]/i.test(form.vendor)) return 'Enter the shop or supplier.'
    if (!form.category) return 'Choose a category.'
    if (!form.receipt_date) return 'Choose the date on the receipt.'
    if (form.receipt_date > todayLocal()) return "The date can't be in the future."
    if (!form.project_id) return 'Choose the project.'
    return ''
  }

  function goToConfirm() {
    const problem = detailsProblem()
    if (problem) {
      setError(problem)
      return
    }
    setError('')
    setStep('confirm')
  }

  async function submit() {
    setError('')
    setMessage('')
    setBusy('submit')
    try {
      setProgress('Saving…')
      const saved = await saveDraft({
        id: receiptId,
        project_id: form.project_id,
        receipt_date: form.receipt_date,
        vendor: form.vendor.trim(),
        category: form.category,
        amount,
        notes: form.notes.trim(),
        image_hash: photo.hash,
      })
      draftSaved.current = true
      if (saved.status === 'submitted') {
        onDone(SUBMITTED) // an earlier try got through
        return
      }

      setProgress('Uploading photo…')
      await uploadPhoto(saved.image_path, photo.blob)

      setProgress('Checking for duplicates…')
      const matches = await findDuplicates(receiptId)
      if (matches.length > 0) {
        setDuplicates(matches)
        return
      }

      setProgress('Submitting…')
      await submitDraft(receiptId)
      onDone(SUBMITTED)
    } catch (err) {
      setError(receiptErrorMessage(err, draftSaved.current ? NOT_SENT : 'Could not save. Check your signal and tap Submit again.'))
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
      onDone(SUBMITTED)
    } catch (err) {
      setDuplicates(null)
      setError(receiptErrorMessage(err, NOT_SENT))
    } finally {
      setBusy(null)
    }
  }

  async function discardIt() {
    setBusy('discard')
    try {
      await discardDraft(receiptId)
      // Close the warning before leaving the page.
      setDuplicates(null)
      onDone("Receipt discarded. It won't be counted.")
    } catch (err) {
      setDuplicates(null)
      setError(receiptErrorMessage(err, 'Could not discard. Check your signal and try again.'))
    } finally {
      setBusy(null)
    }
  }

  const viewer = viewing && photo && (
    <PhotoViewer src={photo.url} alt="Receipt photo" onClose={() => setViewing(false)} />
  )

  // --- Step 2: check and submit ------------------------------------------------
  if (step === 'confirm') {
    return (
      <Page
        title="Check and submit"
        subtitle={projectName}
        onBack={() => setStep('details')}
        backLabel="Edit"
        footer={
          <ActionBar message={busy ? "Keep this screen open until it's sent." : error || message} tone={error && !busy ? 'error' : 'info'}>
            {/* Shows the step it's on ("Uploading photo…") and can't be
                tapped again until the whole send has finished. */}
            <Button busy={busy === 'submit'} disabled={Boolean(busy)} onClick={submit}>
              {busy === 'submit' ? progress || 'Submitting…' : 'Submit receipt'}
            </Button>
          </ActionBar>
        }
      >
        <div className={s.photoArea}>
          <PhotoFrame src={photo.url} alt="Receipt photo" size="medium" onOpen={() => setViewing(true)} />
        </div>

        <SummaryCard
          icon={ReceiptIcon}
          label="Amount (incl. VAT)"
          meta={RECEIPT_CATEGORY_LABELS[form.category]}
          value={formatRand(amount)}
        />

        <Section footer="Check the amount against the photo. Once submitted, it can't be changed - the office approves or rejects it.">
          <Row icon={StorefrontIcon} title="Vendor" trailing={form.vendor.trim()} />
          <Row icon={TagIcon} title="Category" trailing={RECEIPT_CATEGORY_LABELS[form.category]} />
          <Row icon={CalendarBlankIcon} title="Date" trailing={formatDate(form.receipt_date)} />
          <Row icon={MapPinIcon} title="Project" trailing={projectName} />
          {form.notes.trim() && <Row icon={NotePencilIcon} title="Notes" subtitle={form.notes.trim()} />}
        </Section>

        {duplicates && (
          <DuplicateSheet
            matches={duplicates}
            busy={busy}
            onSubmitAnyway={submitAnyway}
            onDiscard={discardIt}
            onCancel={() => {
              setDuplicates(null)
              setMessage('Not submitted. It is saved under "Not sent" in Receipts.')
            }}
          />
        )}
        {viewer}
      </Page>
    )
  }

  // --- Step 1: photo and details ----------------------------------------------
  return (
    <Page
      title="Add receipt"
      onBack={() => onDone()}
      backLabel="Receipts"
      footer={
        <ActionBar message={error} tone="error">
          <Button disabled={preparing || projects === undefined} onClick={goToConfirm}>
            Next
          </Button>
        </ActionBar>
      }
    >
      <div className={s.photoArea}>
        {preparing && (
          <div className={s.preparing} role="status">
            <Spinner size={24} />
            Preparing photo…
          </div>
        )}
        {!preparing && photo && (
          <PhotoFrame src={photo.url} alt="Receipt photo" size="medium" onOpen={() => setViewing(true)} />
        )}
        {!preparing && !photo && (
          <PhotoButton big onPhoto={takePhoto}>
            Take photo
          </PhotoButton>
        )}
      </div>
      {!preparing && (
        <div className={s.photoActions}>
          {photo ? (
            <PhotoButton variant="plain" onPhoto={takePhoto}>
              Retake
            </PhotoButton>
          ) : (
            <PhotoButton variant="plain" fromLibrary icon={ImagesIcon} onPhoto={takePhoto}>
              Choose an existing photo
            </PhotoButton>
          )}
        </div>
      )}
      {photoError && <Notice tone="error">{photoError}</Notice>}
      {loadError && <Notice tone="error">{loadError}</Notice>}

      <Section title="Total paid (incl. VAT)">
        <label className={s.amount}>
          <span className={s.currency} aria-hidden="true">
            R
          </span>
          <input
            className={s.amountInput}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0,00"
            aria-label="Amount in rand"
            value={form.amount}
            onChange={(e) => setField('amount', e.target.value)}
          />
        </label>
      </Section>

      <Section title="Vendor">
        <FieldRow
          icon={StorefrontIcon}
          label="Shop"
          placeholder="Shop or supplier"
          autoCapitalize="words"
          autoComplete="off"
          maxLength={120}
          inputWidth="62%"
          value={form.vendor}
          onChange={(e) => setField('vendor', e.target.value)}
        />
      </Section>
      {recentVendors.length > 0 && (
        <div className={s.chips} aria-label="Recent vendors">
          {recentVendors.map((vendor) => (
            <button
              key={vendor}
              type="button"
              className={s.chip}
              aria-pressed={form.vendor === vendor}
              onClick={() => setField('vendor', vendor)}
            >
              {vendor}
            </button>
          ))}
        </div>
      )}

      <Section title="Category" plain>
        <div className={s.categories} role="radiogroup" aria-label="Category">
          {CATEGORIES.map(({ value, icon: Icon }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={form.category === value}
              className={s.category}
              onClick={() => setField('category', value)}
            >
              <Icon size={26} weight={form.category === value ? 'fill' : 'regular'} aria-hidden="true" />
              {RECEIPT_CATEGORY_LABELS[value]}
            </button>
          ))}
        </div>
      </Section>

      <Section title="When and where">
        <Row
          icon={CalendarBlankIcon}
          title="Date"
          trailing={
            <DateTimeField
              type="date"
              label="Date on the receipt"
              max={todayLocal()}
              value={form.receipt_date}
              onChange={(e) => setField('receipt_date', e.target.value)}
            />
          }
        />
        {projects === undefined ? (
          <Row icon={MapPinIcon} title="Loading projects…" />
        ) : projectChoices.length === 0 ? (
          <Row icon={MapPinIcon} title="No active projects" subtitle="Ask the owner to add one." />
        ) : (
          <Row
            icon={MapPinIcon}
            title={projectName ?? 'Choose a project'}
            tone={projectName ? undefined : 'accent'}
            chevron
            onClick={() => setPickingProject(true)}
          />
        )}
      </Section>

      <Section title="Notes (optional)" plain>
        <TextAreaGroup
          label="Notes"
          rows={3}
          maxLength={1000}
          placeholder="What it was for, e.g. diesel for the TLB."
          value={form.notes}
          onChange={(e) => setField('notes', e.target.value)}
        />
      </Section>

      {pickingProject && (
        <PickSheet
          title="Project"
          options={projectChoices.map((p) => ({ value: p.id, title: p.name }))}
          selected={form.project_id}
          onPick={(value) => setField('project_id', value)}
          onClose={() => setPickingProject(false)}
        />
      )}
      {viewer}
    </Page>
  )
}

export default AddReceiptPage
