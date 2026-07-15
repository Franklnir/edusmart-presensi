// src/lib/api/client.js
import { generateRequestId, isValidRequestId, setLastRequestId } from './requestId'
import { API_UNAUTHORIZED_EVENT, makeError } from './errors'
import { executeWithRetry } from './retry'
import { useAuthStore } from '../../store/useAuthStore'
import { sanitizeObservabilityContext } from './sanitizer'

export const DEFAULT_TIMEOUT_MS = 15000

export const logFrontendError = (level, message, context = {}) => {
  if (context?.url && context.url.includes('/frontend-logs')) return
  try {
    const API_URL = import.meta.env.VITE_API_URL || ''
    const url = new URL('/api/v2/frontend-logs', API_URL).toString()
    
    // The reporter call is its own HTTP request. Keep the failed request ID
    // inside sanitized context, but never reuse it as the transport ID.
    const requestId = generateRequestId()
    const route = typeof window !== 'undefined' ? window.location.pathname : ''
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Request-ID': requestId,
        'X-Client-Consumer': 'frontend-error-reporter',
        'X-Frontend-Route': route
      },
      credentials: 'omit', 
      body: JSON.stringify({
        level,
        message: String(message || 'Frontend error').slice(0, 1000),
        context: sanitizeObservabilityContext(context),
        url: typeof window !== 'undefined' ? `${window.location.origin}${route}` : route,
        request_id: requestId,
        error_code: context?.code || null,
        status: Number.isFinite(Number(context?.status)) ? Number(context.status) : null,
        route
      })
    }).catch(() => {}) // fire and forget
  } catch {
    // silently fail
  }
}

// In-flight request deduplication map
const pendingRequests = new Map()

export const apiClient = async (path, options = {}) => {
  const method = (options.method || 'GET').toUpperCase()
  const headers = new Headers(options.headers || {})
  
  // Base Accept and Content-Type
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json')
  }
  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }
  }

  // Request ID
  const requestId = generateRequestId()
  headers.set('X-Request-ID', requestId)
  setLastRequestId(requestId)
  if (options.correlationId) headers.set('X-Correlation-ID', options.correlationId)

  // Wait if auth is currently loading, to avoid unauthenticated requests before bootstrap
  if (useAuthStore.getState().authState === 'loading') {
    // Only wait briefly; we don't want to block indefinitely
    let waits = 0
    while (useAuthStore.getState().authState === 'loading' && waits < 10) {
      await new Promise(r => setTimeout(r, 200))
      waits++
    }
  }

  // AbortController setup
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort('timeout'), options.timeoutMs || DEFAULT_TIMEOUT_MS)
  
  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort('external'))
  }

  const fetchOptions = {
    method,
    headers,
    signal: controller.signal,
    credentials: 'omit', // CSRF handled by Sanctum automatically with cookies? Wait, Sanctum needs 'include'.
    // If we use same-site cookies, credentials must be 'include'
  }

  // Assuming API URL from Vite env
  const API_URL = import.meta.env.VITE_API_URL || ''
  let urlObj = null
  try {
    urlObj = new URL(path, API_URL)
  } catch {
    urlObj = new URL(path, window.location.origin)
  }

  if (options.params) {
    Object.entries(options.params).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== '') {
        urlObj.searchParams.append(key, val)
      }
    })
  }
  let url = urlObj.toString()

  // For Sanctum, ensure withCredentials is true
  fetchOptions.credentials = 'include'

  if (options.body) {
    fetchOptions.body = options.body instanceof FormData 
      ? options.body 
      : JSON.stringify(options.body)
  }

  // Deduplication logic for GET requests
  const cacheKey = method === 'GET' ? `${method}:${url}` : null
  if (cacheKey && pendingRequests.has(cacheKey)) {
    return pendingRequests.get(cacheKey)
  }

  const doFetch = async () => {
    try {
      const response = await fetch(url, fetchOptions)
      let data = null
      
      const responseHeaders = response.headers || new Headers()
      const contentType = responseHeaders.get('content-type')
      if (contentType && contentType.includes('application/json')) {
        data = await response.json()
      } else {
        data = typeof response.text === 'function' ? await response.text() : null
      }

      if (!response.ok) {
        const responseHeader = responseHeaders.get('X-Request-ID')
        const responseRequestId = isValidRequestId(responseHeader) ? responseHeader : requestId
        setLastRequestId(responseRequestId)
        if (response.status === 401 && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent(API_UNAUTHORIZED_EVENT, {
            detail: { requestId: responseRequestId, path }
          }))
        }
        throw makeError(
          data?.message || data?.error || 'API Request Failed', 
          response.status, 
          data?.code || (response.status === 401 ? 'AUTH_UNAUTHENTICATED' : undefined),
          { requestId: responseRequestId, details: data?.details || data?.errors || {}, raw: data, retryAfter: responseHeaders.get('Retry-After') }
        )
      }

      const responseHeader = responseHeaders.get('X-Request-ID')
      const resolvedRequestId = isValidRequestId(responseHeader) ? responseHeader : requestId
      setLastRequestId(resolvedRequestId)
      return { data: data?.data ?? data, payload: data, response, requestId: resolvedRequestId }
    } catch (error) {
      if (error.name === 'AbortError') {
        throw makeError('Request dibatalkan', 0, 'REQUEST_ABORTED', { requestId })
      }
      throw error
    }
  }

  // Determine if we should retry
  let shouldRetry = true
  if (method !== 'GET' && method !== 'HEAD') {
    // Only retry mutations if they provide an Idempotency-Key
    if (!headers.has('Idempotency-Key')) {
      shouldRetry = false
    }
  }
  const maxRetries = shouldRetry ? (options.maxRetries ?? 2) : 0

  const promise = (async () => {
    try {
      const result = await executeWithRetry(doFetch, {
        maxRetries: maxRetries,
      })
      clearTimeout(timeoutId)
      return result
    } catch (error) {
      clearTimeout(timeoutId)
      const errorRequestId = error.requestId || requestId
      let safePath = String(path).split('?')[0]
      try {
        safePath = new URL(url).pathname
      } catch {
        // Keep the already query-free fallback path.
      }
      console.error(`[API Error] ${method} ${safePath} - ${error.status} - ID: ${errorRequestId}`)
      if (error.status >= 500 || error.status === 0 || error.code === 'REQUEST_ABORTED') {
          logFrontendError('error', `API Call Failed: ${method} ${path}`, {
            status: error.status,
            code: error.code,
            requestId: errorRequestId,
            errorMessage: error.message
          });
      }
      throw error
    } finally {
      if (cacheKey) {
        pendingRequests.delete(cacheKey)
      }
    }
  })()

  if (cacheKey) {
    pendingRequests.set(cacheKey, promise)
  }

  return promise
}

export default apiClient
