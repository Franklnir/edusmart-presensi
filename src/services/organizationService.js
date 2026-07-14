import { apiClient } from '../lib/api/client'

const responsePayload = (result) => result.payload || { data: result.data }

export const organizationService = {
  async getContext() {
    return responsePayload(await apiClient('/api/v2/organizations', {
      method: 'GET',
      cacheTtlMs: 60 * 1000,
      dedupe: true
    }))
  }
}
