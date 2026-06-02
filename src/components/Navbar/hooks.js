import { useCallback, useEffect, useMemo, useState } from 'react'
import { PROFILE_BUCKET, getSignedUrlForValue, supabase } from '../../lib/supabase'
import { buildNavigationMenu } from '../../navigation/menu.utils'

const isHttpUrl = (value = '') => /^https?:\/\//i.test(String(value || ''))

const addCacheBuster = (url) => {
  if (!url) return ''
  const joiner = url.includes('?') ? '&' : '?'
  return `${url}${joiner}t=${Date.now()}`
}

export const useNavbarSettings = (authSettings) => {
  const [settings, setSettings] = useState(authSettings || {})
  const [settingsId, setSettingsId] = useState(authSettings?.id || null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    let isCancelled = false

    const loadSettings = async () => {
      if (authSettings?.id) {
        setSettings(authSettings || {})
        setSettingsId(authSettings.id)
        setIsLoading(false)
        return
      }

      try {
        let { data, error } = await supabase
          .from('settings')
          .select('id,nama_sekolah,logo_url,logo_path,updated_at')
          .order('id', { ascending: true })
          .limit(1)
          .single()

        if (error && error.code === 'PGRST116') data = null
        else if (error) throw error

        if (!isCancelled && data) {
          setSettings(data || {})
          setSettingsId(data.id)
        }
      } catch (error) {
        if (!isCancelled) console.error('Error loading settings:', error)
      } finally {
        if (!isCancelled) setIsLoading(false)
      }
    }

    loadSettings()

    return () => {
      isCancelled = true
    }
  }, [authSettings])

  useEffect(() => {
    if (!settingsId) return undefined

    const channel = supabase
      .channel('navbar_settings_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'settings', filter: `id=eq.${settingsId}` },
        (payload) => {
          const row = payload.new
          if (!row) return
          setSettings((prev) => ({ ...prev, ...row }))
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [settingsId])

  return { settings, isLoading }
}

export const useAvatarUrl = (profile) => {
  const [avatarUrl, setAvatarUrl] = useState('')

  useEffect(() => {
    let cancelled = false
    const raw = profile?.photo_path || profile?.photo_url || ''

    const resolveAvatar = async () => {
      if (!raw) {
        if (!cancelled) setAvatarUrl('')
        return
      }

      try {
        const signed = await getSignedUrlForValue(PROFILE_BUCKET, raw, 60 * 60)
        if (!cancelled) setAvatarUrl(addCacheBuster(signed))
      } catch {
        if (!cancelled) setAvatarUrl(isHttpUrl(raw) ? addCacheBuster(raw) : '')
      }
    }

    resolveAvatar()

    return () => {
      cancelled = true
    }
  }, [profile?.photo_path, profile?.photo_url, profile?.updated_at])

  const clearAvatarUrl = useCallback(() => {
    setAvatarUrl('')
  }, [])

  return { avatarUrl, clearAvatarUrl }
}

export const useSchoolLogoUrl = (settings) => {
  const [logoUrl, setLogoUrl] = useState('')

  useEffect(() => {
    let cancelled = false
    const raw = settings?.logo_url || settings?.logo_path || ''

    const resolveLogo = async () => {
      if (!raw) {
        if (!cancelled) setLogoUrl('')
        return
      }

      try {
        const signed = await getSignedUrlForValue(PROFILE_BUCKET, raw, 60 * 60)
        if (!cancelled) setLogoUrl(addCacheBuster(signed))
      } catch {
        if (!cancelled) setLogoUrl(isHttpUrl(raw) ? addCacheBuster(raw) : '')
      }
    }

    resolveLogo()

    return () => {
      cancelled = true
    }
  }, [settings?.logo_url, settings?.logo_path, settings?.updated_at])

  const clearLogoUrl = useCallback(() => {
    setLogoUrl('')
  }, [])

  return { logoUrl, clearLogoUrl }
}

export const useWaliKelasFlag = (role, userId) => {
  const [isWaliKelas, setIsWaliKelas] = useState(false)

  useEffect(() => {
    let cancelled = false

    const loadWaliKelas = async () => {
      if (role !== 'guru' || !userId) {
        if (!cancelled) setIsWaliKelas(false)
        return
      }

      try {
        const { data, error } = await supabase
          .from('kelas_struktur')
          .select('kelas_id')
          .eq('wali_guru_id', userId)
          .limit(1)

        if (error) throw error
        if (!cancelled) setIsWaliKelas((data || []).length > 0)
      } catch {
        if (!cancelled) setIsWaliKelas(false)
      }
    }

    loadWaliKelas()

    return () => {
      cancelled = true
    }
  }, [role, userId])

  return isWaliKelas
}

export const useDelegatedAdminFeatures = (role, userId) => {
  const [features, setFeatures] = useState([])

  useEffect(() => {
    let cancelled = false

    const loadFeatures = async () => {
      if (role !== 'guru' || !userId) {
        if (!cancelled) setFeatures([])
        return
      }

      try {
        const { data, error } = await supabase.admin.delegatedPermissions()
        if (error) throw error
        if (!cancelled) setFeatures(Array.isArray(data?.features) ? data.features : [])
      } catch {
        if (!cancelled) setFeatures([])
      }
    }

    loadFeatures()

    return () => {
      cancelled = true
    }
  }, [role, userId])

  return features
}

export const useNavigationMenu = ({ effectiveRole, isSuperAdmin, isWaliKelas, role, delegatedAdminFeatures }) => (
  useMemo(
    () => buildNavigationMenu({ effectiveRole, isSuperAdmin, isWaliKelas, role, delegatedAdminFeatures }),
    [effectiveRole, isSuperAdmin, isWaliKelas, role, delegatedAdminFeatures]
  )
)

export const useMonitoring = (effectiveRole) => {
  const [monitorOpen, setMonitorOpen] = useState(false)
  const [monitorLoading, setMonitorLoading] = useState(false)
  const [monitorData, setMonitorData] = useState({ students: [], teachers: [], generated_at: null })
  const [monitorError, setMonitorError] = useState('')

  const students = monitorData?.students || []
  const teachers = monitorData?.teachers || []
  const onlineCount = useMemo(
    () => students.filter((user) => user.online).length + teachers.filter((user) => user.online).length,
    [students, teachers]
  )

  const loadMonitoring = useCallback(async () => {
    if (effectiveRole !== 'admin') return

    setMonitorLoading(true)
    setMonitorError('')

    try {
      const { data, error } = await supabase.admin.monitoring()
      if (error) throw error
      setMonitorData(data || { students: [], teachers: [], generated_at: null })
    } catch (error) {
      setMonitorError(error?.message || 'Gagal memuat monitoring')
    } finally {
      setMonitorLoading(false)
    }
  }, [effectiveRole])

  useEffect(() => {
    if (!monitorOpen || effectiveRole !== 'admin') return undefined

    loadMonitoring()
    const interval = window.setInterval(loadMonitoring, 15000)

    return () => {
      window.clearInterval(interval)
    }
  }, [effectiveRole, loadMonitoring, monitorOpen])

  useEffect(() => {
    if (effectiveRole !== 'admin') setMonitorOpen(false)
  }, [effectiveRole])

  return {
    monitorOpen,
    setMonitorOpen,
    monitorLoading,
    monitorData,
    monitorError,
    loadMonitoring,
    onlineCount
  }
}
