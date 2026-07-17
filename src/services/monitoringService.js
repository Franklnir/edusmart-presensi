import { apiClient, logFrontendError } from '../lib/api/client'
import adminService from './adminService'

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
  },

  async adminMonitoring() {
    const { data, error } = await adminService.monitoring()
    if (error) {
      logFrontendError('error', `Admin monitoring error: ${error.message}`, { code: error.code })
      throw error
    }
    return data
  }
}

export default monitoringService
