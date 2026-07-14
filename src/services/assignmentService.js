import { apiClient } from '../lib/api/client'
import { generateRequestId } from '../lib/api/requestId'

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

const assignmentPayload = (source) => pick(source, [
  'kelas',
  'judul',
  'mapel',
  'mulai',
  'deadline',
  'keterangan',
  'attachment_ids',
  'link',
  'tahun_ajaran',
  'semester',
  'angkatan',
  'status',
  'idempotency_key'
])

const submissionPayload = (source) => pick(source, [
  'tugas_id',
  'attachment_ids',
  'link_url',
  'file_name',
  'komentar_siswa',
  'idempotency_key'
])

export const assignmentService = {
  async getAssignments(params = {}) {
    return responsePayload(await apiClient('/api/v2/assignments', { method: 'GET', params }))
  },

  async getAssignment(id) {
    return responsePayload(await apiClient(`/api/v2/assignments/${id}`, { method: 'GET' }))
  },

  async storeAssignment(data) {
    const payload = assignmentPayload(data)
    return responsePayload(await apiClient('/api/v2/assignments', mutationOptions('POST', payload)))
  },

  async updateAssignment(id, data) {
    const payload = assignmentPayload(data)
    return responsePayload(await apiClient(`/api/v2/assignments/${id}`, mutationOptions('PATCH', payload)))
  },

  async deleteAssignment(id) {
    return responsePayload(await apiClient(`/api/v2/assignments/${id}`, { method: 'DELETE' }))
  }
}

export const submissionService = {
  async getSubmissions(params = {}) {
    return responsePayload(await apiClient('/api/v2/submissions', { method: 'GET', params }))
  },

  async getSubmission(id) {
    return responsePayload(await apiClient(`/api/v2/submissions/${id}`, { method: 'GET' }))
  },

  async storeSubmission(data) {
    const payload = submissionPayload(data)
    return responsePayload(await apiClient('/api/v2/submissions', mutationOptions('POST', payload)))
  },

  async updateSubmission(id, data) {
    const payload = submissionPayload(data)
    delete payload.tugas_id
    return responsePayload(await apiClient(`/api/v2/submissions/${id}`, mutationOptions('PATCH', payload)))
  },

  async gradeSubmission(id, data) {
    const payload = pick(data, ['nilai', 'status', 'idempotency_key'])
    return responsePayload(await apiClient(`/api/v2/submissions/${id}/grade`, mutationOptions('PATCH', payload)))
  },

  async gradeByUser(data) {
    const payload = pick(data, ['tugas_id', 'user_id', 'nilai', 'idempotency_key'])
    return responsePayload(await apiClient('/api/v2/submissions/grade-by-user', mutationOptions('POST', payload)))
  },

  async deleteSubmission(id) {
    return responsePayload(await apiClient(
      `/api/v2/submissions/${id}`,
      mutationOptions('DELETE')
    ))
  }
}
