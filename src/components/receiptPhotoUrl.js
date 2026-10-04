import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { PHOTO_BUCKET, PHOTO_LINK_SECONDS } from '../lib/receipts'

// A link to a private receipt photo that stops working after 5 minutes.
// The database decides whether this person may have the link at all
// (site managers: their own photos only).
//   failed:   no photo there, or not allowed to see it
//   renew():  get a fresh link (when the old one ran out) - up to twice
export function useReceiptPhotoUrl(path) {
  const [link, setLink] = useState({ key: null, url: null, failed: false })
  const [attempt, setAttempt] = useState(0)
  const key = `${path}#${attempt}`

  useEffect(() => {
    if (!path) return undefined
    let cancelled = false

    supabase.storage
      .from(PHOTO_BUCKET)
      .createSignedUrl(path, PHOTO_LINK_SECONDS)
      .then(({ data, error }) => {
        if (cancelled) return
        setLink({ key: `${path}#${attempt}`, url: error ? null : data.signedUrl, failed: Boolean(error) })
      })

    return () => {
      cancelled = true
    }
  }, [path, attempt])

  const current = link.key === key ? link : { url: null, failed: !path }
  const canRenew = attempt < 2
  return {
    url: current.url,
    failed: current.failed,
    canRenew,
    renew: () => setAttempt((count) => (count < 2 ? count + 1 : count)),
  }
}
