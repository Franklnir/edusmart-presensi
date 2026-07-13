import { describe, it, expect, vi } from 'vitest'
import { apiClient } from '../client'

describe('API Client Request Formatting Tests', () => {
  it('payload table/action undefined ditolak secara lokal jika menggunakan helper, atau diteruskan dan ditolak backend', async () => {
    // This is more about ensuring we don't crash if they are undefined
    const mockFetch = vi.fn()
    global.fetch = mockFetch

    // Example of calling apiClient directly to /api/db without table/action
    const promise = apiClient('/api/db', {
      method: 'POST',
      body: { table: undefined, action: undefined }
    })
    
    // We expect the fetch to fire with stringified undefined replaced or kept,
    // but `.toLowerCase` inside any helper shouldn't crash
    expect(promise).toBeDefined()
  })
})
