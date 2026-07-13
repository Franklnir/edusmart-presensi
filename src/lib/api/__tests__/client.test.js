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
    vi.clearAllMocks()
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
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ message: 'Server crash' })
    })

    try {
      const p = apiClient('/api/db')
      await vi.advanceTimersByTimeAsync(100)
      await p
    } catch (err) {
      expect(err.requestId).toBeDefined()
      expect(err.message).toBe('Server crash')
    }
  })
})
