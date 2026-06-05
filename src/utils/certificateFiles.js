import { supabase, CERT_BUCKET, extractObjectPath } from '../lib/supabase'

const LEGACY_CERT_BUCKET = 'sertifikat-files'
const CERT_BUCKET_CANDIDATES = Array.from(new Set([CERT_BUCKET, LEGACY_CERT_BUCKET]))
const SIGNED_EXPIRES = 60 * 60 * 24 * 7

const isHttpUrl = (value) => typeof value === 'string' && /^https?:\/\//i.test(value)
const isSameOriginUrl = (value = '') => {
  if (typeof window === 'undefined') return false
  try {
    return new URL(String(value || ''), window.location.origin).origin === window.location.origin
  } catch {
    return false
  }
}
const fetchCredentialsForUrl = (value = '') => {
  const raw = String(value || '')
  if (!isHttpUrl(raw)) return 'same-origin'
  return isSameOriginUrl(raw) ? 'same-origin' : 'omit'
}

const normalizePath = (value) => String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim()

const canAccessSignedUrl = async (signedUrl) => {
  if (!signedUrl) return false
  try {
    const response = await fetch(signedUrl, {
      method: 'HEAD',
      credentials: fetchCredentialsForUrl(signedUrl)
    })
    return response.ok
  } catch {
    return false
  }
}

export const resolveCertificateFileUrl = async (fileUrlOrPath) => {
  const rawValue = String(fileUrlOrPath || '').trim()
  const raw = normalizePath(rawValue)
  if (!rawValue && !raw) return ''
  if (isHttpUrl(rawValue) && !CERT_BUCKET_CANDIDATES.some((bucket) => extractObjectPath(bucket, rawValue))) {
    return rawValue
  }

  for (const bucket of CERT_BUCKET_CANDIDATES) {
    const objectPathCandidates = Array.from(new Set([
      extractObjectPath(bucket, rawValue || raw),
      isHttpUrl(rawValue) ? '' : raw
    ].filter(Boolean)))

    for (const objectPath of objectPathCandidates) {
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(objectPath, SIGNED_EXPIRES)

      if (error || !data?.signedUrl) continue

      // Signed URL bisa sukses walau file bucket salah; validasi akses agar bucket tepat.
      // eslint-disable-next-line no-await-in-loop
      if (await canAccessSignedUrl(data.signedUrl)) return data.signedUrl
    }
  }

  return ''
}

export const hydrateCertificateFileUrls = async (rows = []) => {
  const list = Array.isArray(rows) ? rows : []
  return Promise.all(
    list.map(async (row) => {
      const resolved = await resolveCertificateFileUrl(row?.file_url || '')
      return {
        ...row,
        file_url_resolved: resolved || row?.file_url || ''
      }
    })
  )
}

export const getCertificateDisplayUrl = (row) =>
  row?.file_url_resolved || row?.file_url || ''

const sanitizeDownloadName = (value) =>
  String(value || '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)

export const downloadCertificateFile = async (row) => {
  const rawValue = String(row?.file_url || row?.file_url_resolved || '').trim()
  const raw = normalizePath(rawValue)
  if (!rawValue && !raw) throw new Error('File sertifikat tidak ditemukan')

  const extension = String(raw.split('?')[0].split('.').pop() || 'pdf').toLowerCase()
  const baseName = sanitizeDownloadName([
    'Sertifikat',
    row?.certificate_number,
    row?.event,
    row?.nama_penerima
  ].filter(Boolean).join(' - ')) || 'Sertifikat'

  let lastError = null
  for (const bucket of CERT_BUCKET_CANDIDATES) {
    const objectPathCandidates = Array.from(new Set([
      extractObjectPath(bucket, rawValue || raw),
      isHttpUrl(rawValue) ? '' : raw
    ].filter(Boolean)))

    for (const objectPath of objectPathCandidates) {
      const { data, error } = await supabase.storage.from(bucket).download(objectPath)
      if (error || !data) {
        lastError = error
        continue
      }

      const url = URL.createObjectURL(data)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${baseName}.${extension}`
      anchor.style.display = 'none'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)

      return { filename: anchor.download }
    }
  }

  throw lastError || new Error('File sertifikat tidak dapat diakses')
}
