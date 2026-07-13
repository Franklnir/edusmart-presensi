import { apiClient } from '../../../lib/api/client'
import { buildQueryString } from '../../../lib/supabase'

export const studentService = {
  async getStudents(params = {}) {
    const res = await apiClient(`/api/v2/students${buildQueryString(params)}`, {
      method: 'GET',
      cacheTtlMs: 5000, // Short cache for active operations
      dedupe: true
    })
    return res
  },

  async getStudent(id) {
    const res = await apiClient(`/api/v2/students/${id}`, {
      method: 'GET',
      cacheTtlMs: 5000,
      dedupe: true
    })
    return res
  },

  async createStudent(payload) {
    const res = await apiClient('/api/v2/students', {
      method: 'POST',
      body: payload
    })
    return res
  },

  async updateStudent(id, payload) {
    const res = await apiClient(`/api/v2/students/${id}`, {
      method: 'PUT',
      body: payload
    })
    return res
  },

  async deleteStudent(id) {
    const res = await apiClient(`/api/v2/students/${id}`, {
      method: 'DELETE'
    })
    return res
  }
}
