import { supabase } from './supabaseClient'
import { daysBetween, localDateOf } from './labels'
import * as steps from './receiptSteps'

// THE RATE WALL: the columns of a receipt the app reads. Never "amount" and
// never "*" - the server refuses both, for everyone. Owner/admin screens get
// amounts from fetchAmounts() instead.
export const RECEIPT_COLUMNS =
  'id, project_id, uploader_id, receipt_date, vendor, category, notes, image_path, status, duplicate_checked, reviewed_at, review_reason, created_at'

export { PHOTO_BUCKET } from './receiptSteps'
// Photo links stop working after 5 minutes.
export const PHOTO_LINK_SECONDS = 300

// Warning limits for approvers (they warn, they don't block).
export const LARGE_AMOUNT = 20000
export const OLD_RECEIPT_DAYS = 60

// OWNER/ADMIN SCREENS ONLY. Amounts of these receipts as { id: number }.
// The server answers site managers with nothing at all.
export async function fetchAmounts(receiptIds) {
  if (receiptIds.length === 0) return {}
  const { data, error } = await supabase
    .from('receipt_amounts')
    .select('receipt_id, amount')
    .in('receipt_id', receiptIds)
  if (error) throw error
  return Object.fromEntries(data.map((row) => [row.receipt_id, Number(row.amount)]))
}

// A new receipt id, made on the phone so that a retry on bad signal can't
// create a second copy of the same receipt.
export function newReceiptId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID()
  // randomUUID only exists on secure (https) pages; build the same thing.
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// --- Sending a receipt ------------------------------------------------------------
// The steps live in receiptSteps.js, shared with the attack test so the test
// uploads to exactly the place the app does. Here they use the app's connection.
export const saveDraft = (values) => steps.saveDraft(supabase, values)
export const uploadPhoto = (imagePath, blob) => steps.uploadPhoto(supabase, imagePath, blob)
export const photoIsUploaded = (imagePath) => steps.photoIsUploaded(supabase, imagePath)
export const findDuplicates = (receiptId) => steps.findDuplicates(supabase, receiptId)
export const submitDraft = (receiptId) => steps.submitDraft(supabase, receiptId)
export const discardDraft = (receiptId) => steps.discardDraft(supabase, receiptId)

// A message a person can act on. The database's messages for its receipt
// rules are written for people, so those are shown as they are; anything
// else (no signal, a server hiccup) gets the fallback.
export function receiptErrorMessage(error, fallback) {
  if (error?.forPeople) return error.message
  const message = error?.message ?? ''
  const fromOurRules =
    ['23514', '42501'].includes(error?.code) && !/permission denied|row-level security/.test(message)
  return fromOurRules ? message : fallback
}

// --- Approver warnings (they warn, they don't block) ------------------------
// receipt needs project (with status) and created_at; amount from fetchAmounts.
export function sanityWarnings(receipt, amount) {
  const warnings = []
  if (amount > LARGE_AMOUNT) {
    warnings.push('Over R20 000 - check the total on the photo.')
  }
  const age = daysBetween(receipt.receipt_date, localDateOf(receipt.created_at))
  if (age > OLD_RECEIPT_DAYS) {
    warnings.push(`Dated ${age} days before it was sent in (more than ${OLD_RECEIPT_DAYS}).`)
  }
  if (receipt.project && receipt.project.status !== 'active') {
    warnings.push(`The project is ${receipt.project.status === 'on_hold' ? 'on hold' : 'complete'}.`)
  }
  return warnings
}
