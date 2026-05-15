import React, { useMemo, useState } from 'react'
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
  const currentTheme = useMemo(
    () => normalizeUserTheme(profile?.theme_preference || DEFAULT_USER_THEME),
    [profile?.theme_preference]
  )

  const handleSelectTheme = async (themeId) => {
    const nextTheme = normalizeUserTheme(themeId)
    if (pendingTheme || nextTheme === currentTheme) return

    setPendingTheme(nextTheme)
    try {
      await updateThemePreference(nextTheme)
    } finally {
      setPendingTheme('')
    }
  }

  return (
    <section className={`user-theme-settings bg-white rounded-2xl shadow-sm border border-slate-200/60 p-5 ${className}`.trim()}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="user-theme-settings__icon">
              <Icon name="theme" className="w-4 h-4" />
            </span>
            <h3 className="user-theme-settings__title">Tema Tampilan</h3>
          </div>
          <p className="user-theme-settings__subtitle">
            Pilihan ini hanya berlaku untuk akun Anda.
          </p>
        </div>
      </div>

      <div className="user-theme-settings__grid">
        {USER_THEME_OPTIONS.map((theme) => {
          const selected = theme.id === currentTheme
          const pending = theme.id === pendingTheme

          return (
            <button
              key={theme.id}
              type="button"
              className={`user-theme-settings__option ${selected ? 'user-theme-settings__option--active' : ''}`}
              onClick={() => handleSelectTheme(theme.id)}
              disabled={Boolean(pendingTheme)}
              aria-pressed={selected}
            >
              <span
                className="user-theme-settings__preview"
                style={theme.previewStyle}
                aria-hidden="true"
              >
                <span />
                <span />
                <span />
              </span>
              <span className="user-theme-settings__copy">
                <span className="user-theme-settings__label-row">
                  <span className="user-theme-settings__label">{theme.label}</span>
                  {(selected || pending) && (
                    <span className="user-theme-settings__check">
                      <Icon
                        name="checkSmall"
                        className={`w-3.5 h-3.5 ${pending ? 'animate-pulse' : ''}`}
                      />
                    </span>
                  )}
                </span>
                <span className="user-theme-settings__description">
                  {theme.description}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
})

UserThemeSettings.displayName = 'UserThemeSettings'

export default UserThemeSettings
