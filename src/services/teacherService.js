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

  async listAllTeacherOptions(params = {}) {
    const rows = []
    const perPage = 100
    let page = 1
    let lastPage = 1

    do {
      const result = await apiClient('/api/v2/teachers', {
        method: 'GET',
        params: { ...params, per_page: perPage, page }
      })
      const payload = result.payload || { data: result.data }
      rows.push(...(payload.data || []))
      lastPage = Math.max(1, Number(payload.meta?.last_page) || 1)
      page += 1
    } while (page <= lastPage)

    return rows
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
