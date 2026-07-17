import { apiClient } from '../../../lib/api/client'
import { generateRequestId } from '../../../lib/api/requestId'

const idempotencyKey = () => generateRequestId()

const mutationOptions = (method, body) => {
  const key = idempotencyKey()
  return {
    method,
    headers: { 'Idempotency-Key': key },
    body: { ...body, idempotency_key: key }
  }
}

export const studentService = {
  async getStudents(params = {}) {
    const result = await apiClient('/api/v2/students', {
      method: 'GET',
      params,
      cacheTtlMs: 5000,
      dedupe: true
    })
    const payload = result.payload || {}
    const meta = payload.meta || {}

    return {
      data: {
        rows: Array.isArray(payload.data) ? payload.data : [],
        kelas: payload.kelas || [],
        struktur: payload.struktur || [],
        wali_kelas_ids: payload.wali_kelas_ids || [],
        stats: payload.stats || null,
        meta: {
          page: meta.current_page || 1,
          per_page: meta.per_page || params.per_page || 25,
          total: meta.total || 0,
          page_count: meta.last_page || 1,
          from: meta.from || 0,
          to: meta.to || 0
        }
      }
    }
  },

  async getStudent(id) {
    const result = await apiClient(`/api/v2/students/${id}`, {
      method: 'GET',
      cacheTtlMs: 5000,
      dedupe: true
    })
    const payload = result.payload || {}

    return {
      data: payload.data || result.data,
      org_member: payload.org_member || [],
      osis: payload.osis || null
    }
  },

  async createStudent(payload) {
    const result = await apiClient('/api/v2/students', mutationOptions('POST', payload))
    return { data: result.data }
  },

  async updateStudent(id, payload) {
    const result = await apiClient(`/api/v2/students/${id}`, mutationOptions('PATCH', payload))
    return { data: result.data }
  },

  async deactivateStudent(id, reason = 'nonaktif') {
    const result = await apiClient(
      `/api/v2/students/${id}/deactivate`,
      mutationOptions('PATCH', { reason })
    )
    return { data: result.data }
  },

  async activateStudent(id) {
    const result = await apiClient(
      `/api/v2/students/${id}/activate`,
      mutationOptions('PATCH', {})
    )
    return { data: result.data }
  }
}
