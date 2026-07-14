import { apiFetch } from '../lib/supabase'

export const subjectService = {
  async getSubjects(params = {}) {
    const searchParams = new URLSearchParams(params)
    return await apiFetch(`/api/v2/subjects?${searchParams.toString()}`)
  },

  async createSubject(payload) {
    return await apiFetch('/api/v2/subjects', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  },

  async deleteSubject(id) {
    return await apiFetch(`/api/v2/subjects/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    })
  }
}

export const jamKosongService = {
  async getJamKosong(params = {}) {
    const searchParams = new URLSearchParams(params)
    return await apiFetch(`/api/v2/jam-kosong?${searchParams.toString()}`)
  },

  async createJamKosong(payload) {
    return await apiFetch('/api/v2/jam-kosong', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  },

  async deleteJamKosong(id) {
    return await apiFetch(`/api/v2/jam-kosong/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    })
  }
}
