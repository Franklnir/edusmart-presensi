import { menuConfig, superAdminGroup, waliKelasItem } from './menu.config'
import { ADMIN_FEATURE_BY_KEY } from '../constants/adminFeaturePermissions'

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

export function buildNavigationMenu({ effectiveRole, isSuperAdmin, isWaliKelas, role, delegatedAdminFeatures = [] }) {
  if (isSuperAdmin) {
    return cloneMenuItems([superAdminGroup])
  }

  let items = cloneMenuItems(menuConfig[effectiveRole] || [])

  if (role === 'guru' && Array.isArray(delegatedAdminFeatures) && delegatedAdminFeatures.length > 0) {
    const delegatedItems = delegatedAdminFeatures
      .map((featureKey) => ADMIN_FEATURE_BY_KEY[featureKey])
      .filter(Boolean)
      .map((feature) => ({
        id: `guru-admin-${feature.key}`,
        to: feature.guruPath,
        label: feature.label,
        icon: feature.icon,
      }))

    if (delegatedItems.length > 0) {
      items.push({
        id: 'guru-delegasi-admin',
        group: 'Delegasi Admin',
        icon: 'shield',
        items: delegatedItems,
      })
    }
  }

  if (role === 'guru' && isWaliKelas) {
    const profileIndex = items.findIndex((item) => item.id === 'guru-profile')
    items = profileIndex >= 0
      ? [...items.slice(0, profileIndex), waliKelasItem, ...items.slice(profileIndex)]
      : [...items, waliKelasItem]
  }

  return items
}
