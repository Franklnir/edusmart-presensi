const normalizedHost = (value) => String(value || '').trim().toLowerCase()

export const isLocalApiHost = (host) => {
  const normalized = normalizedHost(host)
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '127.0.0.1.nip.io' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.127.0.0.1.nip.io')
  )
}

export const isWithinRootDomain = (host, rootDomain) => {
  const normalizedRuntimeHost = normalizedHost(host)
  const normalizedRoot = normalizedHost(rootDomain).replace(/^\.+|\.+$/g, '')
  if (!normalizedRuntimeHost || !normalizedRoot) return false

  return normalizedRuntimeHost === normalizedRoot || normalizedRuntimeHost.endsWith(`.${normalizedRoot}`)
}

export const isSuperAdminRuntimeHost = ({
  runtimeHost = typeof window !== 'undefined' ? window.location?.hostname : '',
  rootDomain = import.meta.env.VITE_ROOT_DOMAIN,
  adminSubdomain = import.meta.env.VITE_ADMIN_SUBDOMAIN || 'admin26'
} = {}) => {
  const runtime = normalizedHost(runtimeHost)
  const root = normalizedHost(rootDomain).replace(/^\.+|\.+$/g, '')
  const subdomain = normalizedHost(adminSubdomain).replace(/^\.+|\.+$/g, '')
  if (!runtime || !subdomain) return false

  if (root && runtime === `${subdomain}.${root}`) return true

  return isLocalApiHost(runtime) && (
    runtime === `${subdomain}.localhost` ||
    runtime === `${subdomain}.127.0.0.1.nip.io`
  )
}

export const resolveApiBaseUrl = ({
  rawApiUrl = import.meta.env.VITE_API_URL,
  rootDomain = import.meta.env.VITE_ROOT_DOMAIN,
  runtimeHost = typeof window !== 'undefined' ? window.location?.hostname : 'localhost',
  runtimeProtocol = typeof window !== 'undefined' ? window.location?.protocol : 'http:',
  defaultApiHost = runtimeHost
} = {}) => {
  const runtime = normalizedHost(runtimeHost) || 'localhost'
  const protocol = String(runtimeProtocol || 'http:').trim() || 'http:'
  const fallbackHost = normalizedHost(defaultApiHost) || runtime
  const fallback = isLocalApiHost(runtime)
    ? `http://${fallbackHost}:8000`
    : `${protocol}//${fallbackHost}`
  const input = String(rawApiUrl || '').trim()
  if (!input) return fallback

  try {
    const url = new URL(input)
    const apiHost = normalizedHost(url.hostname)

    if (isLocalApiHost(runtime) && isLocalApiHost(apiHost) && runtime !== apiHost) {
      url.hostname = runtime
    }

    if (
      !isLocalApiHost(runtime) &&
      isWithinRootDomain(runtime, rootDomain) &&
      isWithinRootDomain(apiHost, rootDomain) &&
      runtime !== apiHost
    ) {
      // Every production tenant host proxies /api to the same backend. Keeping
      // requests same-origin avoids unnecessary CORS preflights and preserves
      // the tenant hostname used by the backend resolver.
      url.hostname = runtime
    }

    return url.toString().replace(/\/$/, '')
  } catch {
    return input.replace(/\/$/, '')
  }
}

export const buildApiUrl = (path = '', options = {}) => {
  const baseUrl = resolveApiBaseUrl(options)
  try {
    return new URL(String(path || ''), `${baseUrl}/`).toString()
  } catch {
    return `${baseUrl}${String(path || '')}`
  }
}
