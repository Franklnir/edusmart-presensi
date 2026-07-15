import { apiClient } from '../lib/api/client';
import { generateRequestId } from '../lib/api/requestId'

const getAPIClient = () => {
  return {
    get: (url, config = {}) => apiClient('/api/v2' + url, { method: 'GET', ...config }),
    post: (url, body, config = {}) => apiClient('/api/v2' + url, { method: 'POST', body, ...config }),
    put: (url, body, config = {}) => apiClient('/api/v2' + url, { method: 'PUT', body, ...config }),
    delete: (url, config = {}) => apiClient('/api/v2' + url, { method: 'DELETE', ...config })
  }
}

export const USE_REPORT_CARDS_API_V2 = import.meta.env.VITE_USE_REPORT_CARDS_API_V2 === 'true'

export const reportCardService = {
  listReportCards: async (params = {}) => {
    const api = getAPIClient()
    const { data } = await api.get('/report-cards', { params })
    return data
  },

  getReportCard: async (studentId, params = {}) => {
    const api = getAPIClient()
    const { data } = await api.get(`/report-cards/${studentId}`, { params })
    return data
  },

  upsertItem: async (studentId, payload = {}, idempotencyKey = null) => {
    const api = getAPIClient()
    const key = idempotencyKey || generateRequestId()
    const { data } = await api.put(`/report-cards/${studentId}/items`, payload, {
      headers: { 'Idempotency-Key': key },
      params: {
        tahun_ajaran: payload.tahun_ajaran,
        semester: payload.semester
      }
    })
    return data
  },

  /**
   * Preview draft rapor (read-only, dinamis tanpa simpan DB)
   */
  previewReportCard: async (studentId, params = {}) => {
    const api = getAPIClient()
    const { data } = await api.get(`/report-cards/${studentId}/preview`, { params })
    return data
  },

  /**
   * Update metadata (sakit, izin, alpa, catatan) secara idempoten
   */
  updateMetadata: async (studentId, payload, idempotencyKey) => {
    const api = getAPIClient()
    const { data } = await api.put(`/report-cards/${studentId}/metadata`, payload, {
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}
    })
    return data
  },

  /**
   * Finalisasi rapor (bekukan nilai dan metadata)
   */
  finalizeReportCard: async (studentId, params = {}, idempotencyKey = null) => {
    const api = getAPIClient()
    const { data } = await api.post(`/report-cards/${studentId}/finalize`, null, {
      params,
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}
    })
    return data
  },

  /**
   * Terbitkan rapor ke siswa/wali
   */
  publishReportCard: async (studentId, params = {}, idempotencyKey = null) => {
    const api = getAPIClient()
    const { data } = await api.post(`/report-cards/${studentId}/publish`, null, {
      params,
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}
    })
    return data
  },

  /**
   * Buka kembali rapor (kembali ke draft)
   */
  reopenReportCard: async (studentId, params = {}, idempotencyKey = null) => {
    const api = getAPIClient()
    const { data } = await api.post(`/report-cards/${studentId}/reopen`, null, {
      params,
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}
    })
    return data
  },

  /**
   * Ambil data cetak rapor
   */
  printReportCard: async (studentId, params = {}) => {
    const api = getAPIClient()
    const { data } = await api.get(`/report-cards/${studentId}/print`, { params })
    return data
  }
}
