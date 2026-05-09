export const MAX_ASSIGNMENT_PHOTOS = 6
export const ASSIGNMENT_PHOTO_MAX_BYTES = 150 * 1024

export const parseAssignmentFileList = (value, fallback = '') => {
  const items = []

  const push = (item) => {
    const raw = String(item || '').trim()
    if (!raw || ['null', 'undefined', '-', 'n/a'].includes(raw.toLowerCase())) return
    if (!items.includes(raw)) items.push(raw)
  }

  if (Array.isArray(value)) {
    value.forEach(push)
  } else if (typeof value === 'string') {
    const raw = value.trim()
    if (raw.startsWith('[')) {
      try {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) parsed.forEach(push)
      } catch {
        push(raw)
      }
    } else {
      push(raw)
    }
  }

  push(fallback)
  return items.slice(0, MAX_ASSIGNMENT_PHOTOS)
}

export const isGoogleDriveUrl = (value = '') => (
  /^https?:\/\/(?:drive|docs)\.google\.com\//i.test(String(value || '').trim())
)

export const isImageLikeFile = (value = '') => {
  const raw = String(value || '').split('?')[0].toLowerCase()
  if (isGoogleDriveUrl(raw)) return true
  return /\.(jpe?g|png|gif|webp|bmp|heic|heif|avif)$/i.test(raw)
}

export const normalizePhotoFiles = (files = []) => (
  Array.from(files || []).filter((file) => String(file?.type || '').toLowerCase().startsWith('image/'))
)
