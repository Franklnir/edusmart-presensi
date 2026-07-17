import { apiClient } from '../lib/api/client'

const responseData = (result) => result.payload?.data ?? result.data

export const academicPeriodService = {
  async list() {
    return responseData(await apiClient('/api/v2/academic-periods', {
      method: 'GET',
      cacheTtlMs: 60 * 1000,
      dedupe: true
    }))
  },

  async createCorrectionSession(payload) {
    return responseData(await apiClient('/api/v2/academic-periods/correction-sessions', {
      method: 'POST',
      body: payload
    }))
  },

  async closeCorrectionSession(sessionId) {
    return responseData(await apiClient(
      `/api/v2/academic-periods/correction-sessions/${sessionId}`,
      { method: 'DELETE' }
    ))
  },

  async preview(payload) {
    return responseData(await apiClient('/api/v2/academic-periods/preview', {
      method: 'POST',
      body: payload,
      timeoutMs: 30000
    }))
  },

  async apply(payload) {
    return responseData(await apiClient('/api/v2/academic-periods/apply', {
      method: 'POST',
      body: payload,
      timeoutMs: 30000
    }))
  },

  async restoreRoster(payload = {}) {
    return responseData(await apiClient('/api/v2/academic-periods/restore-roster', {
      method: 'POST',
      body: payload,
      timeoutMs: 30000
    }))
  },

  async copyStructure(payload) {
    return responseData(await apiClient('/api/v2/academic-periods/copy-structure', {
      method: 'POST',
      body: payload,
      timeoutMs: 30000
    }))
  },

  async getScheduleDecision(params = {}) {
    return responseData(await apiClient('/api/v2/academic-periods/schedule-decision', {
      method: 'GET',
      params,
      cacheTtlMs: 5000,
      dedupe: true
    }))
  },

  async resolveScheduleDecision(payload) {
    return responseData(await apiClient('/api/v2/academic-periods/schedule-decision', {
      method: 'POST',
      body: payload
    }))
  },

  async getRolloverExceptions(params = {}) {
    return responseData(await apiClient('/api/v2/academic-rollover-exceptions', {
      method: 'GET',
      params,
      cacheTtlMs: 5000,
      dedupe: true
    }))
  },

  async replaceRolloverExceptions(payload) {
    return responseData(await apiClient('/api/v2/academic-rollover-exceptions', {
      method: 'PUT',
      body: payload
    }))
  }
}
