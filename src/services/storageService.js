import { apiClient, logFrontendError } from '../lib/api/client'

export const PROFILE_BUCKET = 'profile-photos'
export const CERT_BUCKET = 'certificates'
export const ASSIGNMENT_BUCKET = 'assignments'
export const QUIZ_MEDIA_BUCKET = 'quiz-media'
export const CERT_TEMPLATE_BUCKET = 'certificate-templates'

export const removeChannel = (ch) => {
  if (ch && typeof ch.close === 'function') ch.close()
}

const resolveObjectPath = (urlOrPath) => {
  const raw = String(urlOrPath || '')
  if (!raw) return ''
  try {
    return (new URL(raw).pathname || '').replace(/^\//, '')
  } catch {
    return raw.replace(/^\//, '')
  }
}

export const getSignedUrlForValue = async (bucket, urlOrPath, expiresInSec = 60 * 15) => {
  const path = resolveObjectPath(urlOrPath)
  if (!path) return ''
  try {
    const result = await apiClient('/api/v2/storage/signed-url', {
      method: 'POST',
      body: { bucket, object_path: path, expires_in: expiresInSec },
      dedupe: true
    })
    return result.payload?.data?.signed_url || result.data?.signed_url || ''
  } catch (err) {
    logFrontendError('error', `Storage signed URL failed: ${err.message}`, { bucket, path })
    return ''
  }
}

export const extractObjectPath = (bucket, urlOrPath) => resolveObjectPath(urlOrPath)

export const removeStorageObject = async (bucket, urlOrPath) => {
  try {
    await apiClient('/api/v2/storage/signed-url', {
      method: 'DELETE',
      body: { bucket, object_path: resolveObjectPath(urlOrPath) }
    })
    return { error: null }
  } catch (err) {
    logFrontendError('error', `Storage remove failed: ${err.message}`, { bucket })
    return { error: err }
  }
}

export const createSignedUrl = async (bucket, objectPath, expiresInSec = 60 * 15) => {
  try {
    const result = await apiClient('/api/v2/storage/signed-url', {
      method: 'POST',
      body: { bucket, object_path: objectPath, expires_in: expiresInSec },
      dedupe: true
    })
    const url = result.payload?.data?.signed_url || result.data?.signed_url || ''
    return { data: { signedUrl: url }, error: null }
  } catch (err) {
    return { data: null, error: err }
  }
}

export { buildQueryString, apiFetch } from '../lib/supabase'

import { supabase } from '../lib/supabase'
export { supabase }
export const storage = supabase.storage
