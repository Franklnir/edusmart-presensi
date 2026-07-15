// src/lib/api/sanitizer.js

const SENSITIVE_KEYS = ['password', 'token', 'authorization', 'cookie', 'secret', 'refresh_token', 'access_token', 'xsrf-token', 'answer_key', 'rfid_uid', 'signed_url']

export const sanitizePayload = (payload, depth = 0) => {
  if (!payload || typeof payload !== 'object') return payload
  if (depth > 4) return '[TRUNCATED]'

  if (Array.isArray(payload)) {
    return payload.slice(0, 50).map((value) => sanitizePayload(value, depth + 1))
  }

  const sanitized = {}
  for (const [key, value] of Object.entries(payload).slice(0, 100)) {
    const isSensitive = SENSITIVE_KEYS.some(sk => key.toLowerCase().includes(sk))
    if (isSensitive) {
      sanitized[key] = '[REDACTED]'
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizePayload(value, depth + 1)
    } else {
      sanitized[key] = value
    }
  }
  return sanitized
}

export const sanitizeObservabilityContext = (payload) => sanitizePayload(payload)
