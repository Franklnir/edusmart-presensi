export const parseSupabaseError = (err) => {
  const raw = err?.message || err?.error?.message || String(err || '')
  const msg = String(raw || '').toLowerCase()

  if (msg.includes('jwt') || msg.includes('token') || msg.includes('session')) {
    return {
      code: 'auth',
      message: 'Sesi login tidak valid. Silakan login ulang.'
    }
  }

  if (msg.includes('unauthenticated') || msg.includes('unauthorized')) {
    return {
      code: 'auth',
      message: 'Sesi login berakhir. Silakan login ulang.'
    }
  }

  if (msg.includes('akses') || msg.includes('forbidden')) {
    return {
      code: 'forbidden',
      message: 'Akses ditolak. Hubungi admin jika perlu.'
    }
  }

  return { code: 'unknown', message: raw || 'Terjadi kesalahan' }
}
