import { useState } from 'react'
import { ImagesIcon, MagnifyingGlassPlusIcon } from './icons'
import { useReceiptPhotoUrl } from './receiptPhotoUrl'
import Spinner from './Spinner'
import s from './ReceiptPhoto.module.css'

// A photo in a rounded frame; tap it to see it full screen.
//   src:  the picture (a link, or a photo still on the phone)
//   size: 'large' (the main photo), 'medium' (beside a form) or 'thumb'
//         (side-by-side comparisons)
export function PhotoFrame({ src, alt, size = 'large', onOpen, onError }) {
  return (
    <button
      type="button"
      className={`${s.frame} ${s[size]}`}
      onClick={() => onOpen?.(src)}
      aria-label={`${alt} - open full screen`}
    >
      <img className={s.image} src={src} alt={alt} onError={onError} />
      {size !== 'thumb' && (
        <span className={s.zoom} aria-hidden="true">
          <MagnifyingGlassPlusIcon size={20} weight="bold" />
        </span>
      )}
    </button>
  )
}

function Placeholder({ size, busy, text }) {
  return (
    <div className={`${s.frame} ${s[size]} ${s.placeholder}`} role={busy ? 'status' : undefined}>
      {busy ? <Spinner size={22} /> : <ImagesIcon size={size === 'thumb' ? 28 : 40} aria-hidden="true" />}
      <span>{text}</span>
    </div>
  )
}

// A receipt photo from private storage, through a link that expires after
// 5 minutes (a fresh link is fetched if it runs out).
function ReceiptPhoto({ path, alt, size = 'large', onOpen }) {
  const { url, failed, canRenew, renew } = useReceiptPhotoUrl(path)
  const [brokenUrl, setBrokenUrl] = useState(null)

  if (failed || (url && url === brokenUrl)) return <Placeholder size={size} text="No photo" />
  if (!url) return <Placeholder size={size} busy text="Loading photo…" />

  return (
    <PhotoFrame
      src={url}
      alt={alt}
      size={size}
      onOpen={onOpen}
      onError={() => (canRenew ? renew() : setBrokenUrl(url))}
    />
  )
}

export default ReceiptPhoto
