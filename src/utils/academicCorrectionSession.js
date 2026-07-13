const STORAGE_KEY = 'sismu.academicCorrectionSession'

export const readAcademicCorrectionSession = (tenantId = '') => {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const session = JSON.parse(raw)
    const expiresAt = Date.parse(session?.expires_at || '')
    const expectedTenantId = String(tenantId || '')
    const sessionTenantId = String(session?.tenant_id || '')
    if (
      !session?.id ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now() ||
      (expectedTenantId && sessionTenantId !== expectedTenantId)
    ) {
      window.sessionStorage.removeItem(STORAGE_KEY)
      return null
    }

    return session
  } catch (error) {
    window.sessionStorage.removeItem(STORAGE_KEY)
    return null
  }
}

export const writeAcademicCorrectionSession = (session, tenantId = '') => {
  if (typeof window === 'undefined') return
  if (!session?.id) {
    window.sessionStorage.removeItem(STORAGE_KEY)
    return
  }
  const scopedSession = tenantId && !session.tenant_id
    ? { ...session, tenant_id: String(tenantId) }
    : session
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(scopedSession))
}

export const clearAcademicCorrectionSession = () => {
  if (typeof window !== 'undefined') window.sessionStorage.removeItem(STORAGE_KEY)
}
