// src/lib/api/retry.js
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))

export const executeWithRetry = async (fn, options = {}) => {
  const maxRetries = options.maxRetries ?? 3
  const baseDelay = options.baseDelay ?? 1000
  let attempt = 0

  while (attempt <= maxRetries) {
    try {
      return await fn()
    } catch (error) {
      const status = error?.status || 0
      const isTransient = [408, 429, 502, 503, 504].includes(status) || error.name === 'TypeError' // fetch network error

      if (!isTransient || attempt >= maxRetries || error?.name === 'AbortError') {
        throw error
      }

      let delay = baseDelay * Math.pow(2, attempt)
      // Add jitter
      delay = delay + (Math.random() * 500)
      
      // Override with Retry-After if available
      if (status === 429 && error.retryAfter) {
        delay = Math.max(delay, parseInt(error.retryAfter) * 1000)
      }

      await wait(delay)
      attempt++
    }
  }
}
