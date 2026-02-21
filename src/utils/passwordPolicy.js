// src/utils/passwordPolicy.js
// Centralized password policy — dipakai di Register, ResetPassword, EditProfile

const MIN_LENGTH = 8
const MAX_LENGTH = 128

/**
 * Validasi password berdasarkan policy.
 * @returns {{ valid: boolean, errors: string[] }}
 */
export const validatePassword = (password) => {
    const errors = []
    const pwd = String(password || '')

    if (pwd.length < MIN_LENGTH) {
        errors.push(`Minimal ${MIN_LENGTH} karakter`)
    }
    if (pwd.length > MAX_LENGTH) {
        errors.push(`Maksimal ${MAX_LENGTH} karakter`)
    }
    if (!/[a-z]/.test(pwd)) {
        errors.push('Harus mengandung huruf kecil (a-z)')
    }
    if (!/[A-Z]/.test(pwd)) {
        errors.push('Harus mengandung huruf besar (A-Z)')
    }
    if (!/[0-9]/.test(pwd)) {
        errors.push('Harus mengandung angka (0-9)')
    }

    return {
        valid: errors.length === 0,
        errors
    }
}

/**
 * Hitung kekuatan password (0-4).
 * 0 = sangat lemah, 4 = sangat kuat
 */
export const getPasswordStrength = (password) => {
    const pwd = String(password || '')
    if (!pwd) return { score: 0, label: 'Kosong', color: 'gray' }

    let score = 0
    if (pwd.length >= MIN_LENGTH) score += 1
    if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) score += 1
    if (/[0-9]/.test(pwd)) score += 1
    if (/[^a-zA-Z0-9]/.test(pwd)) score += 1 // special char bonus

    const levels = [
        { label: 'Sangat Lemah', color: 'red' },
        { label: 'Lemah', color: 'orange' },
        { label: 'Cukup', color: 'amber' },
        { label: 'Kuat', color: 'blue' },
        { label: 'Sangat Kuat', color: 'green' }
    ]

    return { score, ...levels[score] }
}

export const PASSWORD_RULES_TEXT = [
    `Minimal ${MIN_LENGTH} karakter`,
    'Mengandung huruf kecil (a-z)',
    'Mengandung huruf besar (A-Z)',
    'Mengandung angka (0-9)'
]
