import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { apiClient } from '../client'
import { useAuthStore } from '../../../store/useAuthStore'

// Mock fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock auth store
vi.mock('../../../store/useAuthStore', () => ({
  useAuthStore: {
    getState: vi.fn(() => ({ authState: 'authenticated' })),
  }
}))

describe('API Client Regression Tests', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    useAuthStore.getState.mockReset()
    useAuthStore.getState.mockReturnValue({ authState: 'authenticated' })
    vi.useFakeTimers()
  })
  
  afterEach(() => {
    vi.useRealTimers()
  })

  it('auth loading tidak memanggil /api/db langsung (menunggu)', async () => {
    useAuthStore.getState.mockReturnValue({ authState: 'loading' })
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ data: 'ok' })
    })

    const promise = apiClient('/api/db')
    
    // Fast-forward initial wait
    await vi.advanceTimersByTimeAsync(300)
    expect(mockFetch).not.toHaveBeenCalled()
    
    // Simulate auth loaded
    useAuthStore.getState.mockReturnValue({ authState: 'authenticated' })
    await vi.advanceTimersByTimeAsync(3000)
    
    await promise
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('400/401/403/404/409/422 tidak di-retry', async () => {
    useAuthStore.getState.mockReturnValue({ authState: 'authenticated' })
    const statuses = [400, 401, 403, 404, 409, 422]
    
    for (const status of statuses) {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ message: 'Error' })
      })
      
      await expect(apiClient('/api/db')).rejects.toThrow()
      expect(mockFetch).toHaveBeenCalledTimes(1)
      mockFetch.mockClear()
    }
  })

  it('request deduplication benar-benar bekerja untuk GET', async () => {
    useAuthStore.getState.mockReturnValue({ authState: 'authenticated' })
    mockFetch.mockImplementation(async () => {
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve({
            ok: true,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: 'dedup' })
          })
        }, 100)
      })
    })

    // Fire 3 simultaneous GET requests
    const p1 = apiClient('/api/users')
    const p2 = apiClient('/api/users')
    const p3 = apiClient('/api/users')
    
    await vi.advanceTimersByTimeAsync(150)
    const results = await Promise.all([p1, p2, p3])
    
    expect(results[0].data).toBe('dedup')
    expect(results[1].data).toBe('dedup')
    expect(results[2].data).toBe('dedup')
    
    // Fetch should only be called ONCE
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('request ID tampil pada error', async () => {
    useAuthStore.getState.mockReturnValue({ authState: 'authenticated' })
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers({
          'content-type': 'application/json',
          'X-Request-ID': '22222222-2222-4222-8222-222222222222'
        }),
        json: async () => ({ message: 'Server crash' })
      })
      // Fire-and-forget frontend logger must settle without recursion.
      .mockResolvedValueOnce({ ok: true })
      // A second request to the same URL proves failed GET deduplication is cleared.
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: 'recovered' })
      })

    const requestPath = '/api/db?request-id-test=1'
    const rejectedRequest = apiClient(requestPath, { maxRetries: 0 })
    await expect(rejectedRequest).rejects.toMatchObject({
      name: 'ApiError',
      status: 500,
      message: 'Server crash',
      requestId: '22222222-2222-4222-8222-222222222222'
    })

    const recovered = await apiClient(requestPath, { maxRetries: 0 })
    expect(recovered.data).toBe('recovered')

    const dbCalls = mockFetch.mock.calls.filter(([url]) => new URL(url).pathname === '/api/db')
    const loggerCalls = mockFetch.mock.calls.filter(([url]) => new URL(url).pathname === '/api/v2/frontend-logs')
    expect(dbCalls).toHaveLength(2)
    expect(loggerCalls).toHaveLength(1)
  })

  it('AbortController membatalkan request saat unmount', async () => {
    useAuthStore.getState.mockReturnValue({ authState: 'authenticated' })
    mockFetch.mockImplementation(async (url, { signal }) => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => resolve({
          ok: true,
          headers: new Headers(),
          json: async () => ({}),
          text: async () => ''
        }), 500)
        signal.addEventListener('abort', () => {
          clearTimeout(timeout)
          const error = new Error('The operation was aborted.')
          error.name = 'AbortError'
          reject(error)
        })
      })
    })

    const controller = new AbortController()
    const p = apiClient('/api/test', { signal: controller.signal })

    controller.abort()

    await expect(p).rejects.toThrow('Request dibatalkan')
  })
})
