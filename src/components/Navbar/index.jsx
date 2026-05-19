import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/useAuthStore'
import { scheduleRoutePrefetch } from '../../lib/routePrefetch'
import { getAllRoutePaths } from '../../navigation/menu.utils'
import { useMenuExpansion } from '../../navigation/useMenuExpansion'
import DesktopSidebar from './DesktopSidebar'
import MobileNav from './MobileNav'
import MonitoringModal from './MonitoringModal'
import {
  useAvatarUrl,
  useMonitoring,
  useNavbarSettings,
  useNavigationMenu,
  useWaliKelasFlag
} from './hooks'

const ROLE_BADGE = {
  admin: { bg: 'bg-violet-100', text: 'text-violet-700', label: 'Admin' },
  guru: { bg: 'bg-sky-100', text: 'text-sky-700', label: 'Guru' },
  siswa: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Siswa' }
}

const Navbar = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const {
    user,
    profile,
    settings: authSettings,
    logout,
    isSuperAdmin
  } = useAuthStore()

  const [isCollapsed, setIsCollapsed] = useState(false)
  const { settings, isLoading } = useNavbarSettings(authSettings)
  const { avatarUrl, clearAvatarUrl } = useAvatarUrl(profile)

  const role = profile?.role
  const hasSuperAdminAccess = Boolean(isSuperAdmin && role === 'admin')
  const effectiveRole = hasSuperAdminAccess ? 'admin' : role
  const isWaliKelas = useWaliKelasFlag(role, user?.id)
  const navItems = useNavigationMenu({ effectiveRole, isSuperAdmin: hasSuperAdminAccess, isWaliKelas, role })
  const menuExpansion = useMenuExpansion(navItems, location.pathname, location.search)
  const {
    loadMonitoring,
    monitorData,
    monitorError,
    monitorLoading,
    monitorOpen,
    onlineCount,
    setMonitorOpen
  } = useMonitoring(effectiveRole)

  const roleBadge = ROLE_BADGE[role] || { bg: 'bg-slate-100', text: 'text-slate-600', label: role || 'User' }
  const schoolName = settings?.nama_sekolah || 'EduSmart'
  const userName = profile?.nama || user?.email?.split('@')[0] || 'User'
  const userInitial = (profile?.nama?.[0] || user?.email?.[0] || 'U').toUpperCase()

  const prefetchPaths = useMemo(() => getAllRoutePaths(navItems), [navItems])

  useEffect(() => {
    const nextRoutes = prefetchPaths.filter(
      (to) => !(location.pathname === to || location.pathname.startsWith(`${to}/`))
    )
    return scheduleRoutePrefetch(nextRoutes, { max: 1, delay: 1800, timeout: 3000 })
  }, [location.pathname, prefetchPaths])

  const handleLogout = useCallback(async () => {
    await logout()
    navigate('/login')
  }, [logout, navigate])

  const handleToggleCollapsed = useCallback(() => {
    setIsCollapsed((value) => !value)
  }, [])

  const handleOpenMonitoring = useCallback(() => {
    setMonitorOpen(true)
  }, [setMonitorOpen])

  const handleCloseMonitoring = useCallback(() => {
    setMonitorOpen(false)
  }, [setMonitorOpen])

  if (isLoading) {
    return (
      <div className="hidden md:flex flex-col h-screen sticky top-0 w-56 bg-white border-r border-slate-100">
        <div className="animate-pulse p-4">
          <div className="h-8 bg-slate-100 rounded-xl mb-4" />
          <div className="space-y-2">
            {[...Array(6)].map((_, index) => (
              <div key={index} className="h-8 bg-slate-100 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <DesktopSidebar
        avatarUrl={avatarUrl}
        collapsed={isCollapsed}
        effectiveRole={effectiveRole}
        menuExpansion={menuExpansion}
        navItems={navItems}
        onAvatarError={clearAvatarUrl}
        onLogout={handleLogout}
        onOpenMonitoring={handleOpenMonitoring}
        onToggleCollapsed={handleToggleCollapsed}
        onlineCount={onlineCount}
        roleBadge={roleBadge}
        schoolName={schoolName}
        userInitial={userInitial}
        userName={userName}
      />

      <MobileNav
        avatarUrl={avatarUrl}
        effectiveRole={effectiveRole}
        menuExpansion={menuExpansion}
        navItems={navItems}
        onAvatarError={clearAvatarUrl}
        onLogout={handleLogout}
        onOpenMonitoring={handleOpenMonitoring}
        onlineCount={onlineCount}
        roleBadge={roleBadge}
        schoolName={schoolName}
        userInitial={userInitial}
      />

      <MonitoringModal
        data={monitorData}
        error={monitorError}
        loading={monitorLoading}
        onClose={handleCloseMonitoring}
        onRefresh={loadMonitoring}
        onlineCount={onlineCount}
        open={monitorOpen}
      />
    </>
  )
}

export default Navbar
