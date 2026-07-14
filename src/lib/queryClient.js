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

const tenantCacheIdentity = () => {
  if (typeof window === 'undefined') return 'server'
  return String(window.location?.hostname || 'unknown').toLowerCase()
}

export const withAcademicCacheScope = (params = {}) => ({
  tenant: params.tenantId || params.tenant_id || tenantCacheIdentity(),
  tahun_ajaran: params.tahun_ajaran || params.tahunAjaran || '',
  semester: params.semester || '',
  mode: params.mode || 'active',
  ...params
})

export const queryKeys = {
  admin: {
    dashboard: (params = {}) => ['admin', 'dashboard', withAcademicCacheScope(params)],
    dashboardSummary: (params = {}) => ['admin', 'dashboard-summary', withAcademicCacheScope(params)],
    homeBootstrap: (params = {}) => ['admin', 'home-bootstrap', withAcademicCacheScope(params)],
    academicSummary: (params = {}) => ['admin', 'academic-summary', withAcademicCacheScope(params)],
    structureBootstrap: (params = {}) => ['admin', 'structure-bootstrap', withAcademicCacheScope(params)],
    activeAcademicPeriodSettings: (context = {}) => ['admin', 'active-academic-period-settings', context],
    organizations: (params = {}) => ['admin', 'organizations', withAcademicCacheScope(params)],
    organizationBootstrap: (params = {}) => ['admin', 'organization-bootstrap', withAcademicCacheScope(params)],
    organizationDetail: (params = {}) => ['admin', 'organization-detail', withAcademicCacheScope(params)],
    organizationMembers: (params = {}) => ['admin', 'organization-members', withAcademicCacheScope(params)],
    students: (params = {}) => ['admin', 'students', withAcademicCacheScope(params)],
    studentOptions: (params = {}) => ['admin', 'student-options', withAcademicCacheScope(params)],
    teachers: (params = {}) => ['admin', 'teachers', withAcademicCacheScope(params)],
    teacherOptions: (params = {}) => ['admin', 'teacher-options', withAcademicCacheScope(params)],
  },
  reports: {
    teacherSummary: (params = {}) => ['reports', 'teacher-summary', withAcademicCacheScope(params)],
    attendanceSummary: (params = {}) => ['reports', 'attendance-summary', withAcademicCacheScope(params)],
    taskSummary: (params = {}) => ['reports', 'task-summary', withAcademicCacheScope(params)],
    quizSummary: (params = {}) => ['reports', 'quiz-summary', withAcademicCacheScope(params)],
    homeroomSummary: (params = {}) => ['reports', 'homeroom-summary', withAcademicCacheScope(params)],
  },
}
