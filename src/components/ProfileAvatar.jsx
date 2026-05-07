import React, { useEffect, useState } from 'react'
import { PROFILE_BUCKET, getSignedUrlForValue } from '../lib/supabase'

const SIGNED_TTL_MS = 55 * 60 * 1000
const signedCache = new Map()

const isHttpUrl = (value = '') => /^https?:\/\//i.test(String(value || ''))

const addCacheBuster = (url) => {
  if (!url) return ''
  const joiner = url.includes('?') ? '&' : '?'
  return `${url}${joiner}t=${Date.now()}`
}

const getInitials = (name = '?') => {
  const parts = (name || '').trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() || '').join('') || '?'
}

const resolveProfilePhoto = async (raw) => {
  if (!raw) return ''

  const cached = signedCache.get(raw)
  const now = Date.now()
  if (cached && cached.expiresAt > now) return cached.url

  let url = ''
  try {
    const signed = await getSignedUrlForValue(PROFILE_BUCKET, raw, 60 * 60)
    url = addCacheBuster(signed)
  } catch {
    if (isHttpUrl(raw)) url = addCacheBuster(raw)
  }

  if (url) {
    signedCache.set(raw, { url, expiresAt: now + SIGNED_TTL_MS })
  }
  return url
}

export default function ProfileAvatar({
  src,
  name = 'User',
  size = 40,
  className = '',
  imgClassName = '',
  fallbackClassName = ''
}) {
  const [resolved, setResolved] = useState('')
  const [broken, setBroken] = useState(false)

  useEffect(() => {
    let cancelled = false
    setBroken(false)

    const run = async () => {
      const url = await resolveProfilePhoto(src)
      if (!cancelled) setResolved(url || '')
    }

    run()
    return () => {
      cancelled = true
    }
  }, [src])

  const sizeStyle = typeof size === 'number' ? { width: size, height: size } : undefined
  const baseImgClass =
    imgClassName || 'rounded-full object-cover border border-slate-200 shadow-sm'
  const baseFallbackClass =
    fallbackClassName ||
    'rounded-full bg-slate-100 text-slate-600 flex items-center justify-center font-bold text-xs border border-slate-200'

  if (!resolved || broken) {
    return (
      <div className={`${baseFallbackClass} ${className}`} style={sizeStyle}>
        {getInitials(name)}
      </div>
    )
  }

  return (
    <img
      src={resolved}
      alt={name}
      className={`${baseImgClass} ${className}`}
      style={sizeStyle}
      onError={() => setBroken(true)}
    />
  )
}
