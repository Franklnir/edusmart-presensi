import { logFrontendError } from '../api/client'
import { getLastRequestId } from '../api/requestId'

const MAX_EVENTS_PER_WINDOW = 10
const WINDOW_MS = 60_000
const DEDUPE_MS = 30_000
const recentEvents = new Map()
let sentInWindow = 0
let windowStartedAt = 0
let installed = false

const safeRoute = () => {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}${window.location.pathname}`
}

const normalizeMessage = (value) => String(value || 'Unknown browser error')
  .replace(/(bearer\s+)[^\s]+/ig, '$1[redacted]')
  .replace(/([?&](?:token|code|signature|key|secret|password)=)[^&#\s]+/ig, '$1[redacted]')
  .slice(0, 900)

const shouldIgnore = ({ message, filename }) => {
  const source = String(filename || '')
  const normalized = String(message || '').toLowerCase()

  return source.startsWith('chrome-extension://')
    || source.startsWith('moz-extension://')
    || normalized.includes('resizeobserver loop limit exceeded')
    || normalized.includes('request dibatalkan')
    || normalized.includes('the user aborted a request')
}

const maySend = (fingerprint) => {
  const now = Date.now()
  if (now - windowStartedAt >= WINDOW_MS) {
    windowStartedAt = now
    sentInWindow = 0
  }

  if (sentInWindow >= MAX_EVENTS_PER_WINDOW) return false
  if (now - (recentEvents.get(fingerprint) || 0) < DEDUPE_MS) return false

  sentInWindow += 1
  recentEvents.set(fingerprint, now)
  return true
}

const report = ({ type, error, filename = '', line = 0, column = 0 }) => {
  const message = normalizeMessage(error?.message || error)
  const name = normalizeMessage(error?.name || 'Error').slice(0, 120)

  if (shouldIgnore({ message, filename })) return

  const fingerprint = [type, name, message, filename, line, column].join('|')
  if (!maySend(fingerprint)) return

  logFrontendError('error', `Browser ${type}: ${message}`, {
    source: 'global-browser-reporter',
    event_type: type,
    error_name: name,
    route: safeRoute(),
    requestId: getLastRequestId(),
    filename: normalizeMessage(filename).slice(0, 500),
    line: Number(line) || 0,
    column: Number(column) || 0
  })
}

export const installGlobalFrontendErrorReporter = () => {
  if (typeof window === 'undefined' || installed) return () => {}
  installed = true

  const onError = (event) => {
    report({
      type: 'error',
      error: event.error || event.message,
      filename: event.filename,
      line: event.lineno,
      column: event.colno
    })
  }

  const onUnhandledRejection = (event) => {
    const reason = event.reason
    report({
      type: 'unhandledrejection',
      error: reason instanceof Error ? reason : { message: reason, name: 'UnhandledRejection' }
    })
  }

  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onUnhandledRejection)

  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onUnhandledRejection)
    installed = false
  }
}
