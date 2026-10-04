// Sending a receipt, in safe steps. Each step takes the Supabase connection
// to use, so the app (src/lib/receipts.js) and the attack test
// (scripts/rls-attack-test.mjs) run exactly the same code - including where
// the photo is uploaded to.
//
// Each step can be repeated after a dropped signal without making a mess.
// Plain JavaScript on purpose: no app-only imports, so Node can load it too.

export const PHOTO_BUCKET = 'receipts'

// An error whose message is written for the person using the app.
export function plainError(message) {
  return Object.assign(new Error(message), { forPeople: true })
}

// 1. Save the details as a draft (or bring an existing draft up to date).
//    Returns { image_path, status } as stored by the database. image_path -
//    where the photo must go - is worked out by the database, never by us:
//    {company}/{person}/{receipt id}.jpg
export async function saveDraft(client, values) {
  const { error } = await client.from('receipts').insert(values)
  if (error?.code === '23505') {
    // Saved on an earlier try whose answer got lost - update that draft.
    const { id, ...changes } = values
    const { error: updateError } = await client
      .from('receipts')
      .update(changes)
      .eq('id', id)
      .eq('status', 'draft')
    if (updateError) throw updateError
  } else if (error) {
    throw error
  }

  const { data, error: readError } = await client
    .from('receipts')
    .select('image_path, status')
    .eq('id', values.id)
    .single()
  if (readError) throw readError
  return data
}

// Why an upload failed, in words a person can act on.
function uploadFailure(error) {
  const status = String(error.statusCode ?? error.status ?? '')
  const message = error.message ?? ''
  if (status === '413' || /maximum allowed size|too large/i.test(message)) {
    return plainError('The photo is too large to upload (the limit is 2 MB). Take it again.')
  }
  if (status === '415' || /mime type|not supported/i.test(message)) {
    return plainError('The photo must be a JPEG picture. Take it again with the camera.')
  }
  if (status === '403' || /row-level security|unauthorized/i.test(message)) {
    return plainError(
      "The server refused this photo. It only accepts a photo for your own receipt that hasn't been submitted yet. Go back to Receipts and open the receipt again.",
    )
  }
  if (status === '404' || /bucket not found/i.test(message)) {
    return plainError('Photo storage is not set up yet (the "receipts" storage bucket is missing). Tell the administrator.')
  }
  if (!error.status && !error.statusCode) {
    return plainError('No signal - the photo did not upload. Your receipt is saved under "Not sent". Tap Submit to try again.')
  }
  return plainError(`The photo did not upload: ${message || 'the server gave no reason'}. Try again.`)
}

// 2. Upload the photo to the place the database gave in step 1. Waits for the
//    server to confirm. A photo already there from an earlier try counts as
//    done - the server answers "already exists" (409) for that, and only that.
export async function uploadPhoto(client, imagePath, photo) {
  const { error } = await client.storage
    .from(PHOTO_BUCKET)
    .upload(imagePath, photo, { contentType: 'image/jpeg', upsert: false })
  if (!error) return
  const alreadyThere = String(error.statusCode) === '409' || error.status === 409
  if (!alreadyThere) throw uploadFailure(error)
}

export async function photoIsUploaded(client, imagePath) {
  const { error } = await client.storage.from(PHOTO_BUCKET).createSignedUrl(imagePath, 60)
  return !error
}

// 3. Other receipts that look like the same spend. For a site manager the
//    database only ever returns their OWN receipts, and never any amounts.
export async function findDuplicates(client, receiptId) {
  const { data, error } = await client.rpc('receipt_duplicates', { p_receipt_id: receiptId })
  if (error) throw error
  return data
}

// 4. Submit. The database checks the photo is really there first. If an
//    earlier try already submitted it, that's fine too.
export async function submitDraft(client, receiptId) {
  const { data, error } = await client
    .from('receipts')
    .update({ status: 'submitted' })
    .eq('id', receiptId)
    .eq('status', 'draft')
    .select('id')
  if (error) throw error
  if (data.length === 1) return

  const { data: current } = await client.from('receipts').select('status').eq('id', receiptId).single()
  if (current?.status !== 'submitted') {
    throw plainError('This receipt can no longer be submitted. Go back to Receipts.')
  }
}

// Nothing is deleted: an unwanted draft is marked "discarded" and kept.
export async function discardDraft(client, receiptId) {
  const { data, error } = await client
    .from('receipts')
    .update({ status: 'discarded' })
    .eq('id', receiptId)
    .eq('status', 'draft')
    .select('id')
  if (error) throw error
  if (data.length === 0) throw plainError('This receipt can no longer be discarded.')
}
