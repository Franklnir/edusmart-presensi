import { apiClient } from '../lib/api/client'
import { generateRequestId } from '../lib/api/requestId'

export const attendanceService = {
  /**
   * Fetch attendances with optional filters
   */
  async getAttendances(params = {}) {
    try {
      const response = await apiClient.get('/api/v2/attendance', {
        params,
        headers: {
          'X-Request-ID': generateRequestId()
        }
      })
      return response.data
    } catch (error) {
      console.error('Error fetching attendances:', error)
      throw error
    }
  },

  /**
   * Store/Upsert an attendance
   */
  async storeAttendance(data) {
    try {
      const response = await apiClient.post('/api/v2/attendance', data, {
        headers: {
          'X-Request-ID': generateRequestId()
        }
      })
      return response.data
    } catch (error) {
      console.error('Error storing attendance:', error)
      throw error
    }
  },

  /**
   * Update an attendance record
   */
  async updateAttendance(id, data) {
    try {
      const response = await apiClient.patch(`/api/v2/attendance/${id}`, data, {
        headers: {
          'X-Request-ID': generateRequestId()
        }
      })
      return response.data
    } catch (error) {
      console.error('Error updating attendance:', error)
      throw error
    }
  },

  /**
   * Delete an attendance record
   */
  async deleteAttendance(id) {
    try {
      const response = await apiClient.delete(`/api/v2/attendance/${id}`, {
        headers: {
          'X-Request-ID': generateRequestId()
        }
      })
      return response.data
    } catch (error) {
      console.error('Error deleting attendance:', error)
      throw error
    }
  }
}
