import { apiClient } from '../lib/api/client'

const payload = (result) => result.payload || { data: result.data }

export const academicContextService = {
  async getActiveContext() {
    return payload(await apiClient('/api/v2/academic-context', {
      method: 'GET',
      cacheTtlMs: 60 * 1000,
      dedupe: true
    }))
  }
}
