import { apiClient } from '../lib/api/client'
import { generateRequestId } from '../lib/api/requestId'

export const USE_GRADES_API_V2 = import.meta.env.VITE_USE_GRADES_API_V2 === 'true'

const responsePayload = (result) => result.payload || { data: result.data }

const weightPayload = (source = {}) => {
  const allowed = [
    'tahun_ajaran',
    'semester',
    'guru_id',
    'mapel',
    'bobot_tugas_pr',
    'bobot_quiz_reguler',
    'bobot_quiz_uts',
    'bobot_quiz_uas',
    'sumber_uts',
    'sumber_uas',
    'jenis_manual',
    'label_manual'
  ]
  return Object.fromEntries(
    allowed
      .filter((key) => source[key] !== undefined)
      .map((key) => [key, source[key]])
  )
}

export const gradeService = {
  async listWeights(params = {}) {
    return responsePayload(await apiClient('/api/v2/grades/weights', {
      method: 'GET',
      params,
      cacheTtlMs: 15 * 1000,
      dedupe: true
    }))
  },

  async saveWeight(source = {}) {
    const idempotencyKey = source.idempotency_key || generateRequestId()
    return responsePayload(await apiClient('/api/v2/grades/weights', {
      method: 'PUT',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: {
        ...weightPayload(source),
        idempotency_key: idempotencyKey
      }
    }))
  },

  async listManualScores(params = {}) {
    return responsePayload(await apiClient('/api/v2/grades/manual-scores', {
      method: 'GET',
      params,
      cacheTtlMs: 15 * 1000,
      dedupe: true
    }))
  },

  async saveManualScore(source = {}) {
    const idempotencyKey = source.idempotency_key || generateRequestId()
    const allowed = [
      'tahun_ajaran',
      'semester',
      'guru_id',
      'siswa_id',
      'kelas_id',
      'mapel',
      'nilai_manual',
      'nilai_uts_manual',
      'nilai_uas_manual',
      'catatan'
    ]
    const body = Object.fromEntries(
      allowed
        .filter((key) => source[key] !== undefined)
        .map((key) => [key, source[key]])
    )

    return responsePayload(await apiClient('/api/v2/grades/manual-scores', {
      method: 'PUT',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: { ...body, idempotency_key: idempotencyKey }
    }))
  }
}
