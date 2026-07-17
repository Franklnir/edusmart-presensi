import { apiClient } from '../lib/api/client'

const responseData = (result) => result.payload?.data ?? result.data

export const classService = {
  async list(params = {}) {
    return responseData(await apiClient('/api/v2/classes', {
      method: 'GET',
      params,
      cacheTtlMs: 30 * 1000,
      dedupe: true
    }))
  },

  async getById(id) {
    return responseData(await apiClient(`/api/v2/classes/${id}`, {
      method: 'GET',
      cacheTtlMs: 10 * 1000,
      dedupe: true
    }))
  },

  async organisasiBootstrap(params = {}) {
    return responseData(await apiClient('/api/v2/classes/organisasi-bootstrap', {
      method: 'GET',
      params,
      cacheTtlMs: 60 * 1000,
      dedupe: true
    }))
  },

  async strukturBootstrap(params = {}) {
    return responseData(await apiClient('/api/v2/classes/struktur-bootstrap', {
      method: 'GET',
      params,
      cacheTtlMs: 60 * 1000,
      dedupe: true
    }))
  },

  async academicSummary(params = {}) {
    return responseData(await apiClient('/api/v2/classes/struktur-bootstrap', {
      method: 'GET',
      params: { ...params, include_students: params.include_students ?? true, include_schedule: params.include_schedule ?? false, include_mapel: params.include_mapel ?? false },
      cacheTtlMs: 30 * 1000,
      dedupe: true
    }))
  }
}
