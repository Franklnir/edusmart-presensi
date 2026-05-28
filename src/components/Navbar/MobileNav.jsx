import React, { useCallback, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  flattenMenuItems,
  hasActiveMenuChild,
  hasMenuChildren,
  isActiveMenuPath,
  menuItemKey,
} from '../../navigation/menu.utils'
import { prefetchRoute } from '../../lib/routePrefetch'
import Avatar from './Avatar'
import { Icon } from './icons'

const MobileNavLink = React.memo(({ item, onNavigate }) => {
  const location = useLocation()
  const isActive = isActiveMenuPath(location.pathname, item.to, location.search)

  const handlePrefetch = useCallback(() => {
    void prefetchRoute(item.to)
  }, [item.to])

  return (
    <Link
      to={item.to}
      onClick={onNavigate}
      onMouseEnter={handlePrefetch}
      onFocus={handlePrefetch}
      onTouchStart={handlePrefetch}
      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-all duration-200 min-w-0 ${
        isActive ? 'bg-brand-600 text-white shadow-brand-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
      }`}
    >
      <Icon name={item.icon} className="w-4 h-4 flex-shrink-0" />
      <span className="text-sm font-semibold truncate">{item.label}</span>
    </Link>
  )
})

MobileNavLink.displayName = 'MobileNavLink'

const MobileNavGroup = React.memo(({ group, onNavigate, level = 0, menuExpansion }) => {
  const location = useLocation()
  const hasActiveChild = hasActiveMenuChild(group, location.pathname, location.search)
  const groupId = menuItemKey(group)
  const open = menuExpansion?.isExpanded?.(groupId) ?? hasActiveChild

  const handleToggle = useCallback(() => {
    menuExpansion?.toggle?.(groupId)
  }, [groupId, menuExpansion])

  return (
    <div>
      <button
        type="button"
        onClick={handleToggle}
        className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-bold transition-all duration-200 ${
          hasActiveChild ? 'text-brand-700 bg-brand-50' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
        }`}
        style={level > 0 ? { paddingLeft: `${Math.min(0.75 + level * 0.75, 3)}rem` } : undefined}
      >
        <Icon name={group.icon} className="w-4 h-4 flex-shrink-0" />
        <span className="flex-1 text-left">{group.group}</span>
        <Icon name="chevronDown" className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? '' : '-rotate-90'}`} />
      </button>

      {open && (
        <div className={`mt-1 border-l border-slate-100 space-y-1 ${level > 0 ? 'ml-3 pl-2' : 'ml-4 pl-3'}`}>
          {group.items.map((item, index) => (
            hasMenuChildren(item)
              ? (
                <MobileNavGroup
                  key={menuItemKey(item, index)}
                  group={item}
                  level={level + 1}
                  menuExpansion={menuExpansion}
                  onNavigate={onNavigate}
                />
              )
              : <MobileNavLink key={menuItemKey(item, index)} item={item} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  )
})

MobileNavGroup.displayName = 'MobileNavGroup'

const MobileBottomLink = React.memo(({ item }) => {
  const location = useLocation()
  const isActive = isActiveMenuPath(location.pathname, item.to, location.search)

  const handlePrefetch = useCallback(() => {
    void prefetchRoute(item.to)
  }, [item.to])

  return (
    <Link
      to={item.to}
      onMouseEnter={handlePrefetch}
      onFocus={handlePrefetch}
      onTouchStart={handlePrefetch}
      className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl transition-all duration-200 min-w-0 flex-1 ${
        isActive ? 'text-brand-600' : 'text-slate-500 hover:text-slate-700'
      }`}
    >
      <span className={`transition-all duration-200 ${isActive ? 'scale-110' : ''}`}>
        <Icon name={item.icon} className="w-[18px] h-[18px]" />
      </span>
      <span className="text-[10px] font-semibold truncate max-w-full">{item.label}</span>
      {isActive && <span className="w-1 h-1 rounded-full bg-brand-600 mt-0.5" />}
    </Link>
  )
})

MobileBottomLink.displayName = 'MobileBottomLink'

const MobileNav = React.memo(({
  avatarUrl,
  menuExpansion,
  navItems,
  onAvatarError,
  onLogout,
  onOpenMonitoring,
  onlineCount,
  roleBadge,
  schoolName,
  showMonitoring = false,
  userInitial
}) => {
  const [menuOpen, setMenuOpen] = useState(false)

  const mobileLinks = useMemo(() => {
    return flattenMenuItems(navItems).slice(0, 5)
  }, [navItems])

  const closeMenu = useCallback(() => {
    setMenuOpen(false)
  }, [])

  return (
    <>
      <div className="theme-mobile-bar md:hidden sticky top-0 z-30 glass border-b border-slate-100 shadow-navbar">
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center flex-shrink-0">
              <span className="font-extrabold text-white text-xs">{schoolName.charAt(0).toUpperCase()}</span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-900 leading-tight truncate">{schoolName}</p>
              <p className="text-[10px] text-brand-600 font-semibold uppercase tracking-wide">{roleBadge.label}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {showMonitoring && (
              <button
                onClick={onOpenMonitoring}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-brand-50 text-brand-700 text-xs font-bold"
              >
                <Icon name="signal" className="w-3.5 h-3.5" />
                <span>{onlineCount}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
              title="Buka menu"
            >
              <Icon name="menu" className="w-5 h-5" />
            </button>
            <Avatar avatarUrl={avatarUrl} onImageError={onAvatarError} size={32} userInitial={userInitial} />
          </div>
        </div>
      </div>

      <nav className="theme-mobile-bar md:hidden fixed bottom-0 left-0 right-0 z-30 glass border-t border-slate-100 shadow-navbar">
        <div className="flex items-center justify-around px-1 py-1.5 safe-area-inset-bottom">
          {mobileLinks.map((item) => (
            <MobileBottomLink key={item.to} item={item} />
          ))}
        </div>
      </nav>

      {menuOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Tutup menu"
            className="absolute inset-0 bg-black/40"
            onClick={closeMenu}
          />
          <aside className="theme-mobile-drawer absolute right-0 top-0 h-full w-[min(88vw,360px)] bg-white shadow-2xl border-l border-slate-100 flex flex-col">
            <div className="flex items-center justify-between px-4 py-4 border-b border-slate-100">
              <div className="min-w-0">
                <p className="text-sm font-extrabold text-slate-900 truncate">{schoolName}</p>
                <p className={`inline-flex mt-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${roleBadge.bg} ${roleBadge.text}`}>
                  {roleBadge.label}
                </p>
              </div>
              <button
                type="button"
                onClick={closeMenu}
                className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
                title="Tutup menu"
              >
                <Icon name="x" className="w-5 h-5" />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto p-3 space-y-1">
              {navItems.map((item, index) => (
                hasMenuChildren(item)
                  ? (
                    <MobileNavGroup
                      key={menuItemKey(item, index)}
                      group={item}
                      menuExpansion={menuExpansion}
                      onNavigate={closeMenu}
                    />
                  )
                  : <MobileNavLink key={menuItemKey(item, index)} item={item} onNavigate={closeMenu} />
              ))}
            </nav>

            <div className="border-t border-slate-100 p-4">
              <button
                type="button"
                onClick={() => {
                  closeMenu()
                  onLogout?.()
                }}
                className="w-full inline-flex items-center justify-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600 transition-colors hover:bg-red-100"
              >
                <Icon name="logout" className="w-4 h-4" />
                <span>Keluar</span>
              </button>
            </div>
          </aside>
        </div>
      )}
    </>
  )
})

MobileNav.displayName = 'MobileNav'

export default MobileNav
