import { apiClient } from '../lib/api/client'
import { generateRequestId } from '../lib/api/requestId'

const id = (value) => encodeURIComponent(String(value || ''))

const mutate = (body = {}) => {
  const key = body.idempotency_key || generateRequestId()
  return {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: { ...body, idempotency_key: key }
  }
}

const call = async (path, options) => {
  try {
    const response = await apiClient(path, options)
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error }
  }
}

export const quizAttemptService = {
  start(payload = {}) {
    return call(`/api/v2/quizzes/${id(payload.quiz_id)}/attempts/start`, mutate(payload))
  },

  answer(payload = {}) {
    return call(`/api/v2/quizzes/${id(payload.quiz_id)}/attempts/${id(payload.submission_id)}/answer`, mutate(payload))
  },

  batch(payload = {}) {
    return call(`/api/v2/quizzes/${id(payload.quiz_id)}/attempts/${id(payload.submission_id)}/answers/batch`, mutate(payload))
  },

  submit(payload = {}) {
    return call(`/api/v2/quizzes/${id(payload.quiz_id)}/attempts/${id(payload.submission_id)}/submit`, mutate(payload))
  },

  violation(payload = {}) {
    return call(`/api/v2/quizzes/${id(payload.quiz_id)}/attempts/${id(payload.submission_id)}/violations`, mutate(payload))
  },

  pingPresence(payload = {}) {
    return call('/api/v2/quiz-presence/ping', mutate(payload))
  }
}
