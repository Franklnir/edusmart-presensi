// src/components/Navbar/NavGroup.jsx
// Recursive collapsible navigation group.
import React, { useCallback } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  getFirstRoutePath,
  hasActiveMenuChild,
  hasMenuChildren,
  isActiveMenuPath,
  menuItemKey,
} from '../../navigation/menu.utils'
import { prefetchRoute } from '../../lib/routePrefetch'
import { Icon } from './icons'
import NavItem from './NavItem'

const FlyoutMenuItem = React.memo(({ item, level = 0 }) => {
  const location = useLocation()
  const active = isActiveMenuPath(location.pathname, item.to, location.search)

  const handlePrefetch = useCallback(() => {
    void prefetchRoute(item.to)
  }, [item.to])

  if (hasMenuChildren(item)) {
    return (
      <div>
        <div className="flex items-center gap-2 px-2 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          <Icon name={item.icon} className="w-3.5 h-3.5" />
          <span>{item.group || item.label}</span>
        </div>
        <div className="space-y-0.5">
          {item.items.map((child, index) => (
            <FlyoutMenuItem key={menuItemKey(child, index)} item={child} level={level + 1} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <Link
      to={item.to}
      onMouseEnter={handlePrefetch}
      onFocus={handlePrefetch}
      onTouchStart={handlePrefetch}
      className={`flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors ${
        active ? 'bg-brand-600 text-white' : 'hover:bg-slate-800'
      }`}
      style={level > 0 ? { paddingLeft: `${Math.min(0.5 + level * 0.65, 2.2)}rem` } : undefined}
    >
      <Icon name={item.icon} className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="truncate">{item.label}</span>
    </Link>
  )
})

FlyoutMenuItem.displayName = 'FlyoutMenuItem'

const NavGroup = React.memo(({ group, collapsed, level = 0, menuExpansion }) => {
  const location = useLocation()
  const hasActiveChild = hasActiveMenuChild(group, location.pathname, location.search)
  const groupId = menuItemKey(group)
  const isExpanded = menuExpansion?.isExpanded?.(groupId) ?? hasActiveChild

  const toggle = useCallback(() => {
    if (!isExpanded) {
      const firstRoute = getFirstRoutePath(group)
      if (firstRoute) void prefetchRoute(firstRoute)
    }
    menuExpansion?.toggle?.(groupId)
  }, [group, groupId, isExpanded, menuExpansion])

  const handleCollapsedClick = useCallback(() => {
    const firstRoute = getFirstRoutePath(group)
    if (firstRoute) void prefetchRoute(firstRoute)
  }, [group])

  if (collapsed) {
    return (
      <div className="relative group">
        <button
          type="button"
          onClick={handleCollapsedClick}
          className={`w-full flex items-center justify-center p-2.5 rounded-xl transition-all duration-200 ${
            hasActiveChild ? 'bg-brand-50 text-brand-600' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'
          }`}
          title={group.group}
        >
          <Icon name={group.icon} className="w-[18px] h-[18px]" />
        </button>

        <div className="absolute left-full ml-2 top-0 min-w-[180px] max-w-[260px] bg-slate-900 text-white text-xs rounded-xl opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity duration-150 z-50 shadow-xl p-2 space-y-0.5">
          <div className="px-2 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            {group.group}
          </div>
          {group.items.map((item, index) => (
            <FlyoutMenuItem key={menuItemKey(item, index)} item={item} />
          ))}
        </div>
      </div>
    )
  }

  const nestedPadding = level > 0
    ? { paddingLeft: `${Math.min(0.6 + level * 0.8, 3)}rem` }
    : undefined

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-[13px] font-bold transition-all duration-200 select-none ${
          hasActiveChild
            ? 'text-brand-700 bg-brand-50/50'
            : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
        }`}
        style={nestedPadding}
      >
        <Icon name={group.icon} className="w-4 h-4 flex-shrink-0" />
        <span className="uppercase tracking-wider flex-1 text-left truncate">{group.group}</span>
        <Icon
          name="chevronDown"
          className={`w-3.5 h-3.5 transition-transform duration-200 ${isExpanded ? '' : '-rotate-90'}`}
        />
      </button>

      <div
        className={`overflow-hidden transition-all duration-200 ease-in-out ${
          isExpanded ? 'max-h-[600px] opacity-100 mt-0.5' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="space-y-0.5 pb-1">
          {group.items.map((item, index) => (
            hasMenuChildren(item)
              ? (
                <NavGroup
                  key={menuItemKey(item, index)}
                  collapsed={false}
                  group={item}
                  level={level + 1}
                  menuExpansion={menuExpansion}
                />
              )
              : <NavItem key={menuItemKey(item, index)} link={item} collapsed={false} indent level={level + 1} />
          ))}
        </div>
      </div>
    </div>
  )
})

NavGroup.displayName = 'NavGroup'

export default NavGroup
