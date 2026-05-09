// src/components/Navbar/NavGroup.jsx
// Collapsible navigation group with expand/collapse animation
import React, { useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Icon } from './icons'
import NavItem from './NavItem'

const NavGroup = React.memo(({ group, collapsed }) => {
  const location = useLocation()

  // Auto-expand if any child is active
  const hasActiveChild = group.items.some(
    (item) => location.pathname === item.to || location.pathname.startsWith(item.to + '/')
  )

  const [isExpanded, setIsExpanded] = useState(hasActiveChild)

  useEffect(() => {
    if (hasActiveChild) setIsExpanded(true)
  }, [hasActiveChild])

  const toggle = useCallback(() => {
    setIsExpanded((prev) => !prev)
  }, [])

  // When sidebar is collapsed, show group as icon-only with tooltip listing children
  if (collapsed) {
    return (
      <div className="relative group">
        <button
          onClick={toggle}
          className={`w-full flex items-center justify-center p-2.5 rounded-xl transition-all duration-200
            ${hasActiveChild ? 'bg-brand-50 text-brand-600' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'}
          `}
          title={group.group}
        >
          <Icon name={group.icon} className="w-[18px] h-[18px]" />
        </button>
        {/* Flyout tooltip with children */}
        <div className="absolute left-full ml-2 top-0 min-w-[160px] bg-slate-900 text-white text-xs rounded-xl
          opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto
          transition-opacity duration-150 z-50 shadow-xl p-2 space-y-0.5">
          <div className="px-2 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            {group.group}
          </div>
          {group.items.map((item) => {
            const active = location.pathname === item.to || location.pathname.startsWith(item.to + '/')
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors
                  ${active ? 'bg-brand-600 text-white' : 'hover:bg-slate-800'}
                `}
              >
                <Icon name={item.icon} className="w-3.5 h-3.5" />
                <span>{item.label}</span>
              </Link>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Group header */}
      <button
        onClick={toggle}
        className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-[13px] font-bold
          transition-all duration-200 select-none
          ${hasActiveChild
            ? 'text-brand-700 bg-brand-50/50'
            : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
          }
        `}
      >
        <Icon name={group.icon} className="w-4 h-4 flex-shrink-0" />
        <span className="uppercase tracking-wider flex-1 text-left">{group.group}</span>
        <Icon
          name="chevronDown"
          className={`w-3.5 h-3.5 transition-transform duration-200 ${isExpanded ? '' : '-rotate-90'}`}
        />
      </button>

      {/* Children with smooth expand */}
      <div
        className={`overflow-hidden transition-all duration-200 ease-in-out ${
          isExpanded ? 'max-h-[500px] opacity-100 mt-0.5' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="space-y-0.5 pb-1">
          {group.items.map((item) => (
            <NavItem key={item.to} link={item} collapsed={false} indent />
          ))}
        </div>
      </div>
    </div>
  )
})

NavGroup.displayName = 'NavGroup'

export default NavGroup
