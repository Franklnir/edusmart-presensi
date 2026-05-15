export const DEFAULT_USER_THEME = 'default'

export const USER_THEME_OPTIONS = [
  {
    id: 'default',
    label: 'Default',
    description: 'Tema bawaan yang sekarang dipakai.',
    previewStyle: {
      background: 'linear-gradient(135deg, #eef2ff 0%, #ffffff 100%)',
      borderColor: 'rgba(99, 102, 241, 0.18)'
    }
  },
  {
    id: 'minimal',
    label: 'Clean Minimalism',
    description: 'Ringan, tenang, banyak ruang putih dan kontras lembut.',
    previewStyle: {
      background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
      borderColor: 'rgba(148, 163, 184, 0.26)'
    }
  },
  {
    id: 'clay',
    label: 'Claymorphism',
    description: 'Kartu empuk, highlight halus, dan bayangan lembut.',
    previewStyle: {
      background: 'linear-gradient(135deg, #fff7ed 0%, #fde68a 100%)',
      borderColor: 'rgba(251, 146, 60, 0.28)'
    }
  },
  {
    id: 'aurora',
    label: 'Aurora UI / Mesh Gradients',
    description: 'Latar mesh gradient modern dengan panel gelap dan teks kontras.',
    previewStyle: {
      background:
        'radial-gradient(circle at 20% 20%, rgba(99,102,241,.8), transparent 45%), radial-gradient(circle at 80% 30%, rgba(56,189,248,.75), transparent 42%), linear-gradient(135deg, #0f172a 0%, #111827 100%)',
      borderColor: 'rgba(129, 140, 248, 0.36)'
    }
  },
  {
    id: 'glass',
    label: 'Glassmorphism',
    description: 'Panel transparan dengan blur dan layer ringan.',
    previewStyle: {
      background: 'linear-gradient(135deg, rgba(255,255,255,.88) 0%, rgba(191,219,254,.72) 100%)',
      borderColor: 'rgba(255, 255, 255, 0.65)'
    }
  },
  {
    id: 'bento',
    label: 'Bento Box UI (Bento Grid)',
    description: 'Section modular, rapi, dan mudah dipindai seperti dashboard bento.',
    previewStyle: {
      background:
        'linear-gradient(135deg, #ffffff 0%, #ecfeff 48%, #eef2ff 100%)',
      borderColor: 'rgba(45, 212, 191, 0.28)'
    }
  },
  {
    id: 'neobrutal',
    label: 'Neo Brutalism',
    description: 'Outline tegas, kontras tinggi, dan bayangan keras.',
    previewStyle: {
      background: 'linear-gradient(135deg, #fde047 0%, #fb7185 100%)',
      borderColor: 'rgba(15, 23, 42, 0.75)'
    }
  }
]

export const USER_THEME_MAP = Object.fromEntries(
  USER_THEME_OPTIONS.map((theme) => [theme.id, theme])
)

export const USER_THEME_ROLE_ALLOWLIST = new Set(['guru', 'siswa'])

export const canUseUserTheme = (role) => USER_THEME_ROLE_ALLOWLIST.has(String(role || '').trim())

export const normalizeUserTheme = (value) => {
  const key = String(value || '').trim().toLowerCase()
  return USER_THEME_MAP[key] ? key : DEFAULT_USER_THEME
}

export const getUserThemeStorageKey = (userId) => `edusmart:user-theme:${userId || 'guest'}`

export const readUserThemeLocal = (userId) => {
  if (typeof window === 'undefined' || !userId) return DEFAULT_USER_THEME

  try {
    const raw = window.localStorage.getItem(getUserThemeStorageKey(userId))
    return normalizeUserTheme(raw)
  } catch {
    return DEFAULT_USER_THEME
  }
}

export const writeUserThemeLocal = (userId, themeId) => {
  if (typeof window === 'undefined' || !userId) return

  try {
    window.localStorage.setItem(
      getUserThemeStorageKey(userId),
      normalizeUserTheme(themeId)
    )
  } catch {
    // ignore local storage errors
  }
}

export const resolveUserThemePreference = ({ profile, userId }) => {
  const profileTheme = normalizeUserTheme(profile?.theme_preference)
  if (profileTheme !== DEFAULT_USER_THEME || profile?.theme_preference) {
    return profileTheme
  }

  return readUserThemeLocal(userId || profile?.id)
}

export const withResolvedThemePreference = (profile, userId) => {
  if (!profile) return profile

  return {
    ...profile,
    theme_preference: resolveUserThemePreference({ profile, userId })
  }
}
