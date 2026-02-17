import { supabase, CERT_BUCKET, extractObjectPath } from '../lib/supabase'

const LEGACY_CERT_BUCKET = 'sertifikat-files'
const CERT_BUCKET_CANDIDATES = Array.from(new Set([CERT_BUCKET, LEGACY_CERT_BUCKET]))
const SIGNED_EXPIRES = 60 * 60 * 24 * 7

const isHttpUrl = (value) => typeof value === 'string' && /^https?:\/\//i.test(value)

const normalizePath = (value) => String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim()

const canAccessSignedUrl = async (signedUrl) => {
  if (!signedUrl) return false
  try {
    const response = await fetch(signedUrl, {
      method: 'HEAD',
      credentials: 'include'
    })
    return response.ok
  } catch {
    return false
  }
}

export const resolveCertificateFileUrl = async (fileUrlOrPath) => {
  const raw = normalizePath(fileUrlOrPath)
  if (!raw) return ''
  if (isHttpUrl(fileUrlOrPath)) return fileUrlOrPath

  let fallbackSignedUrl = ''

  for (const bucket of CERT_BUCKET_CANDIDATES) {
    const objectPathCandidates = Array.from(new Set([
      extractObjectPath(bucket, raw),
      raw
    ].filter(Boolean)))

    for (const objectPath of objectPathCandidates) {
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(objectPath, SIGNED_EXPIRES)

      if (error || !data?.signedUrl) continue
      if (!fallbackSignedUrl) fallbackSignedUrl = data.signedUrl

      // Signed URL bisa sukses walau file bucket salah; validasi akses agar bucket tepat.
      // Fallback tetap dipakai jika semua HEAD gagal.
      // eslint-disable-next-line no-await-in-loop
      if (await canAccessSignedUrl(data.signedUrl)) return data.signedUrl
    }
  }

  return fallbackSignedUrl
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
