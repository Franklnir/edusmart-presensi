import { generateRequestId } from '../lib/api/requestId'
import { apiClient } from '../lib/api/client'

const responsePayload = (result) => result.payload || { data: result.data }

const mutationOptions = (method, path, payload = {}) => {
  const idempotencyKey = generateRequestId()
  return {
    path,
    options: {
      method,
      headers: { 'Idempotency-Key': idempotencyKey },
      body: { ...payload, idempotency_key: idempotencyKey }
    }
  }
}

export const announcementService = {
  async listAnnouncements(params = {}) {
    return responsePayload(await apiClient('/api/v2/announcements', {
      method: 'GET',
      params,
      cacheTtlMs: 15 * 1000,
      dedupe: true
    }))
  },

  async storeAnnouncement(payload = {}) {
    const request = mutationOptions('POST', '/api/v2/announcements', {
      judul: payload.judul,
      keterangan: payload.keterangan,
      target: payload.target
    })
    return responsePayload(await apiClient(request.path, request.options))
  },

  async updateAnnouncement(id, payload = {}) {
    const request = mutationOptions('PATCH', `/api/v2/announcements/${encodeURIComponent(id)}`, {
      judul: payload.judul,
      keterangan: payload.keterangan,
      target: payload.target
    })
    return responsePayload(await apiClient(request.path, request.options))
  },

  async deleteAnnouncement(id) {
    const request = mutationOptions('DELETE', `/api/v2/announcements/${encodeURIComponent(id)}`)
    return responsePayload(await apiClient(request.path, request.options))
  }
}
