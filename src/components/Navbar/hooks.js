import { useCallback, useEffect, useMemo, useState } from 'react'
import { PROFILE_BUCKET, getSignedUrlForValue, supabase } from '../../lib/supabase'
import { buildNavigationMenu } from '../../navigation/menu.utils'
import { organizationService } from '../../services/organizationService'

const isHttpUrl = (value = '') => /^https?:\/\//i.test(String(value || ''))

export const useNavbarSettings = (authSettings) => {
  const [settings, setSettings] = useState(authSettings || {})
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    let isCancelled = false

    const loadSettings = async () => {
      setIsLoading(true)

      try {
        const { data } = await organizationService.getContext()
        const organization = data?.organization || {}
        const nextSettings = {
          ...(authSettings || {}),
          id: authSettings?.id || null,
          nama_sekolah: organization.name || authSettings?.nama_sekolah || '',
          logo_path: organization.logo_path || authSettings?.logo_path || '',
          updated_at: organization.updated_at || authSettings?.updated_at || null
        }

        if (!isCancelled) setSettings(nextSettings)
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
        if (!cancelled) setAvatarUrl(signed || '')
      } catch {
        if (!cancelled) setAvatarUrl(isHttpUrl(raw) ? raw : '')
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
        if (!cancelled) setLogoUrl(signed || '')
      } catch {
        if (!cancelled) setLogoUrl(isHttpUrl(raw) ? raw : '')
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
        const { data } = await organizationService.getContext()
        if (!cancelled) setIsWaliKelas(Boolean(data?.membership?.is_wali_kelas))
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
        const { data } = await organizationService.getContext()
        if (!cancelled) {
          setFeatures(Array.isArray(data?.delegated_features) ? data.delegated_features : [])
        }
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
