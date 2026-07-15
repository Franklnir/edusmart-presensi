// src/lib/api/errors.js

export class ApiError extends Error {
  constructor(message, status, code, details = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status || 0
    this.code = code || 'UNKNOWN_ERROR'
    this.details = details.details || details
    this.requestId = details.requestId || null
    this.retryAfter = details.retryAfter || null
    this.isNetworkError = this.status === 0
    this.isValidationError = this.status === 422 || this.code === 'VALIDATION_FAILED'
    this.isUnauthorized = this.status === 401 || this.code === 'AUTH_UNAUTHENTICATED'
    this.isConflict = this.status === 409 || this.code === 'CONFLICT'
    this.raw = details.raw || null
  }
}

export const makeError = (message, status, code, details = {}) => {
  return new ApiError(message || 'An error occurred', status, code, details)
}

export const isTransientError = (status) => {
  return [408, 429, 502, 503, 504].includes(status)
}

export const isAbortError = (error) => {
  return error?.name === 'AbortError' || error?.code === 'REQUEST_ABORTED'
}

export const isNetworkError = (error) => Boolean(error?.isNetworkError || error?.status === 0)

export const isUnauthorizedError = (error) => Boolean(error?.isUnauthorized || error?.status === 401)

export const getApiErrorMessage = (error, fallback = 'Permintaan tidak dapat diproses.') => {
  if (!error || isAbortError(error)) return fallback
  const message = String(error.message || '').trim()
  return message && message.length <= 240 ? message : fallback
}

export const API_UNAUTHORIZED_EVENT = 'edusmart:api-unauthorized'
