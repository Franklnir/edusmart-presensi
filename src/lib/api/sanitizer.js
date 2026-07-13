// src/lib/api/sanitizer.js

const SENSITIVE_KEYS = ['password', 'token', 'authorization', 'cookie', 'secret', 'refresh_token', 'access_token', 'xsrf-token']

export const sanitizePayload = (payload) => {
  if (!payload || typeof payload !== 'object') return payload

  if (Array.isArray(payload)) {
    return payload.map(sanitizePayload)
  }

  const sanitized = {}
  for (const [key, value] of Object.entries(payload)) {
    const isSensitive = SENSITIVE_KEYS.some(sk => key.toLowerCase().includes(sk))
    if (isSensitive) {
      sanitized[key] = '[REDACTED]'
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizePayload(value)
    } else {
      sanitized[key] = value
    }
  }
  return sanitized
}
