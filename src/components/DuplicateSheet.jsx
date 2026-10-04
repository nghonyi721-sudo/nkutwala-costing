import { formatDate } from '../lib/labels'
import ConfirmSheet from './ConfirmSheet'

function describe(match) {
  const why = match.same_photo ? 'the same photo' : 'the same shop, amount and date'
  return `${formatDate(match.receipt_date)} at ${match.vendor} (${why})`
}

// Shown to a site manager before submitting a receipt that looks like one of
// their OWN earlier receipts (the database never shows them anyone else's).
//   matches: from receipt_duplicates() - no amounts in them
//   busy:    'submit' | 'discard' | null
function DuplicateSheet({ matches, busy, onSubmitAnyway, onDiscard, onCancel }) {
  const listed = matches.slice(0, 2).map(describe).join('; and your receipt from ')
  const more = matches.length > 2 ? ` - and ${matches.length - 2} more` : ''

  return (
    <ConfirmSheet
      title="Possible duplicate"
      message={`This looks like your receipt from ${listed}${more}. Submit it only if it's a different purchase.`}
      busy={Boolean(busy)}
      onCancel={onCancel}
      actions={[
        { label: 'Submit anyway', onClick: onSubmitAnyway, busy: busy === 'submit' },
        { label: 'Discard this receipt', onClick: onDiscard, destructive: true, busy: busy === 'discard' },
      ]}
    />
  )
}

export default DuplicateSheet
