import { apiClient } from '../lib/api/client'

const responsePayload = (result) => result.payload || { data: result.data }

export const adminDashboardService = {
  async getDashboard(params = {}) {
    return responsePayload(await apiClient('/api/v2/dashboard/admin', {
      method: 'GET',
      params,
      cacheTtlMs: 15 * 1000,
      dedupe: true
    }))
  }
}
