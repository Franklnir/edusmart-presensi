// src/lib/api/errors.js

export class ApiError extends Error {
  constructor(message, status, code, details = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status || 0
    this.code = code || 'UNKNOWN_ERROR'
    this.details = details
    this.requestId = details.requestId || null
    this.retryAfter = details.retryAfter || null
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
