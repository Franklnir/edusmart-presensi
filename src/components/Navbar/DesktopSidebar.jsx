import React from 'react'
import { hasMenuChildren, menuItemKey } from '../../navigation/menu.utils'
import Avatar from './Avatar'
import { Icon } from './icons'
import NavGroup from './NavGroup'
import NavItem from './NavItem'

const renderNavItems = (items, collapsed, menuExpansion) => (
  items.map((item, index) => {
    if (hasMenuChildren(item)) {
      return (
        <NavGroup
          key={menuItemKey(item, index)}
          collapsed={collapsed}
          group={item}
          menuExpansion={menuExpansion}
        />
      )
    }
    return <NavItem key={menuItemKey(item, index)} link={item} collapsed={collapsed} />
  })
)

const DesktopSidebar = React.memo(({
  avatarUrl,
  collapsed,
  menuExpansion,
  navItems,
  onAvatarError,
  onLogoError,
  onLogout,
  onOpenMonitoring,
  onToggleCollapsed,
  onlineCount,
  roleBadge,
  schoolName,
  schoolLogoUrl,
  showMonitoring = false,
  userInitial,
  userName
}) => (
  <>
    <div className={`hidden md:block flex-shrink-0 transition-all duration-300 ease-in-out ${collapsed ? 'w-[64px]' : 'w-52'}`} />

    <aside className={`theme-sidebar hidden md:flex fixed inset-y-0 left-0 flex-col min-h-0 z-40 bg-white border-r border-slate-100 shadow-sidebar transition-all duration-300 ease-in-out ${collapsed ? 'w-[64px]' : 'w-52'}`}>
      <div className="flex items-center gap-2 px-3 pt-3 pb-2 border-b border-slate-100">
        <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 shadow-brand-sm flex-shrink-0 overflow-hidden">
          {schoolLogoUrl ? (
            <img
              src={schoolLogoUrl}
              alt=""
              className="h-full w-full object-cover"
              onError={onLogoError}
            />
          ) : (
            <span className="font-extrabold text-white text-[15px]">{schoolName.charAt(0).toUpperCase()}</span>
          )}
        </div>

        {!collapsed && (
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold text-brand-600 uppercase tracking-[0.16em] leading-none mb-1">{roleBadge.label} Panel</p>
            <p className="text-[16px] font-extrabold text-slate-900 truncate leading-tight">{schoolName}</p>
          </div>
        )}

        <button
          onClick={onToggleCollapsed}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all duration-200 ml-auto flex-shrink-0"
          title={collapsed ? 'Perlebar sidebar' : 'Perkecil sidebar'}
        >
          {collapsed
            ? <Icon name="chevronRight" className="w-3.5 h-3.5" />
            : <Icon name="chevronLeft" className="w-3.5 h-3.5" />}
        </button>
      </div>

      {showMonitoring && (
        <div className={`px-3 pt-3 ${collapsed ? 'flex justify-center' : ''}`}>
          <button
            onClick={onOpenMonitoring}
            title="Monitoring User"
            className={`flex items-center gap-2 text-[10px] font-semibold rounded-xl transition-all duration-200 ${
              collapsed
                ? 'p-2 bg-brand-50 text-brand-600 hover:bg-brand-100'
                : 'w-full px-2.5 py-2 bg-brand-50 text-brand-700 hover:bg-brand-100'
            }`}
          >
            <Icon name="signal" className="w-3 h-3 flex-shrink-0" />
            {!collapsed && (
              <>
                <span>Monitoring</span>
                <span className="ml-auto min-w-[20px] text-center px-1.5 py-0.5 rounded-full bg-brand-600 text-white text-[10px] font-bold">
                  {onlineCount}
                </span>
              </>
            )}
          </button>
        </div>
      )}

      <nav className="flex-1 min-h-0 px-3 py-3 space-y-1 overflow-y-auto overflow-x-hidden">
        {renderNavItems(navItems, collapsed, menuExpansion)}
      </nav>

      <div className="border-t border-slate-100 p-3">
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <Avatar avatarUrl={avatarUrl} onImageError={onAvatarError} size={32} userInitial={userInitial} />
            <button
              onClick={onLogout}
              title="Keluar"
              className="p-2 rounded-xl text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all duration-200"
            >
              <Icon name="logout" className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Avatar avatarUrl={avatarUrl} className="flex-shrink-0" onImageError={onAvatarError} size={32} userInitial={userInitial} />
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-semibold text-slate-800 truncate leading-tight">{userName}</p>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${roleBadge.bg} ${roleBadge.text}`}>
                {roleBadge.label}
              </span>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                onClick={onLogout}
                title="Keluar"
                className="p-2 rounded-xl text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all duration-200 flex-shrink-0"
              >
                <Icon name="logout" className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  </>
))

DesktopSidebar.displayName = 'DesktopSidebar'

export default DesktopSidebar
