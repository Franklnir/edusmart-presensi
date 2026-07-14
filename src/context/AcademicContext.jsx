import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { queryClient, queryKeys } from '../lib/queryClient'
import { academicContextService } from '../services/academicContextService'
import { useAuthStore } from '../store/useAuthStore'
import {
  generateAcademicYearOptions,
  resolveAcademicPeriod
} from '../utils/academicPeriod'
import {
  clearAcademicCorrectionSession,
  readAcademicCorrectionSession,
  writeAcademicCorrectionSession
} from '../utils/academicCorrectionSession'

const AcademicContext = createContext(null)
const ACADEMIC_CONTEXT_REFRESH_MS = 60 * 1000

export function AcademicContextProvider({ children }) {
  const settings = useAuthStore((state) => state.settings)
  const profile = useAuthStore((state) => state.profile)
  const tenantId = String(profile?.tenant_id || '')
  const fallback = useMemo(
    () => resolveAcademicPeriod(settings || {}),
    [settings]
  )
  const [activeAcademicPeriod, setActiveAcademicPeriod] = useState(fallback)
  const [correctionSession, setCorrectionSessionState] = useState(null)

  useEffect(() => setActiveAcademicPeriod(fallback), [fallback])

  useEffect(() => {
    setCorrectionSessionState(readAcademicCorrectionSession(tenantId))
  }, [tenantId])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const data = await queryClient.fetchQuery({
          queryKey: queryKeys.admin.activeAcademicPeriodSettings({ tenantId }),
          queryFn: async () => {
            const response = await academicContextService.getActiveContext()
            return response.data || {}
          },
          staleTime: 60 * 1000
        })
        if (!cancelled) setActiveAcademicPeriod(resolveAcademicPeriod(data || {}))
      } catch {
        if (!cancelled) setActiveAcademicPeriod(fallback)
      }
    }

    load()
    const refresh = () => {
      queryClient.removeQueries({
        queryKey: queryKeys.admin.activeAcademicPeriodSettings({ tenantId })
      })
      void load()
    }
    const interval = window.setInterval(refresh, ACADEMIC_CONTEXT_REFRESH_MS)
    window.addEventListener('sismu:academic-context-updated', refresh)

    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.removeEventListener('sismu:academic-context-updated', refresh)
    }
  }, [fallback, tenantId])

  const setCorrectionSession = useCallback((session) => {
    const scopedSession = session ? { ...session, tenant_id: session.tenant_id || tenantId } : null
    writeAcademicCorrectionSession(scopedSession, tenantId)
    setCorrectionSessionState(scopedSession)
  }, [tenantId])

  const clearCorrectionSession = useCallback(() => {
    clearAcademicCorrectionSession()
    setCorrectionSessionState(null)
  }, [])

  const value = useMemo(() => ({
    tenantId,
    role: profile?.role || '',
    activeAcademicPeriod,
    academicYearOptions: generateAcademicYearOptions(),
    correctionSession,
    setCorrectionSession,
    clearCorrectionSession
  }), [
    activeAcademicPeriod,
    clearCorrectionSession,
    correctionSession,
    profile?.role,
    setCorrectionSession,
    tenantId
  ])

  return <AcademicContext.Provider value={value}>{children}</AcademicContext.Provider>
}

export const useAcademicContext = () => {
  const context = useContext(AcademicContext)
  if (!context) throw new Error('useAcademicContext harus dipakai di dalam AcademicContextProvider')

  return context
}
