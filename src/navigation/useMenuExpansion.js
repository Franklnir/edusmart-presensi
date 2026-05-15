import { useCallback, useEffect, useMemo, useState } from 'react'
import { getActiveMenuIds } from './menu.utils'

export function useMenuExpansion(items = [], pathname = '', search = '') {
  const activeIds = useMemo(
    () => getActiveMenuIds(items, pathname, search),
    [items, pathname, search]
  )

  const [expandedIds, setExpandedIds] = useState(() => new Set(activeIds))

  useEffect(() => {
    if (!activeIds.length) return

    setExpandedIds((current) => {
      let changed = false
      const next = new Set(current)

      activeIds.forEach((id) => {
        if (!next.has(id)) {
          next.add(id)
          changed = true
        }
      })

      return changed ? next : current
    })
  }, [activeIds])

  const isExpanded = useCallback(
    (id) => expandedIds.has(id),
    [expandedIds]
  )

  const toggle = useCallback((id) => {
    if (!id) return

    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const expand = useCallback((id) => {
    if (!id) return

    setExpandedIds((current) => {
      if (current.has(id)) return current
      const next = new Set(current)
      next.add(id)
      return next
    })
  }, [])

  const collapse = useCallback((id) => {
    if (!id) return

    setExpandedIds((current) => {
      if (!current.has(id)) return current
      const next = new Set(current)
      next.delete(id)
      return next
    })
  }, [])

  return useMemo(
    () => ({
      activeIds,
      collapse,
      expand,
      expandedIds,
      isExpanded,
      toggle,
    }),
    [activeIds, collapse, expand, expandedIds, isExpanded, toggle]
  )
}

export default useMenuExpansion
