// Prepares a receipt photo on the phone, before it is uploaded:
// - shrinks it to at most 1600px on the long side and under 1 MB, so it
//   uploads quickly on weak signal
// - redraws it as a plain JPEG, which also drops the photo's hidden details
//   (GPS location, phone model)
// - fingerprints it (SHA-256), so the same photo sent twice can be spotted

const MAX_SIDE = 1600
const MAX_BYTES = 1_000_000
const QUALITIES = [0.82, 0.7, 0.6]

// Errors here are written for the person holding the phone.
function photoError(message) {
  return Object.assign(new Error(message), { forPeople: true })
}

// iPhones save photos as HEIC. Safari can open them, but Chrome (laptops,
// Android) can't. The iPhone camera itself hands the app a JPEG, so this
// only happens when an existing .heic file is chosen.
const isHeic = (file) => /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name ?? '')

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    const fail = () => {
      URL.revokeObjectURL(url)
      reject(
        photoError(
          isHeic(file)
            ? "This is an iPhone HEIC photo, which this browser can't open. Take the photo with the Add receipt camera instead (or on the iPhone, set Settings > Camera > Formats to Most Compatible)."
            : "That file isn't a photo this browser can open. Take the photo with the camera instead.",
        ),
      )
    }
    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight) {
        fail()
        return
      }
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = fail
    image.src = url
  })
}

function toJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(photoError('Could not prepare the photo. Try again.'))),
      'image/jpeg',
      quality,
    )
  })
}

// Returns a JPEG Blob under 1 MB. Browsers apply the photo's rotation
// themselves when drawing it, so it comes out the right way up.
export async function shrinkReceiptPhoto(file) {
  const image = await loadImage(file)
  let scale = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight))

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) {
      // Phones refuse a drawing surface when they're short of memory.
      throw photoError('The phone ran out of memory preparing the photo. Close some other apps and try again.')
    }
    context.fillStyle = '#ffffff' // a see-through image gets a white background
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)

    for (const quality of QUALITIES) {
      const blob = await toJpeg(canvas, quality)
      if (blob.size <= MAX_BYTES) return blob
    }
    scale *= 0.8
  }
  throw photoError('That photo is too large. Try taking it again.')
}

const toHex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

// SHA-256 of the photo, as 64 hex characters.
export async function photoFingerprint(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  // The phone's built-in SHA-256 only works on secure (https) pages. On the
  // local test server opened over Wi-Fi it's missing, so use our own.
  if (globalThis.crypto?.subtle) {
    return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
  }
  return toHex(sha256(bytes))
}

// --- Plain SHA-256 (FIPS 180-4), only used when the built-in one is missing.
// The constants are worked out from prime numbers, as the standard defines
// them, rather than typed in.
const PRIMES = []
for (let n = 2; PRIMES.length < 64; n += 1) {
  if (PRIMES.every((p) => n % p !== 0)) PRIMES.push(n)
}
const fraction32 = (x) => ((x % 1) * 2 ** 32) >>> 0
const ROUND = Uint32Array.from(PRIMES, (p) => fraction32(Math.cbrt(p)))
const START = Uint32Array.from(PRIMES.slice(0, 8), (p) => fraction32(Math.sqrt(p)))
const rotr = (x, n) => (x >>> n) | (x << (32 - n))

function sha256(bytes) {
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  const bits = bytes.length * 8
  view.setUint32(padded.length - 8, Math.floor(bits / 2 ** 32))
  view.setUint32(padded.length - 4, bits >>> 0)

  const hash = Uint32Array.from(START)
  const w = new Uint32Array(64)
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4)
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, h] = hash
    for (let i = 0; i < 64; i += 1) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + ROUND[i] + w[i]) >>> 0
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0
      h = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    ;[a, b, c, d, e, f, g, h].forEach((value, i) => {
      hash[i] = (hash[i] + value) >>> 0
    })
  }

  const out = new Uint8Array(32)
  const outView = new DataView(out.buffer)
  hash.forEach((value, i) => outView.setUint32(i * 4, value))
  return out
}
