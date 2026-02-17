export const isEmailFormat = (value) => {
  const email = String(value || '').trim().toLowerCase()
  if (!email) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export const isImportedPlaceholderEmail = (value) =>
  /@import\.local$/i.test(String(value || '').trim())

export const hasRealLoginEmail = (value) =>
  isEmailFormat(value) && !isImportedPlaceholderEmail(value)

export const shouldForceAccountSetup = (profile, userEmail = '') => {
  const role = profile?.role
  if (role !== 'siswa' && role !== 'guru') return false
  if (profile?.must_change_password) return true
  const email = profile?.email || userEmail || ''
  return !hasRealLoginEmail(email)
}
