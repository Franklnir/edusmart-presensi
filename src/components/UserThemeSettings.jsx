import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useAuthStore } from '../store/useAuthStore'
import {
  DEFAULT_USER_THEME,
  USER_THEME_OPTIONS,
  normalizeUserTheme
} from '../theme/userThemes'
import { Icon } from './Navbar/icons'

const UserThemeSettings = React.memo(({ className = '' }) => {
  const { profile, updateThemePreference } = useAuthStore()
  const [pendingTheme, setPendingTheme] = useState('')
  const [open, setOpen] = useState(false)
  const menuRef = useRef(null)
  const currentTheme = useMemo(
    () => normalizeUserTheme(profile?.theme_preference || DEFAULT_USER_THEME),
    [profile?.theme_preference]
  )
  const currentThemeOption = useMemo(
    () => USER_THEME_OPTIONS.find((theme) => theme.id === currentTheme) || USER_THEME_OPTIONS[0],
    [currentTheme]
  )

  useEffect(() => {
    if (!open) return undefined

    const handlePointerDown = (event) => {
      if (menuRef.current?.contains(event.target)) return
      setOpen(false)
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const handleSelectTheme = async (themeId) => {
    const nextTheme = normalizeUserTheme(themeId)
    if (pendingTheme) return
    if (nextTheme === currentTheme) {
      setOpen(false)
      return
    }

    setPendingTheme(nextTheme)
    try {
      await updateThemePreference(nextTheme)
      setOpen(false)
    } finally {
      setPendingTheme('')
    }
  }

  return (
    <section ref={menuRef} className={`relative ${className}`.trim()}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white px-4 py-3 text-left shadow-sm transition hover:border-blue-200 hover:bg-slate-50"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600">
            <Icon name="theme" className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-bold text-slate-900">Tema Tampilan</span>
            <span className="block truncate text-xs text-slate-500">{currentThemeOption?.label || 'Default'}</span>
          </span>
        </span>
        <Icon name="chevronDown" className={`h-4 w-4 shrink-0 text-slate-500 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-30 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
          <div className="border-b border-slate-100 px-4 py-3">
            <div className="text-sm font-bold text-slate-900">Pilih Tema</div>
            <div className="text-xs text-slate-500">Berlaku hanya untuk akun Anda.</div>
          </div>
          <div className="max-h-80 overflow-auto p-2" role="listbox" aria-label="Pilihan tema tampilan">
            {USER_THEME_OPTIONS.map((theme) => {
              const selected = theme.id === currentTheme
              const pending = theme.id === pendingTheme

              return (
                <button
                  key={theme.id}
                  type="button"
                  className={`flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition ${
                    selected
                      ? 'bg-blue-50 text-blue-900'
                      : 'text-slate-700 hover:bg-slate-50'
                  } disabled:cursor-not-allowed disabled:opacity-70`}
                  onClick={() => handleSelectTheme(theme.id)}
                  disabled={Boolean(pendingTheme)}
                  aria-selected={selected}
                  role="option"
                >
                  <span
                    className="mt-0.5 grid h-9 w-9 shrink-0 grid-cols-2 gap-1 rounded-xl border p-1"
                    style={theme.previewStyle}
                    aria-hidden="true"
                  >
                    <span className="rounded bg-white/80" />
                    <span className="rounded bg-white/55" />
                    <span className="col-span-2 rounded bg-white/65" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold">{theme.label}</span>
                      {(selected || pending) && (
                        <Icon
                          name="checkSmall"
                          className={`h-4 w-4 shrink-0 text-blue-600 ${pending ? 'animate-pulse' : ''}`}
                        />
                      )}
                    </span>
                    <span className="mt-0.5 block text-xs leading-5 text-slate-500">
                      {theme.description}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
})

UserThemeSettings.displayName = 'UserThemeSettings'

export default UserThemeSettings
