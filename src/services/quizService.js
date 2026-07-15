import { apiClient } from '../lib/api/client'
import { generateRequestId } from '../lib/api/requestId'

const encoded = (value) => encodeURIComponent(String(value || ''))

const withMutation = (method, body = {}, options = {}) => {
  const idempotencyKey = body.idempotency_key || generateRequestId()
  return {
    method,
    headers: {
      'Idempotency-Key': idempotencyKey,
      ...(options.headers || {})
    },
    body: { ...body, idempotency_key: idempotencyKey },
    signal: options.signal
  }
}

const result = async (path, options = {}) => {
  try {
    const response = await apiClient(path, options)
    return { data: response.data, error: null, payload: response.payload }
  } catch (error) {
    return { data: null, error }
  }
}

const required = async (path, options = {}) => {
  const response = await apiClient(path, options)
  return response.data
}

const stripServerOwnedQuizFields = (data = {}) => {
  const payload = { ...data }
  ;[
    'id',
    'tenant_id',
    'guru_id',
    'created_by',
    'created_at',
    'updated_at',
    'tahun_ajaran',
    'semester',
    'academic_year_id',
    'academic_term_id',
    'live_started_at'
  ].forEach((field) => delete payload[field])
  return payload
}

class QuizService {
  async dashboard(params = {}) {
    return result('/api/v2/quizzes', { method: 'GET', params })
  }

  async listQuizzes(params = {}) {
    const response = await this.dashboard(params)
    if (response.error) throw response.error
    return response.data
  }

  async detail(quizId, params = {}) {
    return result(`/api/v2/quizzes/${encoded(quizId)}`, { method: 'GET', params })
  }

  async getQuiz(quizId, params = {}) {
    const response = await this.detail(quizId, params)
    if (response.error) throw response.error
    return response.data
  }

  async participants(quizId, params = {}) {
    return result(`/api/v2/quizzes/${encoded(quizId)}/participants`, { method: 'GET', params })
  }

  async attemptAnswers(quizId, attemptId) {
    return result(`/api/v2/quizzes/${encoded(quizId)}/attempts/${encoded(attemptId)}`, { method: 'GET' })
  }

  async questions(quizId) {
    return result(`/api/v2/quizzes/${encoded(quizId)}/questions`, { method: 'GET' })
  }

  async gradeByUser(data = {}) {
    return result('/api/v2/quizzes/grade-by-user', withMutation('POST', data))
  }

  async createQuiz(data = {}) {
    return required('/api/v2/quizzes', withMutation('POST', stripServerOwnedQuizFields(data)))
  }

  async updateQuiz(id, data = {}) {
    return required(`/api/v2/quizzes/${encoded(id)}`, withMutation('PATCH', stripServerOwnedQuizFields(data)))
  }

  async deleteQuiz(id) {
    return required(`/api/v2/quizzes/${encoded(id)}`, withMutation('DELETE'))
  }

  async addQuestion(quizId, questionData = {}) {
    return required('/api/v2/quiz-questions', withMutation('POST', { ...questionData, quiz_id: quizId }))
  }

  async updateQuestion(id, questionData = {}) {
    return required(`/api/v2/quiz-questions/${encoded(id)}`, withMutation('PATCH', questionData))
  }

  async deleteQuestion(id) {
    return required(`/api/v2/quiz-questions/${encoded(id)}`, withMutation('DELETE'))
  }

  async clone(payload = {}) {
    return result('/api/v2/quizzes/clone', withMutation('POST', payload))
  }

  async schedule(payload = {}) {
    const quizId = payload.quiz_id
    return result(`/api/v2/quizzes/${encoded(quizId)}/schedule`, withMutation('POST', payload))
  }

  async publish(payload = {}) {
    const quizId = payload.quiz_id
    return result(`/api/v2/quizzes/${encoded(quizId)}/publish`, withMutation('POST', payload))
  }

  async close(payload = {}) {
    const quizId = payload.quiz_id
    return result(`/api/v2/quizzes/${encoded(quizId)}/close`, withMutation('POST', payload))
  }

  async archive(payload = {}) {
    const quizId = payload.quiz_id
    return result(`/api/v2/quizzes/${encoded(quizId)}/archive`, withMutation('POST', payload))
  }

  async retakeHistory(quizId) {
    return result(`/api/v2/quizzes/${encoded(quizId)}/retake-history`, { method: 'GET' })
  }

  async retake(payload = {}) {
    const quizId = payload.quiz_id
    return result(`/api/v2/quizzes/${encoded(quizId)}/retakes`, withMutation('POST', payload))
  }

  async restoreRetakeScore(payload = {}) {
    const quizId = payload.quiz_id
    return result(`/api/v2/quizzes/${encoded(quizId)}/retakes/restore`, withMutation('POST', payload))
  }

  async gradeEssay(payload = {}) {
    const quizId = payload.quiz_id
    const attemptId = payload.submission_id
    return result(`/api/v2/quizzes/${encoded(quizId)}/attempts/${encoded(attemptId)}/essay/grade`, withMutation('POST', payload))
  }

  async completeEssayReview(payload = {}) {
    const quizId = payload.quiz_id
    const attemptId = payload.submission_id
    return result(`/api/v2/quizzes/${encoded(quizId)}/attempts/${encoded(attemptId)}/essay/complete`, withMutation('POST', payload))
  }

  async submitAnswer(quizId, submissionId, questionId, optionId, extra = {}) {
    return result(`/api/v2/quizzes/${encoded(quizId)}/attempts/${encoded(submissionId)}/answer`, withMutation('POST', {
      question_id: questionId,
      option_id: optionId,
      ...extra
    }))
  }

  async finishQuiz(quizId, submissionId, answers = [], extra = {}) {
    return result(`/api/v2/quizzes/${encoded(quizId)}/attempts/${encoded(submissionId)}/submit`, withMutation('POST', {
      quiz_id: quizId,
      submission_id: submissionId,
      answers,
      ...extra
    }))
  }

  async start(payload = {}) {
    return result(`/api/v2/quizzes/${encoded(payload.quiz_id)}/attempts/start`, withMutation('POST', payload))
  }

  async saveAnswer(payload = {}) {
    return result(`/api/v2/quizzes/${encoded(payload.quiz_id)}/attempts/${encoded(payload.submission_id)}/answer`, withMutation('POST', payload))
  }

  async saveAnswersBatch(payload = {}) {
    return result(`/api/v2/quizzes/${encoded(payload.quiz_id)}/attempts/${encoded(payload.submission_id)}/answers/batch`, withMutation('POST', payload))
  }

  async submit(payload = {}) {
    return result(`/api/v2/quizzes/${encoded(payload.quiz_id)}/attempts/${encoded(payload.submission_id)}/submit`, withMutation('POST', payload))
  }

  async logViolation(payload = {}) {
    return result(`/api/v2/quizzes/${encoded(payload.quiz_id)}/attempts/${encoded(payload.submission_id)}/violations`, withMutation('POST', payload))
  }

  async pingPresence(payload = {}) {
    return result('/api/v2/quiz-presence/ping', withMutation('POST', payload))
  }
}

export const quizService = new QuizService()
