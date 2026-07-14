import { apiClient } from '../lib/api/client'
import { generateRequestId } from '../lib/api/requestId'

const responsePayload = (result) => result.payload || { data: result.data }

const mutationOptions = (method, body = {}) => {
  const key = body.idempotency_key || generateRequestId()
  return {
    method,
    headers: { 'Idempotency-Key': key },
    body: { ...body, idempotency_key: key }
  }
}

export const attendanceService = {
  async getAttendances(params = {}) {
    return responsePayload(await apiClient('/api/v2/attendance', { method: 'GET', params }))
  },

  async storeAttendance(data) {
    return responsePayload(await apiClient('/api/v2/attendance', mutationOptions('POST', data)))
  },

  async updateAttendance(id, data) {
    return responsePayload(await apiClient(`/api/v2/attendance/${id}`, mutationOptions('PATCH', data)))
  },

  async getAttendanceRequests(params = {}) {
    return responsePayload(await apiClient('/api/v2/attendance-requests', { method: 'GET', params }))
  },

  async storeAttendanceRequest(data) {
    return responsePayload(await apiClient('/api/v2/attendance-requests', mutationOptions('POST', data)))
  },

  async updateAttendanceRequest(id, data) {
    return responsePayload(await apiClient(
      `/api/v2/attendance-requests/${id}`,
      mutationOptions('PATCH', data)
    ))
  },

  async deleteAttendanceRequest(id) {
    return responsePayload(await apiClient(
      `/api/v2/attendance-requests/${id}`,
      mutationOptions('DELETE')
    ))
  }
}
