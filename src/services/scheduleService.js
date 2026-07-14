import { apiClient } from '../lib/api/client'
import { generateRequestId } from '../lib/api/requestId'

export const USE_SCHEDULES_API_V2 = import.meta.env.VITE_USE_SCHEDULES_API_V2 === 'true'

const responsePayload = (result) => result.payload || { data: result.data }

const mutationOptions = (method, body = {}) => {
  const key = body.idempotency_key || generateRequestId()
  return {
    method,
    headers: { 'Idempotency-Key': key },
    body: { ...body, idempotency_key: key }
  }
}

const pick = (source, allowed) => Object.fromEntries(
  allowed.filter((key) => source[key] !== undefined).map((key) => [key, source[key]])
)

const schedulePayload = (source) => pick(source, [
  'kelas_id',
  'hari',
  'mapel',
  'guru_id',
  'jam_mulai',
  'jam_selesai',
  'idempotency_key'
])

export const scheduleService = {
  async listSchedules(params = {}, options = {}) {
    return responsePayload(await apiClient('/api/v2/schedules', { method: 'GET', params, ...options }))
  },

  async getSchedules(params = {}, options = {}) {
    return this.listSchedules(params, options)
  },

  async listAllSchedules(params = {}, options = {}) {
    const perPage = Math.min(Math.max(Number(params.per_page) || 500, 1), 500)
    const rows = []
    let page = 1
    let lastPage = 1

    do {
      const payload = await this.listSchedules({ ...params, per_page: perPage, page }, options)
      rows.push(...(payload.data || []))
      lastPage = Math.max(Number(payload.meta?.last_page) || 1, 1)
      page += 1
    } while (page <= lastPage)

    return { data: rows }
  },

  async listTeacherSchedules(params = {}, options = {}) {
    return this.listAllSchedules(params, options)
  },

  async listStudentSchedules(params = {}, options = {}) {
    return this.listAllSchedules(params, options)
  },

  async listSubjectOptions(params = {}, options = {}) {
    const payload = await this.listAllSchedules(params, options)
    const uniqueBySubject = new Map()

    ;(payload.data || []).forEach((row) => {
      const subject = String(row?.mapel || '').trim()
      if (subject && !uniqueBySubject.has(subject)) {
        uniqueBySubject.set(subject, row)
      }
    })

    return {
      data: Array.from(uniqueBySubject.values()).sort((left, right) => (
        String(left?.mapel || '').localeCompare(String(right?.mapel || ''), 'id')
      ))
    }
  },

  async getSchedule(id, params = {}) {
    return responsePayload(await apiClient(`/api/v2/schedules/${id}`, { method: 'GET', params }))
  },

  async storeSchedule(data) {
    return responsePayload(await apiClient(
      '/api/v2/schedules',
      mutationOptions('POST', schedulePayload(data))
    ))
  },

  async updateSchedule(id, data) {
    return responsePayload(await apiClient(
      `/api/v2/schedules/${id}`,
      mutationOptions('PATCH', schedulePayload(data))
    ))
  },

  async deleteSchedule(id, kelasId, data = {}) {
    return responsePayload(await apiClient(
      `/api/v2/schedules/${id}`,
      mutationOptions('DELETE', { ...pick(data, ['idempotency_key']), kelas_id: kelasId })
    ))
  }
}

export const loadScheduleRows = async (params, loadLegacy) => {
  if (USE_SCHEDULES_API_V2) {
    const payload = await scheduleService.listAllSchedules(params)
    return payload.data || []
  }

  return loadLegacy()
}

export const scheduleErrorMessage = (error, fallback = 'Gagal memuat jadwal.') => {
  const message = String(error?.message || fallback).trim() || fallback
  const requestId = String(error?.requestId || error?.request_id || '').trim()

  return requestId ? `${message} (ID: ${requestId})` : message
}
