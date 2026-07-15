import { apiClient } from '../lib/api/client'

const responseData = (result) => result.payload?.data ?? result.data

const get = (path, params = {}, options = {}) => apiClient(path, {
  method: 'GET',
  params,
  cacheTtlMs: 30 * 1000,
  dedupe: true,
  timeoutMs: 90 * 1000,
  ...options
}).then(responseData)

export const reportService = {
  homeroomOptions: (params = {}) => get('/api/v2/reports/homeroom-options', params, { cacheTtlMs: 60 * 1000 }),
  teacherSummary: (params = {}) => get('/api/v2/reports/teacher-summary', params),
  attendanceSummary: (params = {}) => get('/api/v2/reports/attendance-summary', params),
  taskSummary: (params = {}) => get('/api/v2/reports/task-summary', params),
  quizSummary: (params = {}) => get('/api/v2/reports/quiz-summary', params),
  homeroomSummary: (params = {}) => get('/api/v2/reports/homeroom-summary', params, { timeoutMs: 120 * 1000 }),
  dashboardAggregate: (params = {}) => get('/api/v2/reports/dashboard-aggregate', params)
}
