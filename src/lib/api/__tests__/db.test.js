import { describe, it, expect, vi } from 'vitest'
import { apiFetch } from '../../supabase'

describe('API Client Request Formatting Tests', () => {
  it('payload table/action undefined ditolak secara lokal', async () => {
    const mockFetch = vi.fn()
    global.fetch = mockFetch

    const promise = apiFetch('/api/db', {
      method: 'POST',
      body: { table: undefined, action: undefined }
    })

    await expect(promise).rejects.toThrow('Missing table or action in /api/db payload')
  })
})
