import { apiClient } from '../lib/api/client'
import { generateRequestId } from '../lib/api/requestId'

const allowedFields = [
  'nama',
  'nis',
  'jk',
  'agama',
  'telp',
  'alamat',
  'tanggal_lahir',
  'no_hp_siswa',
  'no_hp_wali'
]

const payload = (result) => result.payload || { data: result.data }

const pick = (source) => Object.fromEntries(
  allowedFields
    .filter((field) => source[field] !== undefined)
    .map((field) => [field, source[field]])
)

export const currentProfileService = {
  async getCurrentProfile() {
    return payload(await apiClient('/api/v2/profile', { method: 'GET' }))
  },

  async provisionCurrentProfile(source) {
    const key = source.idempotency_key || generateRequestId()
    const requestPayload = {
      role: source.role,
      nama: source.nama,
      email: source.email,
      status: source.status,
      created_via: source.created_via,
      idempotency_key: key
    }
    return payload(await apiClient('/api/v2/profile/provision', {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: requestPayload
    }))
  },

  async updateCurrentProfile(source) {
    const key = source.idempotency_key || generateRequestId()
    return payload(await apiClient('/api/v2/profile', {
      method: 'PATCH',
      headers: { 'Idempotency-Key': key },
      body: { ...pick(source), idempotency_key: key }
    }))
  }
}
