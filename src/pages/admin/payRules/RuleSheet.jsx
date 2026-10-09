import { useState } from 'react'
import { ruleError, voidRule } from '../../../lib/payRules'
import { formatDate, formatDateTime } from '../../../lib/labels'
import Button from '../../../components/Button'
import Notice from '../../../components/Notice'
import { FieldRow } from '../../../components/Row'
import Sheet, { SheetGroup } from '../../../components/Sheet'
import RuleRows from './RuleRows'

// One pay rule: its settings, and Void (with a reason). Voiding is never an
// edit: the rule stays in the history, marked Voided, and its days fall back
// to the rule before it. The first rule can't be voided.
//   isFirst: the live rule with the earliest start date
function RuleSheet({ rule, isFirst, onClose, onVoided }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const canVoid = !rule.voided_at && !isFirst

  async function save() {
    if (!reason.trim()) {
      setError('Enter a reason for voiding this rule.')
      return
    }
    setError('')
    setBusy(true)
    try {
      await voidRule(rule.id, reason.trim())
      onVoided()
    } catch (saveError) {
      setError(ruleError(saveError))
      setBusy(false)
    }
  }

  return (
    <Sheet
      title={`Rule from ${formatDate(rule.effective_from)}`}
      hint={`Added ${formatDateTime(rule.created_at)}${rule.created_by_profile?.full_name ? ` by ${rule.created_by_profile.full_name}` : ''}.`}
      cancelLabel={canVoid ? 'Cancel' : undefined}
      showDone={!canVoid}
      onClose={onClose}
      footer={
        canVoid ? (
          <Button variant="danger" busy={busy} onClick={save}>
            {busy ? 'Voiding…' : 'Void rule'}
          </Button>
        ) : undefined
      }
    >
      {rule.voided_at && (
        <Notice tone="error">
          Voided {formatDateTime(rule.voided_at)}: {rule.void_reason}
        </Notice>
      )}
      <SheetGroup>
        <RuleRows rule={rule} />
      </SheetGroup>
      {!rule.voided_at && isFirst && (
        <Notice tone="locked">
          The first rule can't be voided - every day needs a rule. To change the rules, add a new rule from a date.
        </Notice>
      )}
      {canVoid && (
        <>
          <SheetGroup>
            <FieldRow
              label="Reason"
              placeholder="Why is it wrong?"
              inputWidth="62%"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </SheetGroup>
          <Notice tone="info">
            Days from {formatDate(rule.effective_from)} are then worked out with the rule before it. Days already in a
            closed or paid pay run can't change - the database refuses it.
          </Notice>
        </>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </Sheet>
  )
}

export default RuleSheet
