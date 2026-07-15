import { apiClient } from '../lib/api/client'
import { generateRequestId } from '../lib/api/requestId'

class QuizService {
  async listQuizzes(params = {}) {
    const res = await apiClient('/api/v2/quizzes', { method: 'GET', params })
    return res.data
  }

  async gradeByUser(data = {}) {
    const idempotencyKey = data.idempotency_key || generateRequestId()
    const res = await apiClient('/api/v2/quizzes/grade-by-user', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: { ...data, idempotency_key: idempotencyKey }
    })
    return res.data
  }

  async createQuiz(data) {
    const res = await apiClient('/api/v2/quizzes', {
      method: 'POST',
      body: JSON.stringify(data)
    })
    return res.data
  }

  async updateQuiz(id, data) {
    const res = await apiClient(`/api/v2/quizzes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    })
    return res.data
  }

  async deleteQuiz(id) {
    const res = await apiClient(`/api/v2/quizzes/${id}`, {
      method: 'DELETE'
    })
    return res
  }

  async addQuestion(quizId, questionData) {
    const res = await apiClient('/api/v2/quiz-questions', {
      method: 'POST',
      body: JSON.stringify({ ...questionData, quiz_id: quizId })
    })
    return res.data
  }

  async updateQuestion(id, questionData) {
    const res = await apiClient(`/api/v2/quiz-questions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(questionData)
    })
    return res.data
  }

  async deleteQuestion(id) {
    const res = await apiClient(`/api/v2/quiz-questions/${id}`, {
      method: 'DELETE'
    })
    return res
  }

  async submitAnswer(quizId, submissionId, questionId, optionId) {
    const res = await apiClient(`/api/v2/quizzes/${quizId}/submit`, {
      method: 'POST',
      body: JSON.stringify({
        submission_id: submissionId,
        question_id: questionId,
        option_id: optionId
      })
    })
    return res
  }

  async finishQuiz(quizId, submissionId) {
    const res = await apiClient(`/api/v2/quizzes/${quizId}/finish`, {
      method: 'POST',
      body: JSON.stringify({ submission_id: submissionId })
    })
    return res
  }

  async logViolation(quizId, submissionId, type, message, meta = {}) {
    try {
      await apiClient(`/api/v2/quizzes/${quizId}/violations`, {
        method: 'POST',
        body: JSON.stringify({
          submission_id: submissionId,
          event_type: type,
          event_message: message,
          event_meta: meta
        })
      })
    } catch (error) {
      console.error('Failed to log violation:', error)
    }
  }
}

export const quizService = new QuizService()
