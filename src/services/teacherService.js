import { apiClient } from '../lib/api/client'
import { buildQueryString } from '../lib/supabase'

export const teacherService = {
  async getTeachers(params = {}) {
    const res = await apiClient(`/api/v2/teachers${buildQueryString(params)}`, {
      method: 'GET',
      cacheTtlMs: 5000,
      dedupe: true
    })
    return res
  },

  async getTeacher(id) {
    const res = await apiClient(`/api/v2/teachers/${id}`, {
      method: 'GET',
      cacheTtlMs: 5000,
      dedupe: true
    })
    return res
  },

  async createTeacher(payload) {
    const res = await apiClient('/api/v2/teachers', {
      method: 'POST',
      body: payload
    })
    return res
  },

  async updateTeacher(id, payload) {
    const res = await apiClient(`/api/v2/teachers/${id}`, {
      method: 'PUT',
      body: payload
    })
    return res
  },

  async deleteTeacher(id) {
    const res = await apiClient(`/api/v2/teachers/${id}`, {
      method: 'DELETE'
    })
    return res
  }
}
