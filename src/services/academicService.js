import { apiClient } from '../lib/api/client'

export const subjectService = {
  async getSubjects(params = {}) {
    const res = await apiClient('/api/v2/subjects', {
      method: 'GET',
      params,
      cacheTtlMs: 10 * 1000,
      dedupe: true
    })
    return res
  },

  async createSubject(payload) {
    const res = await apiClient('/api/v2/subjects', {
      method: 'POST',
      body: payload
    })
    return res
  },

  async deleteSubject(id) {
    const res = await apiClient(`/api/v2/subjects/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    })
    return res
  }
}

export const jamKosongService = {
  async getJamKosong(params = {}) {
    const res = await apiClient('/api/v2/jam-kosong', {
      method: 'GET',
      params,
      cacheTtlMs: 10 * 1000,
      dedupe: true
    })
    return res
  },

  async createJamKosong(payload) {
    const res = await apiClient('/api/v2/jam-kosong', {
      method: 'POST',
      body: payload
    })
    return res
  },

  async deleteJamKosong(id) {
    const res = await apiClient(`/api/v2/jam-kosong/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    })
    return res
  }
}
