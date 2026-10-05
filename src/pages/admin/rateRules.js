import { formatDate } from '../../lib/labels'

// What's wrong with a rate before sending it, or '' if it's fine.
export function rateProblem(amount, startsOn) {
  if (!(Number(amount) > 0)) return 'Enter an hourly rate above R0.'
  if (!startsOn) return 'Choose the date the rate starts.'
  return ''
}

// Why approving failed, in words the owner can act on.
export function approvalErrorMessage(error, startsOn) {
  if (error?.code === '23505') {
    return `There is already a rate starting ${formatDate(startsOn)}. Choose another start date.`
  }
  // The database's own rules explain themselves (e.g. "This employee is not
  // waiting for approval.").
  if (error?.code === '23514' || error?.code === '42501') return error.message
  return 'Could not approve. Check your signal and try again.'
}
