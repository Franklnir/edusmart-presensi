import { apiClient, logFrontendError } from '../lib/api/client'
import { supabase } from '../lib/supabase'

const wrapResult = (data, error) => {
  if (error) {
    logFrontendError('warn', `Auth error: ${error.message || 'unknown'}`, {
      code: error.code || error.status || 'AUTH_ERROR',
      message: error.message
    })
  }
  return { data, error }
}

export const verifyCurrentUserPassword = async (password) => {
  const trimmedPassword = String(password || '').trim()
  if (!trimmedPassword) {
    throw new Error('Password tidak boleh kosong')
  }
  try {
    const result = await apiClient('/api/auth/verify-password', {
      method: 'POST',
      body: { password: trimmedPassword }
    })
    return result.data?.valid === true
  } catch (err) {
    if (err.status === 401 || err.status === 403) throw new Error('Password salah')
    throw err
  }
}

export const getSecurityOverview = async () => {
  try {
    const result = await apiClient('/api/auth/security', { method: 'GET' })
    return wrapResult(result.payload?.data || result.data, null)
  } catch (err) {
    return wrapResult(null, err)
  }
}

export const logoutOtherDevices = async ({ password }) => {
  try {
    const result = await apiClient('/api/auth/logout-other-devices', {
      method: 'POST',
      body: { password }
    })
    return wrapResult(result.payload?.data || result.data, null)
  } catch (err) {
    return wrapResult(null, err)
  }
}

export const signInWithPassword = async ({ email, password }) => {
  try {
    const result = await apiClient('/api/auth/login', {
      method: 'POST',
      body: { email, password }
    })
    return wrapResult(result.payload?.data || result.data, null)
  } catch (err) {
    return wrapResult(null, { message: err.message, status: err.status })
  }
}

export const getUser = async () => {
  try {
    const result = await apiClient('/api/auth/me', { method: 'GET' })
    return wrapResult(result.payload?.data || result.data, null)
  } catch (err) {
    return wrapResult(null, err)
  }
}

export const signOut = async () => {
  try {
    await apiClient('/api/auth/logout', { method: 'POST' })
    return wrapResult(null, null)
  } catch (err) {
    return wrapResult(null, err)
  }
}

export const signUp = async ({ email, password, options }) => {
  try {
    const result = await apiClient('/api/auth/register', {
      method: 'POST',
      body: { email, password, ...options?.data }
    })
    return wrapResult(result.payload?.data || result.data, null)
  } catch (err) {
    return wrapResult(null, { message: err.message, status: err.status })
  }
}

export const resetPasswordForEmail = async (email) => {
  try {
    await apiClient('/api/auth/forgot-password', {
      method: 'POST',
      body: { email }
    })
    return wrapResult(null, null)
  } catch (err) {
    return wrapResult(null, err)
  }
}

export const resetPassword = async ({ email, token, password }) => {
  try {
    const result = await apiClient('/api/auth/reset-password', {
      method: 'POST',
      body: { email, token, password }
    })
    return wrapResult(result.payload?.data || result.data, null)
  } catch (err) {
    return wrapResult(null, err)
  }
}

export const getProviderState = (user) => {
  return supabase.auth.getProviderState?.(user || {}) || { googleLinked: false, emailVerified: false }
}

export const updateUser = async (payload) => {
  try {
    const result = await apiClient('/api/auth/update-account', {
      method: 'POST',
      body: payload
    })
    return wrapResult(result.payload?.data || result.data, null)
  } catch (err) {
    return wrapResult(null, err)
  }
}

export const unlinkGoogleAccount = async () => {
  try {
    const result = await apiClient('/api/auth/google/unlink', {
      method: 'POST'
    })
    return wrapResult(result.payload?.data || result.data, null)
  } catch (err) {
    return wrapResult(null, err)
  }
}

export const sendPasswordChangeCode = async (email) => {
  try {
    await apiClient('/api/auth/password-change/send-code', {
      method: 'POST',
      body: { email }
    })
    return wrapResult(null, null)
  } catch (err) {
    return wrapResult(null, err)
  }
}
