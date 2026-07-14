import { beforeEach, describe, expect, it, vi } from 'vitest'

const logFrontendError = vi.fn()

vi.mock('../../api/client', () => ({ logFrontendError }))

describe('frontendErrorReporter', () => {
  beforeEach(() => {
    vi.resetModules()
    logFrontendError.mockReset()
    window.history.replaceState({}, '', '/guru/jadwal?token=browser-secret')
  })

  it('redacts sensitive browser error data and deduplicates the same error', async () => {
    const { installGlobalFrontendErrorReporter } = await import('../frontendErrorReporter')
    const uninstall = installGlobalFrontendErrorReporter()
    const error = new Error('Request failed at https://example.test/api?token=browser-secret')

    window.dispatchEvent(new ErrorEvent('error', {
      error,
      filename: 'https://example.test/assets/app.js',
      lineno: 12,
      colno: 4,
    }))
    window.dispatchEvent(new ErrorEvent('error', {
      error,
      filename: 'https://example.test/assets/app.js',
      lineno: 12,
      colno: 4,
    }))

    expect(logFrontendError).toHaveBeenCalledTimes(1)
    expect(logFrontendError).toHaveBeenCalledWith(
      'error',
      expect.stringContaining('token=[redacted]'),
      expect.objectContaining({
        route: `${window.location.origin}/guru/jadwal`,
        filename: 'https://example.test/assets/app.js',
        line: 12,
        column: 4,
      })
    )

    uninstall()
  })

  it('ignores extension errors outside the application boundary', async () => {
    const { installGlobalFrontendErrorReporter } = await import('../frontendErrorReporter')
    const uninstall = installGlobalFrontendErrorReporter()

    window.dispatchEvent(new ErrorEvent('error', {
      error: new Error('Extension failed'),
      filename: 'chrome-extension://example/content.js',
    }))

    expect(logFrontendError).not.toHaveBeenCalled()
    uninstall()
  })
})
