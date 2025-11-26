// src/store/useUIStore.js
import { create } from 'zustand'

const makeId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export const useUIStore = create((set) => ({
  loading: false,
  toasts: [],
  setLoading: (value) => set({ loading: value }),

  pushToast: (type, message) =>
    set((state) => {
      const id = makeId()
      return {
        toasts: [...state.toasts, { id, type, message }]
      }
    }),

  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id)
    }))
}))
