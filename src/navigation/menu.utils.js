import { menuConfig, superAdminGroup, waliKelasItem } from './menu.config'

export const hasMenuChildren = (item) => Array.isArray(item?.items) && item.items.length > 0

export const isActiveMenuPath = (pathname, to, search = '') => {
  if (!to) return false

  const [pathAndSearch] = String(to).split('#')
  const [targetPath, targetQuery = ''] = pathAndSearch.split('?')
  if (!targetPath) return false

  const pathMatches = targetQuery
    ? pathname === targetPath
    : pathname === targetPath || pathname.startsWith(`${targetPath}/`)
  if (!pathMatches) return false

  if (!targetQuery) return true

  const targetParams = new URLSearchParams(targetQuery)
  const currentParams = new URLSearchParams(search || '')

  for (const [key, value] of targetParams.entries()) {
    if (currentParams.get(key) !== value) return false
  }

  return true
}

export function menuItemKey(item, index = 0) {
  return item?.id || item?.to || item?.group || `menu-${index}`
}

export function getAllRoutePaths(items = []) {
  const paths = []

  for (const item of items) {
    if (item?.to) paths.push(item.to)
    if (hasMenuChildren(item)) {
      paths.push(...getAllRoutePaths(item.items))
    }
  }

  return paths
}

export function flattenMenuItems(items = []) {
  const links = []

  for (const item of items) {
    if (item?.to) links.push(item)
    if (hasMenuChildren(item)) {
      links.push(...flattenMenuItems(item.items))
    }
  }

  return links
}

export function getFirstRoutePath(item) {
  if (item?.to) return item.to
  if (!hasMenuChildren(item)) return ''

  for (const child of item.items) {
    const path = getFirstRoutePath(child)
    if (path) return path
  }

  return ''
}

export function hasActiveMenuChild(item, pathname, search = '') {
  if (isActiveMenuPath(pathname, item?.to, search)) return true
  if (!hasMenuChildren(item)) return false

  return item.items.some((child) => hasActiveMenuChild(child, pathname, search))
}

export function getActiveMenuIds(items = [], pathname = '', search = '') {
  const ids = []

  for (const item of items) {
    if (!hasMenuChildren(item)) continue

    if (hasActiveMenuChild(item, pathname, search)) {
      ids.push(menuItemKey(item))
      ids.push(...getActiveMenuIds(item.items, pathname, search))
    }
  }

  return ids
}

function cloneMenuItems(items = []) {
  return items.map((item) => ({
    ...item,
    ...(hasMenuChildren(item) ? { items: cloneMenuItems(item.items) } : {}),
  }))
}

function addItemToGroup(items, groupId, itemToAdd) {
  return items.map((item) => {
    if (!hasMenuChildren(item)) return item
    const nextChildren = item.id === groupId
      ? [...item.items, itemToAdd]
      : addItemToGroup(item.items, groupId, itemToAdd)

    return { ...item, items: nextChildren }
  })
}

export function buildNavigationMenu({ effectiveRole, isSuperAdmin, isWaliKelas, role }) {
  let items = cloneMenuItems(menuConfig[effectiveRole] || [])

  if (role === 'guru' && isWaliKelas) {
    items = addItemToGroup(items, 'guru-akademik', waliKelasItem)
  }

  if (isSuperAdmin) {
    items = [...items, cloneMenuItems([superAdminGroup])[0]]
  }

  return items
}
