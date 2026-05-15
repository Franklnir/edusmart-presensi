// src/components/Navbar/NavItem.jsx
// Single navigation link with active state, tooltip, and prefetch
import React, { useCallback } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { prefetchRoute } from '../../lib/routePrefetch'
import { isActiveMenuPath } from '../../navigation/menu.utils'
import { Icon } from './icons'

const NavItem = React.memo(({ link, collapsed, indent = false, level = 0 }) => {
  const location = useLocation()
  const isActive = isActiveMenuPath(location.pathname, link.to, location.search)
  const nestedLevel = indent ? Math.max(1, level) : level
  const expandedPadding = nestedLevel > 0 ? 'pr-2.5 py-2' : 'px-2.5 py-2.5'
  const expandedStyle = nestedLevel > 0
    ? { paddingLeft: `${Math.min(2.25 + (nestedLevel - 1) * 0.9, 4.5)}rem` }
    : undefined

  const handlePrefetch = useCallback(() => {
    void prefetchRoute(link.to)
  }, [link.to])

  return (
    <Link
      to={link.to}
      title={collapsed ? link.label : undefined}
      onMouseEnter={handlePrefetch}
      onFocus={handlePrefetch}
      onTouchStart={handlePrefetch}
      className={`
        group relative flex items-center gap-2.5 rounded-xl text-[14px] font-semibold
        transition-all duration-200 select-none
        ${!collapsed ? expandedPadding : 'px-2.5 py-2.5'}
        ${isActive
          ? 'bg-brand-600 text-white shadow-brand-sm'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
        }
        ${collapsed ? 'justify-center' : ''}
      `}
      style={!collapsed ? expandedStyle : undefined}
    >
      <span className={`flex-shrink-0 transition-transform duration-200 group-hover:scale-110 ${isActive ? 'text-white' : 'text-slate-500 group-hover:text-brand-600'}`}>
        <Icon name={link.icon} className="w-[18px] h-[18px]" />
      </span>
      {!collapsed && <span className="truncate">{link.label}</span>}
      {isActive && !collapsed && (
        <span className="ml-auto w-1.5 h-1.5 rounded-full bg-white/70 flex-shrink-0" />
      )}
      {collapsed && (
        <div className="absolute left-full ml-2 px-2.5 py-1.5 bg-slate-900 text-white text-xs rounded-lg whitespace-nowrap
          opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity duration-150 z-50 shadow-lg">
          {link.label}
        </div>
      )}
    </Link>
  )
})

NavItem.displayName = 'NavItem'

export default NavItem
