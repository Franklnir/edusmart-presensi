export const parseSupabaseError = (err) => {
  const raw = err?.message || err?.error?.message || String(err || '')
  const msg = String(raw || '').toLowerCase()

  if (msg.includes('infinite recursion detected in policy') && msg.includes('objects')) {
    return {
      code: 'storage_policy_recursion',
      message:
        'Policy Storage bermasalah (infinite recursion). Periksa RLS pada storage.objects.'
    }
  }

  if (msg.includes('row-level security') || msg.includes('permission denied')) {
    return {
      code: 'rls_denied',
      message: 'Akses ditolak oleh policy RLS. Hubungi admin untuk perbaiki policy.'
    }
  }

  if (msg.includes('jwt') || msg.includes('token') || msg.includes('session')) {
    return {
      code: 'auth',
      message: 'Sesi login tidak valid. Silakan login ulang.'
    }
  }

  return { code: 'unknown', message: raw || 'Terjadi kesalahan' }
}
