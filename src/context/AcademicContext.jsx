import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { queryClient, queryKeys } from '../lib/queryClient'
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
const SETTINGS_PERIOD_COLUMNS = 'id, tenant_id, tahun_ajaran, semester_aktif, periode_mulai, periode_selesai, periode_ganjil_mulai, periode_ganjil_selesai, periode_genap_mulai, periode_genap_selesai, max_ekskul_per_siswa, updated_at'

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
            const { data: row, error } = await supabase
              .from('settings')
              .select(SETTINGS_PERIOD_COLUMNS)
              .order('id', { ascending: true })
              .limit(1)
              .maybeSingle()
            if (error) throw error
            return row || {}
          },
          staleTime: 60 * 1000
        })
        if (!cancelled) setActiveAcademicPeriod(resolveAcademicPeriod(data || {}))
      } catch (error) {
        if (!cancelled) setActiveAcademicPeriod(fallback)
      }
    }

    load()
    const channel = supabase
      .channel(`active_academic_period_settings:${tenantId || 'unknown'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, (payload) => {
        if (cancelled) return
        const eventTenantId = String(payload.new?.tenant_id || payload.old?.tenant_id || '')
        if (tenantId && eventTenantId && eventTenantId !== tenantId) return
        queryClient.setQueryData(
          queryKeys.admin.activeAcademicPeriodSettings({ tenantId }),
          payload.new || {}
        )
        setActiveAcademicPeriod(resolveAcademicPeriod(payload.new || {}))
      })
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
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
