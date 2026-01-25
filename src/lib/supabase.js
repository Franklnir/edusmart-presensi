// src/lib/supabase.js
import { createClient } from '@supabase/supabase-js'

/* ===================== ENV ===================== */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// ⚠️ Ingat: semua env dengan prefix VITE_ akan KE-EMBED ke frontend.
// Jangan pernah taruh service_role di sini.
if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Supabase env belum diset. Pastikan ada VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY di .env'
  )
}

/* ===================== BUCKETS ===================== */
// ✅ Kasih default biar nggak "undefined" kalau env lupa diset
export const ASSIGNMENT_BUCKET =
  import.meta.env.VITE_SUPABASE_BUCKET || 'assignments'

export const PROFILE_BUCKET =
  import.meta.env.VITE_SUPABASE_PROFILE_BUCKET || 'profile-photos'

export const CERT_BUCKET =
  import.meta.env.VITE_SUPABASE_CERT_BUCKET || 'certificates'

// bucket template sertifikat (PNG dari Canva)
export const CERT_TEMPLATE_BUCKET =
  import.meta.env.VITE_SUPABASE_CERT_TEMPLATE_BUCKET || 'certificate-templates'

/* ===================== CLIENT ===================== */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true // OK untuk magic link / reset password
  }
})

/* ===================== STORAGE HELPERS ===================== */
/**
 * Cek sederhana apakah string adalah URL http(s)
 */
const isHttpUrl = (v) => typeof v === 'string' && /^https?:\/\//i.test(v)

/**
 * Ambil objectPath dari:
 * - path biasa: "tugas_lampiran/uid-123.pdf"
 * - public url: ".../object/public/<bucket>/<path>"
 * - signed url: ".../object/sign/<bucket>/<path>?token=..."
 *
 * Return: "<path>" (tanpa bucket)
 */
export const extractObjectPath = (bucket, urlOrPath) => {
  if (!urlOrPath || typeof urlOrPath !== 'string') return ''

  // sudah path biasa
  if (!isHttpUrl(urlOrPath)) return urlOrPath.replace(/^\/+/, '')

  try {
    const u = new URL(urlOrPath)
    const parts = u.pathname.split('/').filter(Boolean)

    // cari posisi bucket di path
    const bucketIdx = parts.indexOf(bucket)
    if (bucketIdx === -1) return ''

    return parts.slice(bucketIdx + 1).join('/')
  } catch {
    return ''
  }
}

/**
 * Buat signed URL dari objectPath (bucket private recommended)
 * expiresInSec default 15 menit
 */
export const createSignedUrl = async (bucket, objectPath, expiresInSec = 60 * 15) => {
  if (!bucket) throw new Error('Bucket belum diset')
  if (!objectPath) throw new Error('Object path kosong')

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(objectPath, expiresInSec)

  if (error) throw error
  if (!data?.signedUrl) throw new Error('Signed URL tidak tersedia')
  return data.signedUrl
}

/**
 * Convenience: terima input urlOrPath (url atau path),
 * return signed URL.
 */
export const getSignedUrlForValue = async (bucket, urlOrPath, expiresInSec = 60 * 15) => {
  const objectPath = extractObjectPath(bucket, urlOrPath)
  if (!objectPath) throw new Error('Path tidak valid')
  return createSignedUrl(bucket, objectPath, expiresInSec)
}

/**
 * Hapus object dari bucket, aman untuk input url atau path
 */
export const removeStorageObject = async (bucket, urlOrPath) => {
  const objectPath = extractObjectPath(bucket, urlOrPath)
  if (!objectPath) return { ok: false, error: new Error('Path tidak valid') }

  const { error } = await supabase.storage.from(bucket).remove([objectPath])
  if (error) return { ok: false, error }
  return { ok: true, error: null }
}
