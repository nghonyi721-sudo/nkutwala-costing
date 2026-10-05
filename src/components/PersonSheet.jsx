import { useState } from 'react'
import { EMPLOYEE_CATEGORY_LABELS } from '../lib/labels'
import Button from './Button'
import { PhoneIcon, UserCircleIcon } from './icons'
import Notice from './Notice'
import { FieldRow } from './Row'
import Sheet, { SheetGroup } from './Sheet'
import s from './PersonSheet.module.css'

// Add a new person, or fix the details of one: full name, category (big
// buttons) and an optional phone number. No rates here - ever.
//   person:  null to add someone new, or the person to edit
//   busy:    saving; the Save button shows the activity indicator
//   error:   a message to show above the button
//   onSave({ fullName, category, phone }) does the work; the parent closes
//   the sheet when it's done.
function PersonSheet({ person, busy = false, error = '', onSave, onClose }) {
  const [fullName, setFullName] = useState(person?.full_name ?? '')
  const [category, setCategory] = useState(person?.category ?? '')
  const [phone, setPhone] = useState(person?.phone ?? '')
  const [problem, setProblem] = useState('')

  function save() {
    if (!fullName.trim()) {
      setProblem('Enter their full name.')
      return
    }
    if (!category) {
      setProblem('Choose a category.')
      return
    }
    if (phone.trim() && !/^[0-9+() -]{6,20}$/.test(phone.trim())) {
      setProblem('Enter a phone number with digits only, e.g. 082 123 4567.')
      return
    }
    setProblem('')
    onSave({ fullName, category, phone })
  }

  const message = problem || error

  return (
    <Sheet
      title={person ? 'Edit person' : 'New person'}
      hint={person ? undefined : 'They start as Pending until the owner approves them.'}
      cancelLabel="Cancel"
      showDone={false}
      onClose={onClose}
      footer={
        <Button busy={busy} onClick={save}>
          {busy ? 'Saving…' : person ? 'Save' : 'Add person'}
        </Button>
      }
    >
      {message && (
        <div className={s.message}>
          <Notice tone="error">{message}</Notice>
        </div>
      )}
      <SheetGroup>
        <FieldRow
          icon={UserCircleIcon}
          label="Full name"
          placeholder="Name and surname"
          autoComplete="off"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
        <FieldRow
          icon={PhoneIcon}
          label="Phone"
          type="tel"
          inputMode="tel"
          placeholder="Optional"
          autoComplete="off"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </SheetGroup>

      <p className={s.label}>Category</p>
      <div className={s.categories} role="radiogroup" aria-label="Category">
        {Object.entries(EMPLOYEE_CATEGORY_LABELS).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={category === value}
            className={s.category}
            onClick={() => setCategory(value)}
          >
            {label}
          </button>
        ))}
      </div>
    </Sheet>
  )
}

export default PersonSheet
