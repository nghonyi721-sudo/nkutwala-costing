import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useOverlay } from './overlay'
import s from './PhotoViewer.module.css'

const ZOOM = 2.5

// A photo full screen on black, like the Photos app. Tap the photo to zoom
// in on that spot (then drag to look around); tap again to fit it to the
// screen. Pinching works too. Done (or Escape) closes it.
function PhotoViewer({ src, alt, onClose }) {
  const { closing, close } = useOverlay(onClose)
  // null = fitted to the screen, a number = zoomed to that width in pixels
  const [zoomWidth, setZoomWidth] = useState(null)
  const stage = useRef(null)
  const zoomPoint = useRef(null)

  function toggleZoom(event) {
    if (zoomWidth) {
      setZoomWidth(null)
      return
    }
    const box = event.currentTarget.getBoundingClientRect()
    zoomPoint.current = {
      x: (event.clientX - box.left) / box.width,
      y: (event.clientY - box.top) / box.height,
    }
    setZoomWidth(Math.round(box.width * ZOOM))
  }

  // Once zoomed in, scroll so the spot that was tapped is in the middle.
  useLayoutEffect(() => {
    const element = stage.current
    if (!zoomWidth || !element || !zoomPoint.current) return
    element.scrollLeft = zoomPoint.current.x * element.scrollWidth - element.clientWidth / 2
    element.scrollTop = zoomPoint.current.y * element.scrollHeight - element.clientHeight / 2
  }, [zoomWidth])

  return createPortal(
    <div
      className={closing ? `${s.viewer} ${s.closing}` : s.viewer}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
    >
      <div className={s.bar}>
        <span className={s.hint}>{zoomWidth ? 'Tap to fit' : 'Tap to zoom'}</span>
        <button type="button" className={s.done} onClick={close} autoFocus>
          Done
        </button>
      </div>
      <div ref={stage} className={zoomWidth ? `${s.stage} ${s.zoomed}` : s.stage}>
        <img
          className={s.image}
          src={src}
          alt={alt}
          style={zoomWidth ? { width: zoomWidth } : undefined}
          onClick={toggleZoom}
        />
      </div>
    </div>,
    document.body,
  )
}

export default PhotoViewer
