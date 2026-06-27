import { QueryClient } from '@tanstack/react-query'

const FIVE_MINUTES = 5 * 60 * 1000
const THIRTY_MINUTES = 30 * 60 * 1000

const shouldRetryQuery = (failureCount, error) => {
  if (failureCount >= 1) return false
  const status = Number(error?.status || error?.code || 0)
  if (!status) return true
  return status >= 500
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: FIVE_MINUTES,
      gcTime: THIRTY_MINUTES,
      refetchOnWindowFocus: false,
      refetchOnReconnect: 'always',
      retry: shouldRetryQuery,
    },
    mutations: {
      retry: 0,
    },
  },
})

export const queryKeys = {
  admin: {
    academicSummary: (params = {}) => ['admin', 'academic-summary', params],
    students: (params = {}) => ['admin', 'students', params],
    studentOptions: (params = {}) => ['admin', 'student-options', params],
    teachers: (params = {}) => ['admin', 'teachers', params],
  },
  reports: {
    teacherSummary: (params = {}) => ['reports', 'teacher-summary', params],
    attendanceSummary: (params = {}) => ['reports', 'attendance-summary', params],
    taskSummary: (params = {}) => ['reports', 'task-summary', params],
    quizSummary: (params = {}) => ['reports', 'quiz-summary', params],
    homeroomSummary: (params = {}) => ['reports', 'homeroom-summary', params],
  },
}
