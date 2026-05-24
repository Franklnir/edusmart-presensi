const normalizeHost = (host = '') => String(host || '').trim().toLowerCase().split(':')[0]

export const getRootDomain = () => (
  String(import.meta.env.VITE_ROOT_DOMAIN || 'sismu.biz.id').trim().toLowerCase()
)

export const getAdminSubdomain = () => (
  String(import.meta.env.VITE_ADMIN_SUBDOMAIN || 'admin26').trim().toLowerCase()
)

export const isMarketingRootHost = (host = '') => {
  const runtimeHost = normalizeHost(
    host || (typeof window !== 'undefined' ? window.location.hostname : '')
  )
  const rootDomain = getRootDomain()

  if (!runtimeHost || !rootDomain) return false

  return runtimeHost === rootDomain || runtimeHost === `www.${rootDomain}`
}

export const isMarketingLandingPath = (path = '', host = '') => {
  const normalizedPath = String(path || '/').split('?')[0].split('#')[0] || '/'

  if (normalizedPath === '/landing') return true
  return normalizedPath === '/' && isMarketingRootHost(host)
}
