import { apiClient } from '../lib/api/client'

const monitoringService = {
  async listSuperLogs(params = {}) {
    const { data } = await apiClient('/api/super/monitoring/logs', {
      method: 'GET',
      params
    })
    return data
  },

  async getSuperLog(id) {
    const { data } = await apiClient(`/api/super/monitoring/logs/${encodeURIComponent(id)}`, {
      method: 'GET'
    })
    return data
  }
}

export default monitoringService
