// src/store/useUIStore.js
import { create } from 'zustand'

const makeId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

let confirmationResolver = null

export const useUIStore = create((set) => ({
  loading: false,
  toasts: [],
  confirmation: null,
  setLoading: (value) => set({ loading: value }),

  pushToast: (type, message, options = {}) => {
    const id = makeId()
    const resolvedOptions =
      typeof options === 'number'
        ? { duration: options }
        : options && typeof options === 'object'
          ? options
          : {}

    set((state) => {
      const normalizedType = type || 'default'
      const normalizedMessage = String(message || '').trim() || 'Terjadi perubahan status.'
      
      // Silence REQUEST_ABORTED errors gracefully so users don't get spammed when navigating fast
      if (normalizedMessage.includes('Request dibatalkan')) {
        return state
      }

      const dedupedToasts = state.toasts.filter(
        (toast) => !(toast.type === normalizedType && toast.message === normalizedMessage)
      )

      return {
        toasts: [
          ...dedupedToasts,
          {
            id,
            type: normalizedType,
            message: normalizedMessage,
            duration: resolvedOptions.duration,
            title: resolvedOptions.title
          }
        ].slice(-5)
      }
    })

    return id
  },

  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id)
    })),

  clearToasts: () => set({ toasts: [] }),

  requestConfirmation: (options = {}) => {
    if (confirmationResolver) {
      confirmationResolver(false)
      confirmationResolver = null
    }

    const id = makeId()
    set({
      confirmation: {
        id,
        title: options.title || 'Konfirmasi tindakan',
        message: options.message || 'Apakah Anda yakin ingin melanjutkan?',
        confirmText: options.confirmText || 'Ya, lanjutkan',
        cancelText: options.cancelText || 'Batal',
        tone: options.tone || 'warning',
        details: Array.isArray(options.details) ? options.details : []
      }
    })

    return new Promise((resolve) => {
      confirmationResolver = resolve
    })
  },

  resolveConfirmation: (value) => {
    if (confirmationResolver) {
      confirmationResolver(Boolean(value))
      confirmationResolver = null
    }
    set({ confirmation: null })
  },

  closeConfirmation: () => {
    if (confirmationResolver) {
      confirmationResolver(false)
      confirmationResolver = null
    }
    set({ confirmation: null })
  }
}))
